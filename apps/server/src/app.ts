import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  ApiErrorResponseSchema,
  EventCollectionQuerySchema,
  HealthResponseSchema,
  LoginBodySchema,
  type ApiErrorResponse,
  type SourceSummaryDto,
} from '@delaware-scene/contracts';
import {
  EventQueryService,
  ModerationService,
  type ModerationRepository,
} from '@delaware-scene/application';
import {
  constantTimeSecretEqual,
  DemoSessionStore,
  type SecretProvider,
} from '@delaware-scene/auth';
import type { CanonicalSourceRecord, Clock } from '@delaware-scene/domain';
import type { AppConfig } from './config.js';

interface SourceReader {
  listSources(): Promise<CanonicalSourceRecord[]>;
}

export interface BuildAppOptions {
  config: AppConfig;
  repository: ModerationRepository;
  sourceReader: SourceReader;
  secretProvider: SecretProvider;
  clock: Clock;
  sessionStore?: DemoSessionStore;
  staticDirectory?: string;
  logger?: boolean;
}

interface EventQueryInput {
  page?: number;
  pageSize?: number;
  q?: string;
  category?: string | string[];
  region?: string | string[];
  organization?: string | string[];
  cost?: string | string[];
  audience?: string | string[];
  accessibility?: string | string[];
}

interface LoginInput {
  accountId: string;
  accessCode: string;
}

interface TransitionInput {
  version: number;
  reason?: string;
}

function values(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function errorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  fields?: ApiErrorResponse['error']['fields'],
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      correlationId: request.id,
      ...(fields && fields.length > 0 ? { fields } : {}),
    },
  };
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  fields?: ApiErrorResponse['error']['fields'],
): FastifyReply {
  return reply.status(status).send(errorBody(request, code, message, fields));
}

