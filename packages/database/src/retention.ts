import { sql, type Kysely } from 'kysely';
import type {
  ArchivalEligibilityRepository,
  RetentionSettingsRepository,
} from '@delaware-scene/application';
import {
  DELAWARE_TIME_ZONE,
  instantFromReference,
  isEventArchiveEligible,
  updateRetentionDays as decideRetentionDaysUpdate,
  type EventRecord,
  type RetentionSettingUpdate,
} from '@delaware-scene/domain';
import { PostgresEventRepository } from './postgres.js';
import type { DatabaseSchema } from './schema.js';

const RETENTION_SETTING_KEY = 'retentionDays';
const RETENTION_SETTING_LOCK_KEY = `runtime_settings:${RETENTION_SETTING_KEY}`;

function persistedRetentionDays(value: unknown): number {
  const decision = decideRetentionDaysUpdate(0, value);
  if (!decision.accepted) {
    throw new Error('Persisted retentionDays setting is invalid.');
  }
  return decision.value;
}

export class PostgresRetentionSettingsRepository implements RetentionSettingsRepository {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly defaultRetentionDays = 365,
    private readonly now: () => Date = () => new Date(),
  ) {
    persistedRetentionDays(defaultRetentionDays);
  }

  async getRetentionDays(): Promise<number> {
    const row = await this.database
      .selectFrom('runtime_settings')
      .select('value_json')
      .where('setting_key', '=', RETENTION_SETTING_KEY)
      .executeTakeFirst();
    return row ? persistedRetentionDays(row.value_json) : this.defaultRetentionDays;
  }

  async updateRetentionDays(
    proposed: unknown,
    updatedBy: string,
  ): Promise<RetentionSettingUpdate> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`
        SELECT pg_advisory_xact_lock(hashtext(${RETENTION_SETTING_LOCK_KEY})::bigint)
      `.execute(transaction);
      const row = await transaction
        .selectFrom('runtime_settings')
        .select(['value_json', 'version'])
        .where('setting_key', '=', RETENTION_SETTING_KEY)
        .forUpdate()
        .executeTakeFirst();
      const current = row ? persistedRetentionDays(row.value_json) : this.defaultRetentionDays;
      const decision = decideRetentionDaysUpdate(current, proposed);
      if (!decision.accepted) return decision;

      if (row) {
        const result = await transaction
          .updateTable('runtime_settings')
          .set({
            value_json: decision.value,
            version: sql<number>`version + 1`,
            updated_by: updatedBy,
            updated_at: this.now(),
          })
          .where('setting_key', '=', RETENTION_SETTING_KEY)
          .where('version', '=', row.version)
          .executeTakeFirst();
        if (Number(result.numUpdatedRows) !== 1) {
          throw new Error('Retention setting changed while its row lock was held.');
        }
      } else {
        await transaction
          .insertInto('runtime_settings')
          .values({
            setting_key: RETENTION_SETTING_KEY,
            value_json: decision.value,
            updated_by: updatedBy,
            updated_at: this.now(),
          })
          .executeTakeFirstOrThrow();
      }
      return decision;
    });
  }
}

export class PostgresArchivalEligibilityRepository
  implements ArchivalEligibilityRepository
{
  readonly #events: PostgresEventRepository;

  constructor(private readonly database: Kysely<DatabaseSchema>) {
    this.#events = new PostgresEventRepository(database);
  }

  async listEligibleForArchival(
    openedAtValue: string,
    retentionDaysValue: number,
  ): Promise<EventRecord[]> {
    const evaluatedAt = instantFromReference(openedAtValue).toString();
    const retentionDays = persistedRetentionDays(retentionDaysValue);
    const rows = await this.database
      .selectFrom('event_records as candidate')
      .select('candidate.id')
      .where('candidate.publication_status', '=', 'published')
      .where(
        sql<boolean>`EXISTS (
          SELECT 1
          FROM event_occurrences AS occurrence
          WHERE occurrence.event_id = candidate.id
        )`,
      )
      .where(
        sql<boolean>`NOT EXISTS (
          SELECT 1
          FROM event_occurrences AS occurrence
          WHERE occurrence.event_id = candidate.id
            AND (
              (
                occurrence.time_kind = 'date'
                AND (
                  COALESCE(occurrence.end_date, occurrence.start_date)
                  + CAST(${retentionDays} AS integer)
                ) >= (
                  CAST(${evaluatedAt} AS timestamptz)
                  AT TIME ZONE ${DELAWARE_TIME_ZONE}
                )::date
              )
              OR
              (
                occurrence.time_kind = 'instant'
                AND (
                  COALESCE(occurrence.end_at, occurrence.start_at)
                  + CAST(${retentionDays} AS integer) * INTERVAL '1 day'
                ) > CAST(${evaluatedAt} AS timestamptz)
              )
            )
        )`,
      )
      .orderBy('candidate.id', 'asc')
      .execute();

    const hydrated = await Promise.all(rows.map(({ id }) => this.#events.findById(id)));
    return hydrated.filter(
      (event): event is EventRecord =>
        event !== null && isEventArchiveEligible(event, evaluatedAt, retentionDays),
    );
  }
}
