import type {
  Page,
  PublicEventDetailDto,
  PublicEventSummaryDto,
  SearchMetadataDto,
} from '@delaware-scene/contracts';
import {
  compareOccurrences,
  eventMatchesFilters,
  eventMatchesSearch,
  isUpcoming,
  paginate,
  type EventFilters,
  type EventOccurrence,
  type EventRecord,
  type PublicationStatus,
} from '@delaware-scene/domain';

export interface TransactionContext {
  readonly transactionId: symbol;
}

export interface TransactionManager {
  run<T>(work: (transaction: TransactionContext) => Promise<T>): Promise<T>;
}

export interface PublicDataRevisionPort {
  current(transaction?: TransactionContext): Promise<bigint>;
  increment(transaction?: TransactionContext): Promise<bigint>;
}

export interface EventRepository {
  list(): Promise<EventRecord[]>;
  findById(id: string): Promise<EventRecord | null>;
}

export interface SeedableEventRepository extends EventRepository {
  replaceAll(events: readonly EventRecord[]): Promise<void>;
}

export interface AuditRecord {
  id: string;
  editorIdentity: string;
  action: 'approve' | 'reject' | 'archive';
  targetId: string;
  actionTimestamp: string;
  reason: string | null;
}

export interface ModerationRepository extends EventRepository {
  transition(input: {
    eventId: string;
    expectedVersion: number;
    from: PublicationStatus;
    to: PublicationStatus;
    audit: AuditRecord;
  }): Promise<EventRecord | null>;
  listAudits(): Promise<AuditRecord[]>;
}

export interface EventListQuery {
  page: number;
  pageSize: number;
  query?: string;
  filters?: EventFilters;
  openedAt: string;
  path?: string;
}

function occurrenceDto(occurrence: EventOccurrence): PublicEventSummaryDto['occurrence'] {
  return { ...occurrence };
}

function summary(event: EventRecord, occurrence: EventOccurrence): PublicEventSummaryDto {
  return {
    id: event.id,
    occurrence: occurrenceDto(occurrence),
    title: event.title,
    description: event.description,
    categories: [...event.categories],
    organization: event.organization,
    venue: event.venue,
    city: event.city,
    region: event.region,
    cost: event.cost,
    audience: event.audience,
    accessibility: event.accessibility,
  };
}

function createPageReference(path: string, page: number, pageSize: number): string {
  const separator = path.includes('?') ? '&' : '?';
  const withoutPage = path
    .replace(/([?&])page=\d+(&?)/u, (_match, lead: string, tail: string) =>
      lead === '?' && tail ? '?' : tail ? lead : '',
    )
    .replace(/[?&]$/u, '');
  return `${withoutPage}${separator}page=${page}&pageSize=${pageSize}`;
}

export class EventQueryService {
  constructor(private readonly repository: EventRepository) {}

  async list(query: EventListQuery): Promise<Page<PublicEventSummaryDto>> {
    const all = await this.repository.list();
    const matches = all
      .filter((event) => event.publicationStatus === 'published')
      .filter((event) => !query.query || eventMatchesSearch(event, query.query))
      .filter((event) => eventMatchesFilters(event, query.filters ?? {}))
      .flatMap((event) =>
        event.occurrences
          .filter((occurrence) => isUpcoming(occurrence, query.openedAt))
          .map((occurrence) => ({ event, occurrence })),
      )
      .sort((left, right) =>
        compareOccurrences(
          { eventId: left.event.id, occurrence: left.occurrence },
          { eventId: right.event.id, occurrence: right.occurrence },
        ),
      );
    const selected = paginate(matches, query.page, query.pageSize);
    const path = query.path ?? '/api/v1/events';
    return {
      items: selected.items.map(({ event, occurrence }) => summary(event, occurrence)),
      page: selected.page,
      pageSize: selected.pageSize,
      totalCount: selected.totalCount,
      totalPages: selected.totalPages,
      previous:
        selected.page > 1 ? createPageReference(path, selected.page - 1, selected.pageSize) : null,
      next:
        selected.page < selected.totalPages
          ? createPageReference(path, selected.page + 1, selected.pageSize)
          : null,
    };
  }

  async detail(id: string, openedAt: string): Promise<PublicEventDetailDto | null> {
    const event = await this.repository.findById(id);
    if (!event || event.publicationStatus !== 'published') return null;
    const occurrences = event.occurrences
      .filter((occurrence) => isUpcoming(occurrence, openedAt))
      .sort((left, right) =>
        compareOccurrences({ eventId: event.id, occurrence: left }, { eventId: event.id, occurrence: right }),
      );
    const link = (url: string | null, label: string) =>
      url ? ({ url, isExternal: true as const, label }) : null;
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      categories: [...event.categories],
      organization: event.organization,
      venue: event.venue,
      city: event.city,
      region: event.region,
      cost: event.cost,
      audience: event.audience,
      accessibility: event.accessibility,
      occurrences: occurrences.map(occurrenceDto),
      address: event.address ? { ...event.address } : null,
      coordinates: event.coordinates ? { ...event.coordinates } : null,
      source: link(event.publicSourceUrl, 'Original source (external website)'),
      ticket: link(event.ticketUrl, 'Tickets (external website)'),
      registration: link(event.registrationUrl, 'Registration (external website)'),
      attribution: event.attribution,
      rightsNotice: event.rightsNotice,
    };
  }

  async metadata(): Promise<SearchMetadataDto> {
    const events = (await this.repository.list()).filter(
      (event) => event.publicationStatus === 'published',
    );
    const unique = (values: Array<string | null>): string[] =>
      [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
        a.localeCompare(b),
      );
    return {
      categories: unique(events.flatMap((event) => event.categories)),
      regions: unique(events.map((event) => event.region)),
      organizations: unique(events.map((event) => event.organization)),
      sourceCategories: [...new Set(events.map((event) => event.sourceCategory))].sort(),
      costs: unique(events.map((event) => event.cost)),
      audiences: unique(events.map((event) => event.audience)),
      accessibility: unique(events.map((event) => event.accessibility)),
    };
  }
}

