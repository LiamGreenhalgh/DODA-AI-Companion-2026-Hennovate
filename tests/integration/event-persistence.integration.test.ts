import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ArchivalEligibilityService,
  type EventIngestionObservation,
} from '@delaware-scene/application';
import {
  PostgresArchivalEligibilityRepository,
  PostgresEventIngestionRepository,
  PostgresRetentionSettingsRepository,
  createPostgresDatabase,
  runMigrationsWithClient,
} from '@delaware-scene/database';
import {
  normalizeEvent,
  type EventRecord,
  type RawEventCandidate,
  type RawOccurrence,
  type Result,
} from '@delaware-scene/domain';
import { withDisposablePostgresSchema } from '@delaware-scene/test-support';

const connectionString = process.env.TEST_DATABASE_URL;
const databaseDescribe = connectionString ? describe : describe.skip;
const migrationsDirectory = join(process.cwd(), 'packages', 'database', 'migrations');
const sourceId = '10000000-0000-4000-8000-000000000001';

function schemaConnection(raw: string, schema: string): string {
  const url = new URL(raw);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  return url.href;
}

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function normalizedEvent(input: {
  id: string;
  title?: string;
  description?: string;
  retrievedAt?: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  occurrence: RawOccurrence;
}): EventRecord {
  const candidate: RawEventCandidate = {
    id: input.id,
    sourceRecordId: input.sourceRecordId ?? sourceId,
    sourceCategory: 'government',
    sourceUrl: input.sourceUrl ?? 'https://events.example.org/integration-event',
    sourceSuppliedId: 'integration-source-event',
    retrievedAt: input.retrievedAt ?? '2026-08-18T10:00:00Z',
    title: input.title ?? 'Integration Event',
    description: input.description ?? 'Initial integration description',
    venue: 'Integration Hall',
    city: 'Dover',
    occurrences: [input.occurrence],
  };
  return requireSuccess(normalizeEvent(candidate));
}

function observation(
  event: EventRecord,
  payloadDigest = 'a'.repeat(64),
): EventIngestionObservation {
  return {
    event,
    payloadDigest,
    adapterKey: 'integration-json-ld',
    adapterVersion: '1.0.0',
    extractionFormat: 'json-ld',
    runId: '90000000-0000-4000-8000-000000000001',
  };
}

async function insertSource(
  database: ReturnType<typeof createPostgresDatabase>,
  id = sourceId,
): Promise<void> {
  await database
    .insertInto('source_records')
    .values({
      id,
      catalog_file_name: 'Government Events.csv',
      catalog_physical_row: 2,
      source_category: 'government',
      organization_name: 'Integration Arts Organization',
      collection_state: 'enabled',
      adapter_key: 'integration-json-ld',
      import_fingerprint: 'f'.repeat(64),
      last_success_at: null,
    })
    .execute();
}

databaseDescribe('PostgreSQL event ingestion persistence', () => {
  it('retains one stable event, unions provenance, and makes replays exact-once', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, migrationsDirectory);
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresEventIngestionRepository(database);
      try {
        await insertSource(database);
        const initial = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000001',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000001',
            start: '2026-09-01',
          },
        });
        const created = await repository.upsertNormalizedEvent(observation(initial));
        const changed = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000002',
          description: 'Updated integration description',
          retrievedAt: '2026-08-18T11:00:00Z',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000002',
            start: '2026-09-01',
          },
        });
        const updated = await repository.upsertNormalizedEvent(
          observation(changed, 'b'.repeat(64)),
        );
        const conflictingReplay = {
          ...structuredClone(changed),
          description: 'A replay must not replace committed content.',
        };
        const replayed = await repository.upsertNormalizedEvent(
          observation(conflictingReplay, 'b'.repeat(64)),
        );

        expect(created).toMatchObject({
          action: 'created',
          provenanceCreated: 1,
          historyCreated: 1,
          event: {
            id: '20000000-0000-4000-8000-000000000001',
            publicationStatus: 'pending',
          },
        });
        expect(updated).toMatchObject({
          action: 'updated',
          provenanceCreated: 1,
          historyCreated: 1,
          event: {
            id: '20000000-0000-4000-8000-000000000001',
            description: 'Updated integration description',
            version: 2,
          },
        });
        expect(updated.event.provenance).toHaveLength(2);
        expect(replayed).toMatchObject({
          action: 'duplicate',
          provenanceCreated: 0,
          historyCreated: 0,
          event: {
            id: '20000000-0000-4000-8000-000000000001',
            description: 'Updated integration description',
            version: 2,
          },
        });
        expect(await repository.list()).toHaveLength(1);
        expect((await repository.listIngestionHistory()).map((record) => record.action)).toEqual([
          'created',
          'updated',
        ]);
      } finally {
        await database.destroy();
      }
    });
  });

  it('rolls back the event and occurrence when provenance cannot be persisted', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, migrationsDirectory);
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresEventIngestionRepository(database);
      try {
        await insertSource(database);
        const missingSourceEvent = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000010',
          sourceRecordId: '10000000-0000-4000-8000-000000000099',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000010',
            start: '2026-09-10',
          },
        });

        await expect(
          repository.upsertNormalizedEvent(observation(missingSourceEvent)),
        ).rejects.toThrow();
        expect(
          await database.selectFrom('event_records').select('id').execute(),
        ).toEqual([]);
        expect(
          await database.selectFrom('event_occurrences').select('id').execute(),
        ).toEqual([]);
        expect(
          await database.selectFrom('event_provenance').select('id').execute(),
        ).toEqual([]);
        expect(
          await database.selectFrom('event_ingestion_history').select('id').execute(),
        ).toEqual([]);

        const noProvenance = { ...structuredClone(missingSourceEvent), provenance: [] };
        await expect(
          repository.upsertNormalizedEvent(observation(noProvenance)),
        ).rejects.toThrow('associated provenance');
        expect(await repository.list()).toEqual([]);
      } finally {
        await database.destroy();
      }
    });
  });

  it('serializes concurrent same-identity inserts and preserves the identity set on retry', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, migrationsDirectory);
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresEventIngestionRepository(database);
      try {
        await insertSource(database);
        const first = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000020',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000020',
            start: '2026-09-20',
          },
        });
        const second = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000021',
          retrievedAt: '2026-08-18T10:01:00Z',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000021',
            start: '2026-09-20',
          },
        });

        const results = await Promise.all([
          repository.upsertNormalizedEvent(observation(first)),
          repository.upsertNormalizedEvent(observation(second, 'b'.repeat(64))),
        ]);
        const beforeRetry = await repository.list();
        await Promise.all([
          repository.upsertNormalizedEvent(observation(first)),
          repository.upsertNormalizedEvent(observation(second, 'b'.repeat(64))),
        ]);
        const afterRetry = await repository.list();

        expect(results.map((result) => result.action).sort()).toEqual([
          'created',
          'duplicate',
        ]);
        expect(new Set(results.map((result) => result.event.id)).size).toBe(1);
        expect(afterRetry).toHaveLength(1);
        expect(afterRetry[0]?.provenance).toHaveLength(2);
        expect(await repository.listIngestionHistory()).toHaveLength(2);
        expect(
          afterRetry.map((event) => `${event.identityVersion}:${event.canonicalIdentity}`),
        ).toEqual(
          beforeRetry.map((event) => `${event.identityVersion}:${event.canonicalIdentity}`),
        );
      } finally {
        await database.destroy();
      }
    });
  });
});

