import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorResponseSchema,
  RuntimeConfigurationSchema,
  brandIdentifier,
  createPageSchema,
} from '@delaware-scene/contracts';
import { Type } from '@sinclair/typebox';

describe('shared contracts', () => {
  it('rejects additional properties at API boundaries', () => {
    const valid = {
      error: { code: 'invalid', message: 'Invalid input', correlationId: 'correlation-1' },
    };
    expect(Value.Check(ApiErrorResponseSchema, valid)).toBe(true);
    expect(Value.Check(ApiErrorResponseSchema, { ...valid, stack: 'not public' })).toBe(false);
    expect(
      Value.Check(ApiErrorResponseSchema, {
        error: { ...valid.error, secret: 'not public' },
      }),
    ).toBe(false);
  });

  it('defines closed bounded page and runtime schemas', () => {
    const pageSchema = createPageSchema(Type.String());
    expect(
      Value.Check(pageSchema, {
        items: ['one'],
        page: 1,
        pageSize: 100,
        totalCount: 1,
        totalPages: 1,
        previous: null,
        next: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(pageSchema, {
        items: [],
        page: 1,
        pageSize: 101,
        totalCount: 0,
        totalPages: 0,
        previous: null,
        next: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(RuntimeConfigurationSchema, {
        host: '127.0.0.1',
        port: 3000,
        publicOrigin: 'https://localhost:3000',
        dataDirectory: 'data',
        demoMode: true,
        rateLimitMax: 60,
        rateLimitWindowSeconds: 60,
        retentionDays: 365,
        sourceFreshnessSeconds: 60,
        defaultPageSize: 12,
        ingestionPageLimit: 1000,
        releaseVersion: 'local',
        databaseSecretName: 'DATABASE_URL',
        demoEditorSecretName: 'DEMO_EDITOR_CODE',
      }),
    ).toBe(true);
  });

  it('brands only non-empty identifiers', () => {
    expect(brandIdentifier<'EventId'>('event-1')).toBe('event-1');
    expect(() => brandIdentifier<'EventId'>('   ')).toThrow('must not be empty');
  });
});
