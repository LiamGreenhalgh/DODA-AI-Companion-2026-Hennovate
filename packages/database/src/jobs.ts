import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  ClaimedJob,
  JobFailure,
  JobQueue,
  NewJob,
  TransactionContext,
} from '@delaware-scene/application';
import { databaseExecutor } from './postgres.js';
import type { DatabaseSchema } from './schema.js';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async enqueue(transaction: TransactionContext, job: NewJob): Promise<string> {
    const database = databaseExecutor(this.database, transaction);
    await database
      .insertInto('jobs')
      .values({
        job_type: job.type,
        payload_version: job.payloadVersion,
        payload: job.payload,
        state: 'queued',
        available_at: new Date(job.availableAt),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        max_attempts: job.maxAttempts,
        idempotency_key: job.idempotencyKey,
        result: null,
        failure_category: null,
        completed_at: null,
      })
      .onConflict((conflict) => conflict.column('idempotency_key').doNothing())
      .execute();
    const row = await database
      .selectFrom('jobs')
      .select('id')
      .where('idempotency_key', '=', job.idempotencyKey)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private async recoverExpiredLeases(
    transaction: Transaction<DatabaseSchema>,
    now: Date,
  ): Promise<void> {
    await transaction
      .updateTable('jobs')
      .set({
        state: 'failed',
        failure_category: 'lease-expired',
        completed_at: now,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
      })
      .where('state', '=', 'running')
      .where('lease_expires_at', '<=', now)
      .where(sql<boolean>`attempts >= max_attempts`)
      .execute();
    await transaction
      .updateTable('jobs')
      .set({
        state: 'queued',
        failure_category: 'lease-expired',
        available_at: now,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
      })
      .where('state', '=', 'running')
      .where('lease_expires_at', '<=', now)
      .where(sql<boolean>`attempts < max_attempts`)
      .execute();
  }

  async claim(workerId: string, nowValue: string, leaseUntilValue: string): Promise<ClaimedJob | null> {
    const now = new Date(nowValue);
    const leaseUntil = new Date(leaseUntilValue);
    if (leaseUntil.getTime() <= now.getTime()) {
      throw new RangeError('leaseUntil must occur after now.');
    }
    return this.database.transaction().execute(async (transaction) => {
      await this.recoverExpiredLeases(transaction, now);
      const candidate = await transaction
        .selectFrom('jobs')
        .select('id')
        .where('state', '=', 'queued')
        .where('available_at', '<=', now)
        .where(sql<boolean>`attempts < max_attempts`)
        .orderBy('available_at', 'asc')
        .orderBy('created_at', 'asc')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;
      const row = await transaction
        .updateTable('jobs')
        .set({
          state: 'running',
          lease_owner: workerId,
          lease_expires_at: leaseUntil,
          heartbeat_at: now,
          attempts: sql<number>`attempts + 1`,
          failure_category: null,
        })
        .where('id', '=', candidate.id)
        .where('state', '=', 'queued')
        .returning([
          'id',
          'job_type',
          'payload_version',
          'payload',
          'attempts',
          'max_attempts',
          'lease_owner',
          'lease_expires_at',
        ])
        .executeTakeFirstOrThrow();
      if (!row.lease_owner || !row.lease_expires_at) {
        throw new Error('Claimed job is missing its lease.');
      }
      return {
        id: row.id,
        type: row.job_type,
        payloadVersion: row.payload_version,
        payload: row.payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        leaseOwner: row.lease_owner,
        leaseExpiresAt: iso(row.lease_expires_at),
      };
    });
  }

  async heartbeat(
    id: string,
    workerId: string,
    atValue: string,
    leaseUntilValue: string,
  ): Promise<boolean> {
    const at = new Date(atValue);
    const leaseUntil = new Date(leaseUntilValue);
    if (leaseUntil.getTime() <= at.getTime()) throw new RangeError('leaseUntil must occur after at.');
    const result = await this.database
      .updateTable('jobs')
      .set({ heartbeat_at: at, lease_expires_at: leaseUntil })
      .where('id', '=', id)
      .where('state', '=', 'running')
      .where('lease_owner', '=', workerId)
      .where('lease_expires_at', '>', at)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async complete(
    id: string,
    workerId: string,
    completedAtValue: string,
    resultValue: unknown,
  ): Promise<boolean> {
    const result = await this.database
      .updateTable('jobs')
      .set({
        state: 'completed',
        result: resultValue,
        completed_at: new Date(completedAtValue),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        failure_category: null,
      })
      .where('id', '=', id)
      .where('state', '=', 'running')
      .where('lease_owner', '=', workerId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async fail(
    id: string,
    workerId: string,
    failedAtValue: string,
    failure: JobFailure,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom('jobs')
        .select(['attempts', 'max_attempts'])
        .where('id', '=', id)
        .where('state', '=', 'running')
        .where('lease_owner', '=', workerId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return false;
      const retry = failure.retryAt !== undefined && current.attempts < current.max_attempts;
      const result = await transaction
        .updateTable('jobs')
        .set({
          state: retry ? 'queued' : 'failed',
          available_at: retry ? new Date(failure.retryAt as string) : new Date(failedAtValue),
          completed_at: retry ? null : new Date(failedAtValue),
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          failure_category: failure.category,
        })
        .where('id', '=', id)
        .where('state', '=', 'running')
        .where('lease_owner', '=', workerId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    });
  }
}
