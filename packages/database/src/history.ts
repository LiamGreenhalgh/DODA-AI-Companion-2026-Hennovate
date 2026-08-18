import type { Kysely } from 'kysely';
import type {
  AuditWriter,
  EventRevisionInput,
  NewAuditRecord,
  RevisionWriter,
  SourceStateRevisionInput,
  TransactionContext,
} from '@delaware-scene/application';
import { databaseExecutor } from './postgres.js';
import type { DatabaseSchema } from './schema.js';

function sameAudit(
  existing: {
    editor_identity: string;
    action_type: string;
    target_type: string;
    target_identifier: string;
    action_timestamp: Date | string;
  },
  requested: NewAuditRecord,
): boolean {
  const timestamp =
    existing.action_timestamp instanceof Date
      ? existing.action_timestamp.toISOString()
      : new Date(existing.action_timestamp).toISOString();
  return (
    existing.editor_identity === requested.actorIdentity &&
    existing.action_type === requested.actionType &&
    existing.target_type === requested.targetType &&
    existing.target_identifier === requested.targetIdentifier &&
    timestamp === new Date(requested.actionTimestamp).toISOString()
  );
}

export class PostgresAuditWriter implements AuditWriter {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async insert(
    transaction: TransactionContext,
    record: NewAuditRecord,
  ): Promise<'created' | 'replayed'> {
    const database = databaseExecutor(this.database, transaction);
    const inserted = await database
      .insertInto('audit_records')
      .values({
        id: record.id,
        editor_identity: record.actorIdentity,
        action_type: record.actionType,
        target_type: record.targetType,
        target_identifier: record.targetIdentifier,
        action_timestamp: new Date(record.actionTimestamp),
        correlation_id: record.correlationId ?? null,
        idempotency_key: record.idempotencyKey ?? null,
        safe_metadata: record.safeMetadata ?? {},
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return 'created';
    const existing = await database
      .selectFrom('audit_records')
      .select([
        'editor_identity',
        'action_type',
        'target_type',
        'target_identifier',
        'action_timestamp',
      ])
      .where('id', '=', record.id)
      .executeTakeFirstOrThrow();
    if (!sameAudit(existing, record)) {
      throw new Error('Audit identifier was replayed with different immutable content.');
    }
    return 'replayed';
  }
}

export class PostgresRevisionWriter implements RevisionWriter {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async appendSourceState(
    transaction: TransactionContext,
    revision: SourceStateRevisionInput,
  ): Promise<string> {
    const row = await databaseExecutor(this.database, transaction)
      .insertInto('source_state_revisions')
      .values({
        source_record_id: revision.sourceRecordId,
        preceding_state: revision.precedingState,
        selected_state: revision.selectedState,
        editor_identity: revision.editorIdentity,
        action_timestamp: new Date(revision.actionTimestamp),
        audit_id: revision.auditId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async appendEvent(
    transaction: TransactionContext,
    revision: EventRevisionInput,
  ): Promise<string> {
    const row = await databaseExecutor(this.database, transaction)
      .insertInto('event_revisions')
      .values({
        event_id: revision.eventId,
        field_name: revision.fieldName,
        source_supplied_value: revision.sourceSuppliedValue,
        preceding_value: revision.precedingValue,
        selected_value: revision.selectedValue,
        editor_identity: revision.editorIdentity,
        action_timestamp: new Date(revision.actionTimestamp),
        reason: revision.reason ?? null,
        audit_id: revision.auditId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
}
