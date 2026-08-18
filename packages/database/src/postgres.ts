import { Kysely, PostgresDialect, sql, type Selectable, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type {
  AuditRecord,
  ModerationRepository,
  PublicDataRevisionPort,
  TransactionContext,
  TransactionManager,
} from '@delaware-scene/application';
import type {
  EventOccurrence,
  EventRecord,
  PublicationStatus,
  ProvenanceRecord,
  ValidationIssue,
} from '@delaware-scene/domain';
import type {
  AuditRecordsTable,
  DatabaseSchema,
  EventOccurrencesTable,
  EventRecordsTable,
  EventValidationIssuesTable,
} from './schema.js';

export type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export function createPostgresDatabase(connectionString: string): Kysely<DatabaseSchema> {
  const pool = new Pool({ connectionString, max: 10 });
  return new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
}

export class KyselyTransactionContext implements TransactionContext {
  readonly transactionId = Symbol('database-transaction');

  constructor(readonly database: Transaction<DatabaseSchema>) {}
}

export function databaseExecutor(
  fallback: Kysely<DatabaseSchema>,
  transaction?: TransactionContext,
): DatabaseExecutor {
  if (transaction === undefined) return fallback;
  if (!(transaction instanceof KyselyTransactionContext)) {
    throw new TypeError('Transaction context was not created by KyselyTransactionManager.');
  }
  return transaction.database;
}

export class KyselyTransactionManager implements TransactionManager {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  run<T>(work: (transaction: TransactionContext) => Promise<T>): Promise<T> {
    return this.database
      .transaction()
      .execute((transaction) => work(new KyselyTransactionContext(transaction)));
  }
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: Date | string | null): string | null {
  return value === null ? null : timestamp(value);
}

function mapOccurrence(row: Selectable<EventOccurrencesTable>): EventOccurrence {
  if (row.time_kind === 'date') {
    if (!row.start_date) throw new Error('Persisted date occurrence is missing start_date.');
    return {
      id: row.id,
      kind: 'date',
      startDate: row.start_date,
      endDate: row.end_date,
      originalStart: row.original_start,
      originalEnd: row.original_end,
    };
  }
  if (!row.start_at || !row.source_timezone) {
    throw new Error('Persisted instant occurrence is missing start or timezone.');
  }
  const startAt = timestamp(row.start_at);
  const zoned = new Intl.DateTimeFormat('en-CA', {
    timeZone: row.source_timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(startAt));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    zoned.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    id: row.id,
    kind: 'instant',
    startAt,
    endAt: nullableTimestamp(row.end_at),
    sourceTimezone: row.source_timezone,
    localDate: `${part('year')}-${part('month')}-${part('day')}`,
    localTime: row.source_local_start_time?.slice(0, 5) ?? `${part('hour')}:${part('minute')}`,
    originalStart: row.original_start,
    originalEnd: row.original_end,
  };
}

function address(value: unknown | null): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function mapValidationIssue(row: Selectable<EventValidationIssuesTable>): ValidationIssue {
  return {
    path: row.field_name,
    code: row.issue_code,
    message: row.safe_message,
    ...(row.original_start || row.original_end
      ? { rejectedValue: { start: row.original_start, end: row.original_end } }
      : {}),
  };
}

function mapAudit(row: Selectable<AuditRecordsTable>): AuditRecord | null {
  if (!['approve', 'reject', 'archive'].includes(row.action_type)) return null;
  const metadata =
    row.safe_metadata && typeof row.safe_metadata === 'object' && !Array.isArray(row.safe_metadata)
      ? (row.safe_metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    editorIdentity: row.editor_identity,
    action: row.action_type as AuditRecord['action'],
    targetId: row.target_identifier,
    actionTimestamp: timestamp(row.action_timestamp),
    reason: typeof metadata.reason === 'string' ? metadata.reason : null,
  };
}

export class PostgresPublicDataRevision implements PublicDataRevisionPort {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async current(transaction?: TransactionContext): Promise<bigint> {
    const row = await databaseExecutor(this.database, transaction)
      .selectFrom('public_data_revision')
      .select('revision')
      .where('singleton', '=', true)
      .executeTakeFirstOrThrow();
    return BigInt(row.revision);
  }

  async increment(transaction?: TransactionContext): Promise<bigint> {
    const row = await databaseExecutor(this.database, transaction)
      .updateTable('public_data_revision')
      .set({ revision: sql<string>`revision + 1` })
      .where('singleton', '=', true)
      .returning('revision')
      .executeTakeFirstOrThrow();
    return BigInt(row.revision);
  }
}

export class PostgresEventRepository implements ModerationRepository {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async list(): Promise<EventRecord[]> {
    const rows = await this.database
      .selectFrom('event_records')
      .selectAll()
      .orderBy('id', 'asc')
      .execute();
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async findById(id: string): Promise<EventRecord | null> {
    const row = await this.database
      .selectFrom('event_records')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.hydrate(row) : null;
  }

  private async hydrate(
    row: Selectable<EventRecordsTable>,
    database: DatabaseExecutor = this.database,
  ): Promise<EventRecord> {
    const [occurrences, provenanceRows, validationRows] = await Promise.all([
      database
        .selectFrom('event_occurrences')
        .selectAll()
        .where('event_id', '=', row.id)
        .orderBy('ordinal', 'asc')
        .execute(),
      database
        .selectFrom('event_provenance')
        .select(['source_record_id', 'source_url', 'source_supplied_id', 'retrieved_at'])
        .where('event_id', '=', row.id)
        .orderBy('retrieved_at', 'asc')
        .execute(),
      database
        .selectFrom('event_validation_issues')
        .selectAll()
        .where('event_id', '=', row.id)
        .where('resolution_state', '=', 'open')
        .orderBy('created_at', 'asc')
        .execute(),
    ]);
    if (row.identity_version !== 1) {
      throw new Error(`Unsupported persisted canonical identity version: ${row.identity_version}.`);
    }
    const provenanceByValue = new Map<string, ProvenanceRecord>();
    for (const value of provenanceRows) {
      const provenance: ProvenanceRecord = {
        sourceRecordId: value.source_record_id,
        sourceUrl: value.source_url,
        sourceSuppliedId: value.source_supplied_id,
        retrievedAt: timestamp(value.retrieved_at),
      };
      const key = JSON.stringify([
        provenance.sourceRecordId,
        provenance.sourceUrl,
        provenance.sourceSuppliedId,
        provenance.retrievedAt,
      ]);
      if (!provenanceByValue.has(key)) provenanceByValue.set(key, provenance);
    }
    const provenance = [...provenanceByValue.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value);
    return {
      id: row.id,
      canonicalIdentity: row.canonical_identity,
      identityVersion: 1,
      title: row.title,
      description: row.description,
      categories: [...row.category_values],
      organization: row.organization_name,
      venue: row.venue_name,
      city: row.city,
      region: row.region,
      cost: row.cost_text,
      audience: row.audience_text,
      accessibility: row.accessibility_text,
      address: address(row.address_json),
      coordinates:
        row.latitude !== null && row.longitude !== null
          ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
          : null,
      onlineLocationUrl: row.online_location_url,
      publicSourceUrl: row.public_source_url,
      ticketUrl: row.ticket_url,
      registrationUrl: row.registration_url,
      attribution: row.public_attribution,
      rightsNotice: row.rights_notice,
      sourceCategory: row.source_category,
      publicationStatus: row.publication_status,
      occurrences: occurrences.map(mapOccurrence),
      validationIssues: validationRows.map(mapValidationIssue),
      provenance,
      version: row.version,
    };
  }

  async transition(input: {
    eventId: string;
    expectedVersion: number;
    from: PublicationStatus;
    to: PublicationStatus;
    audit: AuditRecord;
  }): Promise<EventRecord | null> {
    return this.database.transaction().execute(async (transaction) => {
      const changed = await transaction
        .updateTable('event_records')
        .set({
          publication_status: input.to,
          version: sql<number>`version + 1`,
          updated_at: new Date(input.audit.actionTimestamp),
        })
        .where('id', '=', input.eventId)
        .where('version', '=', input.expectedVersion)
        .where('publication_status', '=', input.from)
        .returning('id')
        .executeTakeFirst();
      if (!changed) return null;
      await transaction
        .insertInto('audit_records')
        .values({
          id: input.audit.id,
          editor_identity: input.audit.editorIdentity,
          action_type: input.audit.action,
          target_type: 'event',
          target_identifier: input.audit.targetId,
          action_timestamp: new Date(input.audit.actionTimestamp),
          correlation_id: null,
          idempotency_key: null,
          safe_metadata: input.audit.reason ? { reason: input.audit.reason } : {},
        })
        .executeTakeFirstOrThrow();
      if (input.from === 'published' || input.to === 'published') {
        await transaction
          .updateTable('public_data_revision')
          .set({ revision: sql<string>`revision + 1` })
          .where('singleton', '=', true)
          .executeTakeFirstOrThrow();
      }
      const row = await transaction
        .selectFrom('event_records')
        .selectAll()
        .where('id', '=', input.eventId)
        .executeTakeFirstOrThrow();
      return this.hydrate(row, transaction);
    });
  }

  async listAudits(): Promise<AuditRecord[]> {
    const rows = await this.database
      .selectFrom('audit_records')
      .selectAll()
      .where('target_type', '=', 'event')
      .orderBy('action_timestamp', 'asc')
      .execute();
    return rows.map(mapAudit).filter((row): row is AuditRecord => row !== null);
  }
}

export interface VersionedSetting<T> {
  key: string;
  value: T;
  version: number;
}

export class PostgresRuntimeSettingsRepository {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async find<T>(key: string): Promise<VersionedSetting<T> | null> {
    const row = await this.database
      .selectFrom('runtime_settings')
      .select(['setting_key', 'value_json', 'version'])
      .where('setting_key', '=', key)
      .executeTakeFirst();
    return row ? { key: row.setting_key, value: row.value_json as T, version: row.version } : null;
  }

  async compareAndSet<T>(
    key: string,
    expectedVersion: number,
    value: T,
    updatedBy: string,
  ): Promise<VersionedSetting<T> | null> {
    const row = await this.database
      .updateTable('runtime_settings')
      .set({
        value_json: value as unknown,
        version: sql<number>`version + 1`,
        updated_by: updatedBy,
        updated_at: new Date(),
      })
      .where('setting_key', '=', key)
      .where('version', '=', expectedVersion)
      .returning(['setting_key', 'value_json', 'version'])
      .executeTakeFirst();
    return row ? { key: row.setting_key, value: row.value_json as T, version: row.version } : null;
  }
}