databaseDescribe('PostgreSQL retention and archival eligibility', () => {
  it('persists valid settings, preserves rejected values, and runs a read-only boundary query', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, migrationsDirectory);
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const ingestion = new PostgresEventIngestionRepository(database);
      const settings = new PostgresRetentionSettingsRepository(
        database,
        30,
        () => new Date('2026-08-18T12:00:00Z'),
      );
      const eligibility = new PostgresArchivalEligibilityRepository(database);
      const service = new ArchivalEligibilityService(eligibility, settings);
      try {
        await insertSource(database);
        const dateEnded = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000030',
          title: 'Ended Date Event',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000030',
            start: '2026-08-17',
          },
        });
        const dateCurrent = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000031',
          title: 'Current Date Event',
          sourceUrl: 'https://events.example.org/current-date-event',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000031',
            start: '2026-08-18',
          },
        });
        const instantAtBoundary = normalizedEvent({
          id: '20000000-0000-4000-8000-000000000032',
          title: 'Instant Boundary Event',
          sourceUrl: 'https://events.example.org/instant-boundary-event',
          occurrence: {
            id: '30000000-0000-4000-8000-000000000032',
            start: '2026-08-17T07:00:00-04:00[America/New_York]',
            end: '2026-08-17T08:00:00-04:00[America/New_York]',
          },
        });
        await ingestion.upsertNormalizedEvent(observation(dateEnded, 'c'.repeat(64)));
        await ingestion.upsertNormalizedEvent(observation(dateCurrent, 'd'.repeat(64)));
        await ingestion.upsertNormalizedEvent(observation(instantAtBoundary, 'e'.repeat(64)));
        await database
          .updateTable('event_records')
          .set({ publication_status: 'published' })
          .where('id', 'in', [dateEnded.id, dateCurrent.id, instantAtBoundary.id])
          .execute();

        expect(await settings.getRetentionDays()).toBe(30);
        expect(await settings.updateRetentionDays(0, 'editor')).toMatchObject({
          accepted: true,
          value: 0,
        });
        const rowBeforeRejection = await database
          .selectFrom('runtime_settings')
          .selectAll()
          .where('setting_key', '=', 'retentionDays')
          .executeTakeFirstOrThrow();
        expect(await settings.updateRetentionDays(3651, 'editor')).toMatchObject({
          accepted: false,
          value: 0,
        });
        expect(
          await database
            .selectFrom('runtime_settings')
            .selectAll()
            .where('setting_key', '=', 'retentionDays')
            .executeTakeFirstOrThrow(),
        ).toEqual(rowBeforeRejection);

        expect(
          (await eligibility.listEligibleForArchival('2026-08-18T12:00:00Z', 1)).map(
            (event) => event.id,
          ),
        ).toEqual([instantAtBoundary.id]);
        const stateBeforeJob = await database
          .selectFrom('event_records')
          .select(['id', 'publication_status', 'version'])
          .orderBy('id', 'asc')
          .execute();
        expect(await service.runJob('2026-08-18T12:00:00Z')).toEqual({
          jobType: 'event-archival-eligibility',
          evaluatedAt: '2026-08-18T12:00:00Z',
          retentionDays: 0,
          eligibleEventIds: [dateEnded.id, instantAtBoundary.id].sort(),
        });
        expect(
          await database
            .selectFrom('event_records')
            .select(['id', 'publication_status', 'version'])
            .orderBy('id', 'asc')
            .execute(),
        ).toEqual(stateBeforeJob);
      } finally {
        await database.destroy();
      }
    });
  });
});
