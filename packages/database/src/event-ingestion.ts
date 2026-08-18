import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import {
  provenanceObservationKey,
  validateEventIngestionObservation,
  type EventIngestionAction,
  type EventIngestionHistoryRecord,
  type EventIngestionObservation,
  type EventIngestionRepository,
  type EventIngestionResult,
} from '@delaware-scene/application';
import {
  eventContentEquals,
  type EventOccurrence,
  type EventRecord,
  type ProvenanceRecord,
  type ValidationIssue,
} from '@delaware-scene/domain';
import { PostgresEventRepository } from './postgres.js';
import type {
  DatabaseSchema,
  EventOccurrencesTable,
  EventRecordsTable,
  EventValidationIssuesTable,
} from './schema.js';

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
    second: '2-digit',
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
    localTime:
      row.source_local_start_time?.replace(/(?:\.\d+)?$/u, '') ??
      `${part('hour')}:${part('minute')}:${part('second')}`,
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
    ...(row.original_start !== null || row.original_end !== null
      ? { rejectedValue: { start: row.original_start, end: row.original_end } }
      : {}),
  };
}

function provenanceValueKey(value: ProvenanceRecord): string {
  return JSON.stringify([
    value.sourceRecordId,
    value.sourceUrl,
    value.sourceSuppliedId,
    timestamp(value.retrievedAt),
  ]);
}

