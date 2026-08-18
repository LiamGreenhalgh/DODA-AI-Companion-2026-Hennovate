import { describe, expect, it } from 'vitest';
import { InMemoryEventRepository } from '@delaware-scene/application';
import { FakeClock } from '@delaware-scene/test-support';
import { buildApp } from '../../apps/server/src/app.js';
import { parseConfigObject } from '../../apps/server/src/config.js';

function configuration() {
  const result = parseConfigObject({ RELEASE_VERSION: 'foundation-test' });
  if (!result.ok) throw new Error('Test configuration is invalid.');
  return result.value;
}

async function appWith(repository = new InMemoryEventRepository()) {
  return buildApp({
    config: configuration(),
    repository,
    sourceReader: { async listSources() { return []; } },
    secretProvider: { async get() { return null; } },
    clock: new FakeClock(),
  });
}

describe('foundation API contract', () => {
  it('returns a non-empty versioned public liveness representation', async () => {
    const app = await appWith();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        service: 'delaware-scene-clean-room',
        version: 'foundation-test',
      });
    } finally {
      await app.close();
    }
  });

  it('returns a safe correlation-bearing 500 without stack or secret content', async () => {
    const app = await appWith();
    app.get('/api/v1/test/unhandled', async () => {
      throw new Error('DATABASE_PASSWORD=not-for-a-response');
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/test/unhandled',
        headers: { 'x-correlation-id': 'foundation-correlation' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: {
          code: 'internal_error',
          message: 'The request could not be completed.',
          correlationId: 'foundation-correlation',
        },
      });
      expect(response.body).not.toContain('DATABASE_PASSWORD');
      expect(response.body).not.toContain('stack');
    } finally {
      await app.close();
    }
  });

  it('uses the same safe not-found envelope for unknown API resources', async () => {
    const app = await appWith();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/not-a-route' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: 'not_found', message: 'Resource was not found.' },
      });
    } finally {
      await app.close();
    }
  });
});
