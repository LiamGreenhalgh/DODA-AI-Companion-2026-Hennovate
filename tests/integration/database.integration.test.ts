import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KyselyTransactionManager,
  PostgresAuditWriter,
  PostgresEventRepository,
  PostgresJobQueue,
  createPostgresDatabase,
  runMigrationsWithClient,
} from '@delaware-scene/database';
import { withDisposablePostgresSchema } from '@delaware-scene/test-support';

const connectionString = process.env.TEST_DATABASE_URL;
const databaseDescribe = connectionString ? describe : describe.skip;

function schemaConnection(raw: string, schema: string): string {
  const url = new URL(raw);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  return url.href;
}

databaseDescribe('PostgreSQL production migration and repositories', () => {
  it('applies migrations and enforces append-only audit history', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client }) => {
      const applied = await runMigrationsWithClient(
        client,
        join(process.cwd(), 'packages', 'database', 'migrations'),
      );
      expect(applied.map((migration) => migration.fileName)).toEqual(['001_initial.sql']);
      const metadata = await client.query<{ version: number }>('SELECT version FROM migration_metadata');
      expect(metadata.rows).toEqual([{ version: 1 }]);
      await client.query(
        `INSERT INTO audit_records
          (id, editor_identity, action_type, target_type, target_identifier, action_timestamp)
         VALUES ('10000000-0000-4000-8000-000000000001', 'editor', 'approve', 'event', 'event-1', now())`,
      );
      await expect(
        client.query(
          "UPDATE audit_records SET action_type = 'archive' WHERE id = '10000000-0000-4000-8000-000000000001'",
        ),
      ).rejects.toThrow('append-only');
    });
  });

  it('rolls back caller-owned audit work on injected failure', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, join(process.cwd(), 'packages', 'database', 'migrations'));
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const transactions = new KyselyTransactionManager(database);
      const audits = new PostgresAuditWriter(database);
      try {
        await expect(
          transactions.run(async (transaction) => {
            await audits.insert(transaction, {
              id: '10000000-0000-4000-8000-000000000002',
              actorIdentity: 'editor',
              actionType: 'approve',
              targetType: 'event',
              targetIdentifier: 'event-2',
              actionTimestamp: '2026-08-18T12:00:00Z',
            });
            throw new Error('injected failure before commit');
          }),
        ).rejects.toThrow('injected failure');
        const row = await database
          .selectFrom('audit_records')
          .select('id')
          .where('id', '=', '10000000-0000-4000-8000-000000000002')
          .executeTakeFirst();
        expect(row).toBeUndefined();
      } finally {
        await database.destroy();
      }
    });
  });

  it('enforces optimistic event transitions and writes one audit', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, join(process.cwd(), 'packages', 'database', 'migrations'));
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresEventRepository(database);
      try {
        await database
          .insertInto('event_records')
          .values({
            id: '20000000-0000-4000-8000-000000000001',
            identity_version: 1,
            canonical_identity: 'a'.repeat(64),
            organization_profile_id: null,
            title: 'Pending event',
            description: null,
            category_values: [],
            organization_name: null,
            venue_name: null,
            city: null,
            region: null,
            cost_text: null,
            audience_text: null,
            accessibility_text: null,
            address_json: null,
            latitude: null,
            longitude: null,
            online_location_url: null,
            public_source_url: null,
            ticket_url: null,
            registration_url: null,
            source_category: 'government',
            publication_status: 'pending',
            validation_state: 'valid',
            public_attribution: null,
            rights_notice: null,
          })
          .execute();
        const first = await repository.transition({
          eventId: '20000000-0000-4000-8000-000000000001',
          expectedVersion: 1,
          from: 'pending',
          to: 'published',
          audit: {
            id: '30000000-0000-4000-8000-000000000001',
            editorIdentity: 'editor',
            action: 'approve',
            targetId: '20000000-0000-4000-8000-000000000001',
            actionTimestamp: '2026-08-18T12:00:00Z',
            reason: null,
          },
        });
        expect(first).toMatchObject({ publicationStatus: 'published', version: 2 });
        const stale = await repository.transition({
          eventId: '20000000-0000-4000-8000-000000000001',
          expectedVersion: 1,
          from: 'pending',
          to: 'published',
          audit: {
            id: '30000000-0000-4000-8000-000000000002',
            editorIdentity: 'editor',
            action: 'approve',
            targetId: '20000000-0000-4000-8000-000000000001',
            actionTimestamp: '2026-08-18T12:00:01Z',
            reason: null,
          },
        });
        expect(stale).toBeNull();
        expect(await repository.listAudits()).toHaveLength(1);
      } finally {
        await database.destroy();
      }
    });
  });

  it('claims idempotent jobs once and recovers bounded leases', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(client, join(process.cwd(), 'packages', 'database', 'migrations'));
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const transactions = new KyselyTransactionManager(database);
      const jobs = new PostgresJobQueue(database);
      try {
        let firstId = '';
        await transactions.run(async (transaction) => {
          firstId = await jobs.enqueue(transaction, {
            type: 'fixture',
            payloadVersion: 1,
            payload: { sourceId: 'source-1' },
            availableAt: '2026-08-18T12:00:00Z',
            maxAttempts: 2,
            idempotencyKey: 'fixture-source-1',
          });
          const replayId = await jobs.enqueue(transaction, {
            type: 'fixture',
            payloadVersion: 1,
            payload: { sourceId: 'source-1' },
            availableAt: '2026-08-18T12:00:00Z',
            maxAttempts: 2,
            idempotencyKey: 'fixture-source-1',
          });
          expect(replayId).toBe(firstId);
        });
        const claim = await jobs.claim(
          'worker-1',
          '2026-08-18T12:00:00Z',
          '2026-08-18T12:01:00Z',
        );
        expect(claim).toMatchObject({ id: firstId, attempts: 1, leaseOwner: 'worker-1' });
        expect(
          await jobs.heartbeat(
            firstId,
            'worker-1',
            '2026-08-18T12:00:30Z',
            '2026-08-18T12:01:30Z',
          ),
        ).toBe(true);
        expect(await jobs.complete(firstId, 'worker-1', '2026-08-18T12:00:40Z', { ok: true })).toBe(true);
        expect(await jobs.claim('worker-2', '2026-08-18T12:02:00Z', '2026-08-18T12:03:00Z')).toBeNull();
      } finally {
        await database.destroy();
      }
    });
  });
});