export interface ModerationResult {
  ok: boolean;
  event?: EventRecord;
  error?: { code: string; message: string };
}

export class ModerationService {
  constructor(private readonly repository: ModerationRepository) {}

  async transition(input: {
    eventId: string;
    expectedVersion: number;
    action: 'approve' | 'reject' | 'archive';
    editorIdentity: string;
    actionTimestamp: string;
    reason?: string;
    auditId: string;
  }): Promise<ModerationResult> {
    const event = await this.repository.findById(input.eventId);
    if (!event) return { ok: false, error: { code: 'not_found', message: 'Event was not found.' } };
    const graph: Record<typeof input.action, { from: PublicationStatus; to: PublicationStatus }> = {
      approve: { from: 'pending', to: 'published' },
      reject: { from: 'pending', to: 'rejected' },
      archive: { from: 'published', to: 'archived' },
    };
    const transition = graph[input.action];
    if (event.publicationStatus !== transition.from) {
      return {
        ok: false,
        error: { code: 'invalid_transition', message: 'Requested status transition is not allowed.' },
      };
    }
    const reason = input.reason?.trim() ?? '';
    if (input.action === 'reject' && (reason.length < 1 || reason.length > 1000)) {
      return {
        ok: false,
        error: {
          code: 'invalid_rejection_reason',
          message: 'Rejection reason must contain from 1 through 1000 non-whitespace characters.',
        },
      };
    }
    const updated = await this.repository.transition({
      eventId: input.eventId,
      expectedVersion: input.expectedVersion,
      from: transition.from,
      to: transition.to,
      audit: {
        id: input.auditId,
        editorIdentity: input.editorIdentity,
        action: input.action,
        targetId: input.eventId,
        actionTimestamp: input.actionTimestamp,
        reason: input.action === 'reject' ? reason : null,
      },
    });
    if (!updated) {
      return {
        ok: false,
        error: { code: 'version_conflict', message: 'The event changed before this action completed.' },
      };
    }
    return { ok: true, event: updated };
  }
}

export class InMemoryEventRepository implements ModerationRepository {
  #events: EventRecord[];
  #audits: AuditRecord[] = [];

  constructor(events: readonly EventRecord[] = []) {
    this.#events = events.map((event) => structuredClone(event));
  }

  async list(): Promise<EventRecord[]> {
    return structuredClone(this.#events);
  }

  async findById(id: string): Promise<EventRecord | null> {
    const event = this.#events.find((candidate) => candidate.id === id);
    return event ? structuredClone(event) : null;
  }

  async replaceAll(events: readonly EventRecord[]): Promise<void> {
    this.#events = events.map((event) => structuredClone(event));
  }

  async transition(input: {
    eventId: string;
    expectedVersion: number;
    from: PublicationStatus;
    to: PublicationStatus;
    audit: AuditRecord;
  }): Promise<EventRecord | null> {
    const index = this.#events.findIndex((event) => event.id === input.eventId);
    const current = this.#events[index];
    if (!current || current.version !== input.expectedVersion || current.publicationStatus !== input.from) {
      return null;
    }
    const next = { ...current, publicationStatus: input.to, version: current.version + 1 };
    this.#events[index] = next;
    this.#audits.push(structuredClone(input.audit));
    return structuredClone(next);
  }

  async listAudits(): Promise<AuditRecord[]> {
    return structuredClone(this.#audits);
  }
}

export interface NewJob {
  type: string;
  payloadVersion: number;
  payload: unknown;
  availableAt: string;
  maxAttempts: number;
  idempotencyKey: string;
}

export interface ClaimedJob {
  id: string;
  type: string;
  payloadVersion: number;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface JobFailure {
  category: string;
  retryAt?: string;
}

export interface JobQueue {
  enqueue(transaction: TransactionContext, job: NewJob): Promise<string>;
  claim(workerId: string, now: string, leaseUntil: string): Promise<ClaimedJob | null>;
  heartbeat(id: string, workerId: string, at: string, leaseUntil: string): Promise<boolean>;
  complete(id: string, workerId: string, completedAt: string, result: unknown): Promise<boolean>;
  fail(id: string, workerId: string, failedAt: string, failure: JobFailure): Promise<boolean>;
}

export interface NewAuditRecord {
  id: string;
  actorIdentity: string;
  actionType: string;
  targetType: string;
  targetIdentifier: string;
  actionTimestamp: string;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  safeMetadata?: Readonly<Record<string, unknown>>;
}

export interface AuditWriter {
  insert(transaction: TransactionContext, record: NewAuditRecord): Promise<'created' | 'replayed'>;
}

export interface SourceStateRevisionInput {
  sourceRecordId: string;
  precedingState: 'enabled' | 'disabled';
  selectedState: 'enabled' | 'disabled';
  editorIdentity: string;
  actionTimestamp: string;
  auditId: string;
}

export interface EventRevisionInput {
  eventId: string;
  fieldName: string;
  sourceSuppliedValue: unknown | null;
  precedingValue: unknown | null;
  selectedValue: unknown | null;
  editorIdentity: string;
  actionTimestamp: string;
  reason?: string | null;
  auditId: string;
}

export interface RevisionWriter {
  appendSourceState(transaction: TransactionContext, revision: SourceStateRevisionInput): Promise<string>;
  appendEvent(transaction: TransactionContext, revision: EventRevisionInput): Promise<string>;
}

export * from './event-ingestion.js';