function discoveryUrls(source: CanonicalSourceRecord): string[] {
  const from = (field: CanonicalSourceRecord['eventUrls']): readonly string[] =>
    field.kind === 'values' ? field.values : [];
  return [...from(source.organizationUrls), ...from(source.sitemapUrls), ...from(source.eventUrls)];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: (request) => {
      const supplied = request.headers['x-correlation-id'];
      return typeof supplied === 'string' && /^[a-zA-Z0-9._-]{1,128}$/u.test(supplied)
        ? supplied
        : randomUUID();
    },
  });
  await app.register(cookie);
  const queryService = new EventQueryService(options.repository);
  const moderationService = new ModerationService(options.repository);
  const sessionStore = options.sessionStore ?? new DemoSessionStore();
  const rateEvents = new Map<string, number[]>();
  const idempotentResponses = new Map<string, unknown>();

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/') || request.url.startsWith('/api/v1/moderation/')) return;
    const now = options.clock.now().epochMilliseconds;
    const windowMilliseconds = options.config.rateLimitWindowSeconds * 1000;
    const recent = (rateEvents.get(request.ip) ?? []).filter((time) => now - time < windowMilliseconds);
    if (recent.length >= options.config.rateLimitMax) {
      const oldest = recent[0] ?? now;
      const retryAfter = Math.max(1, Math.min(60, Math.ceil((windowMilliseconds - (now - oldest)) / 1000)));
      reply.header('Retry-After', String(retryAfter));
      await sendError(request, reply, 429, 'rate_limited', 'Public request limit exceeded.');
      return reply;
    }
    recent.push(now);
    rateEvents.set(request.ip, recent);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    );
    return payload;
  });

  app.setErrorHandler(async (error, request, reply) => {
    const validation =
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      Array.isArray(error.validation)
        ? error.validation
        : null;
    if (validation) {
      await sendError(
        request,
        reply,
        400,
        'invalid_parameter',
        'One or more request parameters are invalid.',
        validation.map((issue) => ({
          path: issue.instancePath || issue.params?.missingProperty?.toString() || 'request',
          code: issue.keyword,
          message: issue.message ?? 'Invalid value.',
        })),
      );
      return;
    }
    request.log.error({ err: error, correlationId: request.id }, 'unhandled request failure');
    await sendError(request, reply, 500, 'internal_error', 'The request could not be completed.');
  });

  app.get('/api/v1/health/live', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    service: 'delaware-scene-clean-room' as const,
    version: options.config.releaseVersion,
  }));

  app.get('/api/v1/health/ready', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    service: 'delaware-scene-clean-room' as const,
    version: options.config.releaseVersion,
  }));

  app.get(
    '/api/v1/events',
    { schema: { querystring: EventCollectionQuerySchema, response: { 400: ApiErrorResponseSchema } } },
    async (request) => {
      const query = request.query as EventQueryInput;
      const rawSearch = query.q?.trim();
      const parsedUrl = new URL(request.url, options.config.publicOrigin);
      parsedUrl.searchParams.delete('page');
      parsedUrl.searchParams.delete('pageSize');
      return queryService.list({
        page: query.page ?? 1,
        pageSize: query.pageSize ?? options.config.defaultPageSize,
        ...(rawSearch ? { query: rawSearch } : {}),
        filters: {
          categories: values(query.category),
          regions: values(query.region),
          organizations: values(query.organization),
          costs: values(query.cost),
          audiences: values(query.audience),
          accessibility: values(query.accessibility),
        },
        openedAt: options.clock.now().toString(),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
      });
    },
  );

  app.get('/api/v1/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const detail = await queryService.detail(eventId, options.clock.now().toString());
    if (!detail) return sendError(request, reply, 404, 'not_found', 'Event was not found.');
    return detail;
  });

  app.get('/api/v1/search-metadata', async () => queryService.metadata());

  app.get('/api/openapi.json', async () => ({
    openapi: '3.1.0',
    info: {
      title: 'Delaware Arts Calendar API',
      version: '1.0.0',
      description: 'Clean-room public and demo moderation interfaces.',
    },
    servers: [{ url: options.config.publicOrigin }],
    paths: {
      '/api/v1/events': {
        get: {
          summary: 'List published upcoming event occurrences',
          security: [],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'q', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
          ],
          responses: { '200': { description: 'Deterministic page' }, '400': { description: 'Validation error' }, '429': { description: 'Rate limited' }, '500': { description: 'Safe internal error' } },
        },
      },
      '/api/v1/events/{eventId}': {
        get: {
          summary: 'Get a published event detail',
          security: [],
          responses: { '200': { description: 'Published event' }, '404': { description: 'Unknown or unpublished' }, '500': { description: 'Safe internal error' } },
        },
      },
      '/api/v1/search-metadata': { get: { summary: 'Get supported filters', security: [], responses: { '200': { description: 'Filter metadata' } } } },
      '/api/v1/health/live': { get: { summary: 'Get process liveness', security: [], responses: { '200': { description: 'Live' } } } },
      '/api/v1/health/ready': { get: { summary: 'Get dependency readiness', security: [], responses: { '200': { description: 'Ready' }, '503': { description: 'Unavailable dependency' } } } },
      '/api/v1/auth/login': { post: { summary: 'Create a local demo session', security: [], responses: { '200': { description: 'Session created' }, '401': { description: 'Invalid credentials' }, '503': { description: 'Demo authentication unavailable' } } } },
      '/api/v1/moderation/events': { get: { summary: 'List moderation events', security: [{ cookieAuth: [] }], responses: { '200': { description: 'Moderation queue' }, '401': { description: 'Authentication required' }, '403': { description: 'Editor role required' } } } },
    },
    components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ds_session' } } },
  }));

  app.post('/api/v1/auth/login', { schema: { body: LoginBodySchema } }, async (request, reply) => {
    if (!options.config.demoMode) {
      return sendError(request, reply, 503, 'authentication_unavailable', 'Local demo authentication is disabled.');
    }
    const body = request.body as LoginInput;
    const expected = await options.secretProvider.get(options.config.demoEditorSecretName);
    const valid =
      body.accountId === 'demo-editor' && expected && constantTimeSecretEqual(expected, body.accessCode);
    if (!valid) return sendError(request, reply, 401, 'invalid_credentials', 'Credentials are invalid.');
    const session = sessionStore.create('demo-editor', 'editor', new Date(options.clock.now().epochMilliseconds));
    reply.setCookie('ds_session', session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.config.publicOrigin.startsWith('https://'),
      maxAge: 3600,
    });
    return {
      accountId: session.accountId,
      role: session.role,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  });

  const getSession = (request: FastifyRequest) =>
    sessionStore.find(request.cookies.ds_session, new Date(options.clock.now().epochMilliseconds));

  const requireEditor = (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request);
    if (!session) {
      sendError(request, reply, 401, 'authentication_required', 'Valid authentication is required.');
      return null;
    }
    if (session.role !== 'editor') {
      sendError(request, reply, 403, 'forbidden', 'Editor role is required.');
      return null;
    }
    return session;
  };

  const requireIntegrity = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    const csrf = request.headers['x-csrf-token'];
    const valid =
      origin === options.config.publicOrigin &&
      (fetchSite === undefined || ['same-origin', 'same-site', 'none'].includes(String(fetchSite))) &&
      sessionStore.validateCsrf(
        request.cookies.ds_session,
        typeof csrf === 'string' ? csrf : undefined,
        new Date(options.clock.now().epochMilliseconds),
      );
    if (!valid) sendError(request, reply, 403, 'invalid_request_integrity', 'Request integrity validation failed.');
    return valid;
  };

  app.get('/api/v1/auth/session', async (request, reply) => {
    const session = getSession(request);
    if (!session) return sendError(request, reply, 401, 'authentication_required', 'Valid authentication is required.');
    return session;
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!getSession(request)) return sendError(request, reply, 401, 'authentication_required', 'Valid authentication is required.');
    if (!requireIntegrity(request, reply)) return reply;
    sessionStore.revoke(request.cookies.ds_session);
    reply.clearCookie('ds_session', { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/moderation/events', async (request, reply) => {
    if (!requireEditor(request, reply)) return reply;
    return { items: await options.repository.list() };
  });

  app.get('/api/v1/moderation/sources', async (request, reply) => {
    if (!requireEditor(request, reply)) return reply;
    const sources = await options.sourceReader.listSources();
    const items: SourceSummaryDto[] = sources.map((source) => ({
      id: source.id,
      organizationName: source.organizationName,
      sourceCategory: source.sourceCategory,
      collectionState: source.collectionState,
      discoveryUrls: discoveryUrls(source),
    }));
    return { items, totalCount: items.length };
  });

  const handleTransition = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'approve' | 'reject' | 'archive',
  ) => {
    const session = requireEditor(request, reply);
    if (!session || !requireIntegrity(request, reply)) return reply;
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
      return sendError(request, reply, 400, 'invalid_idempotency_key', 'Idempotency-Key is required.');
    }
    const replayKey = `${session.accountId}:${request.routeOptions.url}:${idempotencyKey}`;
    if (idempotentResponses.has(replayKey)) return idempotentResponses.get(replayKey);
    const { eventId } = request.params as { eventId: string };
    const body = request.body as TransitionInput;
    if (!Number.isInteger(body.version) || body.version < 1) {
      return sendError(request, reply, 400, 'invalid_version', 'Version must be a positive integer.');
    }
    const result = await moderationService.transition({
      eventId,
      expectedVersion: body.version,
      action,
      editorIdentity: session.accountId,
      actionTimestamp: options.clock.now().toString(),
      reason: body.reason,
      auditId: randomUUID(),
    });
    if (!result.ok) {
      const status = result.error?.code === 'not_found' ? 404 : result.error?.code === 'version_conflict' ? 409 : 400;
      return sendError(request, reply, status, result.error?.code ?? 'invalid_transition', result.error?.message ?? 'Transition failed.');
    }
    const response = { event: result.event };
    idempotentResponses.set(replayKey, response);
    return response;
  };

  const transitionSchema = {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['version'],
      properties: {
        version: { type: 'integer', minimum: 1 },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  } as const;
  app.post('/api/v1/moderation/events/:eventId/approve', { schema: transitionSchema }, (request, reply) => handleTransition(request, reply, 'approve'));
  app.post('/api/v1/moderation/events/:eventId/reject', { schema: transitionSchema }, (request, reply) => handleTransition(request, reply, 'reject'));
  app.post('/api/v1/moderation/events/:eventId/archive', { schema: transitionSchema }, (request, reply) => handleTransition(request, reply, 'archive'));

  if (options.staticDirectory && existsSync(join(options.staticDirectory, 'index.html'))) {
    await app.register(fastifyStatic, { root: options.staticDirectory, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return sendError(request, reply, 404, 'not_found', 'Resource was not found.');
      }
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler(async (request, reply) =>
      sendError(request, reply, 404, 'not_found', 'Resource was not found.'),
    );
  }

  return app;
}