function distinctProvenance(values: readonly ProvenanceRecord[]): ProvenanceRecord[] {
  const byKey = new Map<string, ProvenanceRecord>();
  for (const value of values) {
    const normalized = { ...value, retrievedAt: timestamp(value.retrievedAt) };
    const key = provenanceValueKey(normalized);
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

async function hydrate(
  transaction: Transaction<DatabaseSchema>,
  row: Selectable<EventRecordsTable>,
): Promise<EventRecord> {
  const [occurrences, provenanceRows, validationRows] = await Promise.all([
    transaction
      .selectFrom('event_occurrences')
      .selectAll()
      .where('event_id', '=', row.id)
      .orderBy('ordinal', 'asc')
      .execute(),
    transaction
      .selectFrom('event_provenance')
      .select(['source_record_id', 'source_url', 'source_supplied_id', 'retrieved_at'])
      .where('event_id', '=', row.id)
      .orderBy('retrieved_at', 'asc')
      .execute(),
    transaction
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
  const provenance = distinctProvenance(
    provenanceRows.map((value) => ({
      sourceRecordId: value.source_record_id,
      sourceUrl: value.source_url,
      sourceSuppliedId: value.source_supplied_id,
      retrievedAt: timestamp(value.retrieved_at),
    })),
  );
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

function insertValues(event: EventRecord) {
  return {
    id: event.id,
    identity_version: event.identityVersion,
    canonical_identity: event.canonicalIdentity,
    organization_profile_id: null,
    title: event.title,
    description: event.description,
    category_values: [...event.categories],
    organization_name: event.organization,
    venue_name: event.venue,
    city: event.city,
    region: event.region,
    cost_text: event.cost,
    audience_text: event.audience,
    accessibility_text: event.accessibility,
    address_json: event.address,
    latitude: event.coordinates?.latitude.toString() ?? null,
    longitude: event.coordinates?.longitude.toString() ?? null,
    online_location_url: event.onlineLocationUrl,
    public_source_url: event.publicSourceUrl,
    ticket_url: event.ticketUrl,
    registration_url: event.registrationUrl,
    source_category: event.sourceCategory,
    publication_status: event.publicationStatus,
    validation_state: event.validationIssues.length > 0 ? ('needs-review' as const) : ('valid' as const),
    public_attribution: event.attribution,
    rights_notice: event.rightsNotice,
    version: event.version,
  };
}

function updateValues(event: EventRecord) {
  const values = insertValues(event);
  return {
    title: values.title,
    description: values.description,
    category_values: values.category_values,
    organization_name: values.organization_name,
    venue_name: values.venue_name,
    city: values.city,
    region: values.region,
    cost_text: values.cost_text,
    audience_text: values.audience_text,
    accessibility_text: values.accessibility_text,
    address_json: values.address_json,
    latitude: values.latitude,
    longitude: values.longitude,
    online_location_url: values.online_location_url,
    public_source_url: values.public_source_url,
    ticket_url: values.ticket_url,
    registration_url: values.registration_url,
    source_category: values.source_category,
    validation_state: values.validation_state,
    public_attribution: values.public_attribution,
    rights_notice: values.rights_notice,
    updated_at: new Date(),
    version: sql<number>`version + 1`,
  };
}

async function replaceOccurrencesAndIssues(
  transaction: Transaction<DatabaseSchema>,
  event: EventRecord,
): Promise<void> {
  await transaction.deleteFrom('event_occurrences').where('event_id', '=', event.id).execute();
  await transaction.deleteFrom('event_validation_issues').where('event_id', '=', event.id).execute();
  if (event.occurrences.length > 0) {
    await transaction
      .insertInto('event_occurrences')
      .values(
        event.occurrences.map((occurrence, ordinal) => ({
          id: occurrence.id,
          event_id: event.id,
          ordinal,
          time_kind: occurrence.kind,
          start_date: occurrence.kind === 'date' ? occurrence.startDate : null,
          end_date: occurrence.kind === 'date' ? occurrence.endDate : null,
          start_at: occurrence.kind === 'instant' ? new Date(occurrence.startAt) : null,
          end_at:
            occurrence.kind === 'instant' && occurrence.endAt !== null
              ? new Date(occurrence.endAt)
              : null,
          source_timezone: occurrence.kind === 'instant' ? occurrence.sourceTimezone : null,
          source_local_start_time: occurrence.kind === 'instant' ? occurrence.localTime : null,
          original_start: occurrence.originalStart,
          original_end: occurrence.originalEnd,
        })),
      )
      .execute();
  }
  if (event.validationIssues.length > 0) {
    await transaction
      .insertInto('event_validation_issues')
      .values(
        event.validationIssues.map((issue) => {
          const rejected =
            issue.rejectedValue &&
            typeof issue.rejectedValue === 'object' &&
            !Array.isArray(issue.rejectedValue)
              ? (issue.rejectedValue as Record<string, unknown>)
              : {};
          return {
            event_id: event.id,
            issue_code: issue.code,
            field_name: issue.path,
            safe_message: issue.message,
            original_start: typeof rejected.start === 'string' ? rejected.start : null,
            original_end: typeof rejected.end === 'string' ? rejected.end : null,
            resolution_state: 'open' as const,
          };
        }),
      )
      .execute();
  }
}

async function findProvenanceId(
  transaction: Transaction<DatabaseSchema>,
  eventId: string,
  provenance: ProvenanceRecord,
  payloadDigest: string,
): Promise<string | null> {
  const retrievedAt = new Date(provenance.retrievedAt);
  let query = transaction
    .selectFrom('event_provenance')
    .select('id')
    .where('event_id', '=', eventId)
    .where('source_record_id', '=', provenance.sourceRecordId)
    .where('source_url', '=', provenance.sourceUrl)
    .where('retrieved_at', '=', retrievedAt)
    .where('payload_digest', '=', payloadDigest);
  query =
    provenance.sourceSuppliedId === null
      ? query.where('source_supplied_id', 'is', null)
      : query.where('source_supplied_id', '=', provenance.sourceSuppliedId);
  return (await query.executeTakeFirst())?.id ?? null;
}

async function observationExists(
  transaction: Transaction<DatabaseSchema>,
  eventId: string,
  provenance: ProvenanceRecord,
  payloadDigest: string,
): Promise<boolean> {
  const provenanceId = await findProvenanceId(
    transaction,
    eventId,
    provenance,
    payloadDigest,
  );
  if (!provenanceId) return false;
  const history = await transaction
    .selectFrom('event_ingestion_history')
    .select('id')
    .where('event_id', '=', eventId)
    .where('provenance_id', '=', provenanceId)
    .where('retrieved_at', '=', new Date(provenance.retrievedAt))
    .where('payload_digest', '=', payloadDigest)
    .executeTakeFirst();
  return history !== undefined;
}

export class PostgresEventIngestionRepository implements EventIngestionRepository {
  readonly #reader: PostgresEventRepository;

  constructor(private readonly database: Kysely<DatabaseSchema>) {
    this.#reader = new PostgresEventRepository(database);
  }

  list(): Promise<EventRecord[]> {
    return this.#reader.list();
  }

  findById(id: string): Promise<EventRecord | null> {
    return this.#reader.findById(id);
  }

  async upsertNormalizedEvent(
    observation: EventIngestionObservation,
  ): Promise<EventIngestionResult> {
    validateEventIngestionObservation(observation);
    const persisted = await this.database.transaction().execute(async (transaction) => {
      const incoming = structuredClone(observation.event);
      incoming.provenance = distinctProvenance(incoming.provenance);
      incoming.publicationStatus = 'pending';
      incoming.version = 1;
      const created = await transaction
        .insertInto('event_records')
        .values(insertValues(incoming))
        .onConflict((conflict) =>
          conflict.columns(['identity_version', 'canonical_identity']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();

      let eventId: string;
      let action: EventIngestionAction;
      if (created) {
        eventId = created.id;
        action = 'created';
        await replaceOccurrencesAndIssues(transaction, incoming);
      } else {
        const row = await transaction
          .selectFrom('event_records')
          .selectAll()
          .where('identity_version', '=', incoming.identityVersion)
          .where('canonical_identity', '=', incoming.canonicalIdentity)
          .forUpdate()
          .executeTakeFirstOrThrow();
        eventId = row.id;
        const replayed = await Promise.all(
          incoming.provenance.map((provenance) =>
            observationExists(
              transaction,
              eventId,
              provenance,
              observation.payloadDigest,
            ),
          ),
        );
        if (replayed.every(Boolean)) {
          return {
            eventId,
            action: 'duplicate' as const,
            provenanceCreated: 0,
            historyCreated: 0,
          };
        }

        const existing = await hydrate(transaction, row);
        if (eventContentEquals(existing, incoming)) {
          action = 'duplicate';
        } else {
          action = 'updated';
          const retained = {
            ...incoming,
            id: eventId,
            publicationStatus: row.publication_status,
          };
          await transaction
            .updateTable('event_records')
            .set(updateValues(retained))
            .where('id', '=', eventId)
            .executeTakeFirstOrThrow();
          await replaceOccurrencesAndIssues(transaction, retained);
          if (row.publication_status === 'published') {
            await transaction
              .updateTable('public_data_revision')
              .set({ revision: sql<string>`revision + 1` })
              .where('singleton', '=', true)
              .executeTakeFirstOrThrow();
          }
        }
      }

      let provenanceCreated = 0;
      let historyCreated = 0;
      for (const provenance of incoming.provenance) {
        const retrievedAt = new Date(provenance.retrievedAt);
        const insertedProvenance = await transaction
          .insertInto('event_provenance')
          .values({
            event_id: eventId,
            source_record_id: provenance.sourceRecordId,
            source_url: provenance.sourceUrl,
            source_supplied_id: provenance.sourceSuppliedId,
            retrieved_at: retrievedAt,
            payload_digest: observation.payloadDigest,
            adapter_key: observation.adapterKey,
            adapter_version: observation.adapterVersion,
            extraction_format: observation.extractionFormat,
          })
          .onConflict((conflict) =>
            conflict
              .columns([
                'event_id',
                'source_record_id',
                'source_url',
                'retrieved_at',
                'payload_digest',
              ])
              .doNothing(),
          )
          .returning('id')
          .executeTakeFirst();
        const existingProvenanceId =
          insertedProvenance?.id ??
          (await findProvenanceId(
            transaction,
            eventId,
            provenance,
            observation.payloadDigest,
          ));
        if (!existingProvenanceId) {
          throw new Error(
            'A provenance observation key was replayed with different immutable content.',
          );
        }
        if (insertedProvenance) provenanceCreated += 1;
        const insertedHistory = await transaction
          .insertInto('event_ingestion_history')
          .values({
            event_id: eventId,
            provenance_id: existingProvenanceId,
            run_id: observation.runId ?? null,
            retrieved_at: retrievedAt,
            payload_digest: observation.payloadDigest,
            action,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['event_id', 'provenance_id', 'retrieved_at', 'payload_digest'])
              .doNothing(),
          )
          .returning('id')
          .executeTakeFirst();
        if (insertedHistory) historyCreated += 1;
      }
      return { eventId, action, provenanceCreated, historyCreated };
    });
    const event = await this.findById(persisted.eventId);
    if (!event) throw new Error('Committed event could not be reloaded.');
    return { ...persisted, event };
  }

  async listIngestionHistory(eventId?: string): Promise<EventIngestionHistoryRecord[]> {
    let query = this.database
      .selectFrom('event_ingestion_history')
      .innerJoin('event_provenance', 'event_provenance.id', 'event_ingestion_history.provenance_id')
      .select([
        'event_ingestion_history.event_id as event_id',
        'event_ingestion_history.run_id as run_id',
        'event_ingestion_history.retrieved_at as retrieved_at',
        'event_ingestion_history.payload_digest as payload_digest',
        'event_ingestion_history.action as action',
        'event_provenance.source_record_id as source_record_id',
        'event_provenance.source_url as source_url',
        'event_provenance.source_supplied_id as source_supplied_id',
        'event_provenance.adapter_key as adapter_key',
        'event_provenance.adapter_version as adapter_version',
        'event_provenance.extraction_format as extraction_format',
      ])
      .orderBy('event_ingestion_history.retrieved_at', 'asc')
      .orderBy('event_ingestion_history.id', 'asc');
    if (eventId !== undefined) query = query.where('event_ingestion_history.event_id', '=', eventId);
    const rows = await query.execute();
    return rows.map((row) => {
      const retrievedAt = timestamp(row.retrieved_at);
      const provenance: ProvenanceRecord = {
        sourceRecordId: row.source_record_id,
        sourceUrl: row.source_url,
        sourceSuppliedId: row.source_supplied_id,
        retrievedAt,
      };
      return {
        eventId: row.event_id,
        provenanceKey: provenanceObservationKey(provenance, row.payload_digest, row.event_id),
        sourceRecordId: provenance.sourceRecordId,
        sourceUrl: provenance.sourceUrl,
        sourceSuppliedId: provenance.sourceSuppliedId,
        retrievedAt,
        payloadDigest: row.payload_digest,
        adapterKey: row.adapter_key,
        adapterVersion: row.adapter_version,
        extractionFormat: row.extraction_format,
        runId: row.run_id,
        action: row.action,
      };
    });
  }
}
