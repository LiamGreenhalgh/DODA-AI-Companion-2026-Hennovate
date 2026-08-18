import {
  CANONICAL_EVENT_IDENTITY_VERSION,
  eventContentEquals,
  eventsEligibleForArchival,
  instantFromReference,
  updateRetentionDays,
  type EventRecord,
  type ProvenanceRecord,
  type RetentionSettingUpdate,
} from '@delaware-scene/domain';

export type EventIngestionAction = 'created' | 'updated' | 'duplicate';

export interface EventIngestionObservation {
  event: EventRecord;
  payloadDigest: string;
  adapterKey: string;
  adapterVersion: string;
  extractionFormat: string;
  runId?: string | null;
}

export interface EventIngestionHistoryRecord {
  eventId: string;
  provenanceKey: string;
  sourceRecordId: string;
  sourceUrl: string;
  sourceSuppliedId: string | null;
  retrievedAt: string;
  payloadDigest: string;
  adapterKey: string;
  adapterVersion: string;
  extractionFormat: string;
  runId: string | null;
  action: EventIngestionAction;
}

export interface EventIngestionResult {
  action: EventIngestionAction;
  event: EventRecord;
  provenanceCreated: number;
  historyCreated: number;
}

export interface EventIngestionRepository {
  list(): Promise<EventRecord[]>;
  findById(id: string): Promise<EventRecord | null>;
  upsertNormalizedEvent(observation: EventIngestionObservation): Promise<EventIngestionResult>;
  listIngestionHistory(eventId?: string): Promise<EventIngestionHistoryRecord[]>;
}

export interface RetentionSettingsRepository {
  getRetentionDays(): Promise<number>;
  updateRetentionDays(proposed: unknown, updatedBy: string): Promise<RetentionSettingUpdate>;
}

export interface ArchivalEligibilityRepository {
  listEligibleForArchival(openedAt: string, retentionDays: number): Promise<EventRecord[]>;
}

export const ARCHIVAL_ELIGIBILITY_JOB_TYPE = 'event-archival-eligibility' as const;
export const ARCHIVAL_ELIGIBILITY_JOB_PAYLOAD_VERSION = 1 as const;

export interface ArchivalEligibilityJobPayload {
  openedAt: string;
}

export interface ArchivalEligibilityJobDefinition {
  type: typeof ARCHIVAL_ELIGIBILITY_JOB_TYPE;
  payloadVersion: typeof ARCHIVAL_ELIGIBILITY_JOB_PAYLOAD_VERSION;
  payload: ArchivalEligibilityJobPayload;
  availableAt: string;
  maxAttempts: number;
  idempotencyKey: string;
}

export interface ArchivalEligibilityJobResult {
  jobType: typeof ARCHIVAL_ELIGIBILITY_JOB_TYPE;
  evaluatedAt: string;
  retentionDays: number;
  eligibleEventIds: string[];
}

function nonBlank(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be blank.`);
}

export function validateEventIngestionObservation(observation: EventIngestionObservation): void {
  nonBlank(observation.event.id, 'event.id');
  if (observation.event.identityVersion !== CANONICAL_EVENT_IDENTITY_VERSION) {
    throw new TypeError('Unsupported canonical event identity version.');
  }
  if (!/^[0-9a-f]{64}$/u.test(observation.event.canonicalIdentity)) {
    throw new TypeError('Canonical event identity must be a lowercase SHA-256 digest.');
  }
  if (!/^[0-9a-f]{64}$/u.test(observation.payloadDigest)) {
    throw new TypeError('Payload digest must be a lowercase SHA-256 digest.');
  }
  nonBlank(observation.adapterKey, 'adapterKey');
  nonBlank(observation.adapterVersion, 'adapterVersion');
  nonBlank(observation.extractionFormat, 'extractionFormat');
  if (observation.event.provenance.length === 0) {
    throw new TypeError('A normalized event must have associated provenance.');
  }
  if (observation.event.occurrences.length === 0) {
    throw new TypeError('A normalized event must have at least one occurrence.');
  }
  for (const provenance of observation.event.provenance) {
    nonBlank(provenance.sourceRecordId, 'provenance.sourceRecordId');
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(provenance.sourceUrl);
    } catch {
      throw new TypeError('Provenance source URL must be an absolute HTTP or HTTPS URL.');
    }
    if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
      throw new TypeError('Provenance source URL must use HTTP or HTTPS.');
    }
    try {
      instantFromReference(provenance.retrievedAt);
    } catch {
      throw new TypeError('Provenance retrieval time must be a timestamp with an explicit offset.');
    }
  }
}

export function provenanceObservationKey(
  provenance: ProvenanceRecord,
  payloadDigest: string,
  eventId = '',
): string {
  return JSON.stringify([
    eventId,
    provenance.sourceRecordId,
    provenance.sourceUrl,
    provenance.sourceSuppliedId,
    instantFromReference(provenance.retrievedAt).toString(),
    payloadDigest,
  ]);
}

function provenanceValueKey(provenance: ProvenanceRecord): string {
  return JSON.stringify([
    provenance.sourceRecordId,
    provenance.sourceUrl,
    provenance.sourceSuppliedId,
    instantFromReference(provenance.retrievedAt).toString(),
  ]);
}

function mergeProvenance(
  existing: readonly ProvenanceRecord[],
  incoming: readonly ProvenanceRecord[],
): { provenance: ProvenanceRecord[]; created: number } {
  const byKey = new Map<string, ProvenanceRecord>();
  for (const value of existing) {
    const key = provenanceValueKey(value);
    if (!byKey.has(key)) byKey.set(key, structuredClone(value));
  }
  const existingKeys = new Set(byKey.keys());
  for (const value of incoming) {
    const key = provenanceValueKey(value);
    if (!byKey.has(key)) byKey.set(key, structuredClone(value));
  }
  const provenance = [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
  return {
    provenance,
    created: [...byKey.keys()].filter((key) => !existingKeys.has(key)).length,
  };
}

function mergeSameIdentityEvent(existing: EventRecord, incoming: EventRecord): EventRecord {
  if (
    existing.identityVersion !== incoming.identityVersion ||
    existing.canonicalIdentity !== incoming.canonicalIdentity
  ) {
    throw new TypeError('Only events with the same canonical identity can be merged.');
  }
  const merged = mergeProvenance(existing.provenance, incoming.provenance);
  return {
    ...structuredClone(incoming),
    id: existing.id,
    publicationStatus: existing.publicationStatus,
    provenance: merged.provenance,
    version: existing.version + 1,
  };
}

function historyOrder(
  left: EventIngestionHistoryRecord,
  right: EventIngestionHistoryRecord,
): number {
  const time = left.retrievedAt.localeCompare(right.retrievedAt);
  return time !== 0 ? time : left.provenanceKey.localeCompare(right.provenanceKey);
}

export class InMemoryEventIngestionRepository
  implements EventIngestionRepository, ArchivalEligibilityRepository
{
  #events: EventRecord[];
  #history: EventIngestionHistoryRecord[] = [];
  #observationKeys = new Set<string>();
  #writeTail: Promise<void> = Promise.resolve();

  constructor(events: readonly EventRecord[] = []) {
    const identities = new Set<string>();
    const ids = new Set<string>();
    for (const event of events) {
      const identityKey = `${event.identityVersion}:${event.canonicalIdentity}`;
      if (identities.has(identityKey)) throw new TypeError('Initial events contain a duplicate identity.');
      if (ids.has(event.id)) throw new TypeError('Initial events contain a duplicate stable ID.');
      identities.add(identityKey);
      ids.add(event.id);
    }
    this.#events = events.map((event) => structuredClone(event));
  }

  async list(): Promise<EventRecord[]> {
    await this.#writeTail;
    return structuredClone([...this.#events].sort((left, right) => left.id.localeCompare(right.id)));
  }

  async findById(id: string): Promise<EventRecord | null> {
    await this.#writeTail;
    const event = this.#events.find((candidate) => candidate.id === id);
    return event ? structuredClone(event) : null;
  }

  async listIngestionHistory(eventId?: string): Promise<EventIngestionHistoryRecord[]> {
    await this.#writeTail;
    const selected =
      eventId === undefined
        ? this.#history
        : this.#history.filter((record) => record.eventId === eventId);
    return structuredClone([...selected].sort(historyOrder));
  }

  async listEligibleForArchival(openedAt: string, retentionDays: number): Promise<EventRecord[]> {
    return eventsEligibleForArchival(await this.list(), openedAt, retentionDays);
  }

  async upsertNormalizedEvent(
    observation: EventIngestionObservation,
  ): Promise<EventIngestionResult> {
    validateEventIngestionObservation(observation);
    return this.serializedWrite(() => {
      const events = structuredClone(this.#events);
      const history = structuredClone(this.#history);
      const observationKeys = new Set(this.#observationKeys);
      const incoming = structuredClone(observation.event);
      const canonicalIncomingProvenance = mergeProvenance([], incoming.provenance);
      incoming.provenance = canonicalIncomingProvenance.provenance;
      const identityIndex = events.findIndex(
        (event) =>
          event.identityVersion === incoming.identityVersion &&
          event.canonicalIdentity === incoming.canonicalIdentity,
      );
      const idIndex = events.findIndex((event) => event.id === incoming.id);
      if (idIndex >= 0 && idIndex !== identityIndex) {
        throw new TypeError('Stable event ID is already assigned to a different canonical identity.');
      }

      const existing = identityIndex >= 0 ? events[identityIndex] : undefined;
      const retainedId = existing?.id ?? incoming.id;
      const incomingObservationKeys = incoming.provenance.map((provenance) =>
        provenanceObservationKey(provenance, observation.payloadDigest, retainedId),
      );
      if (
        existing &&
        incomingObservationKeys.every((provenanceKey) => observationKeys.has(provenanceKey))
      ) {
        return {
          action: 'duplicate',
          event: structuredClone(existing),
          provenanceCreated: 0,
          historyCreated: 0,
        };
      }

      let action: EventIngestionAction;
      let retained: EventRecord;
      let provenanceCreated: number;
      if (!existing) {
        action = 'created';
        retained = {
          ...incoming,
          publicationStatus: 'pending',
          version: 1,
        };
        provenanceCreated = canonicalIncomingProvenance.created;
        events.push(retained);
      } else {
        const merged = mergeProvenance(existing.provenance, incoming.provenance);
        if (eventContentEquals(existing, incoming)) {
          action = 'duplicate';
          retained = { ...existing, provenance: merged.provenance };
        } else {
          action = 'updated';
          retained = mergeSameIdentityEvent(existing, incoming);
        }
        provenanceCreated = merged.created;
        events[identityIndex] = retained;
      }

      let historyCreated = 0;
      for (const provenance of incoming.provenance) {
        const provenanceKey = provenanceObservationKey(
          provenance,
          observation.payloadDigest,
          retained.id,
        );
        if (observationKeys.has(provenanceKey)) continue;
        observationKeys.add(provenanceKey);
        history.push({
          eventId: retained.id,
          provenanceKey,
          sourceRecordId: provenance.sourceRecordId,
          sourceUrl: provenance.sourceUrl,
          sourceSuppliedId: provenance.sourceSuppliedId,
          retrievedAt: instantFromReference(provenance.retrievedAt).toString(),
          payloadDigest: observation.payloadDigest,
          adapterKey: observation.adapterKey,
          adapterVersion: observation.adapterVersion,
          extractionFormat: observation.extractionFormat,
          runId: observation.runId ?? null,
          action,
        });
        historyCreated += 1;
      }

      this.#events = events;
      this.#history = history;
      this.#observationKeys = observationKeys;
      return {
        action,
        event: structuredClone(retained),
        provenanceCreated,
        historyCreated,
      };
    });
  }

  private async serializedWrite<T>(work: () => T): Promise<T> {
    const predecessor = this.#writeTail;
    let release: (() => void) | undefined;
    this.#writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return work();
    } finally {
      release?.();
    }
  }
}

export class InMemoryRetentionSettingsRepository implements RetentionSettingsRepository {
  #retentionDays: number;

  constructor(initialRetentionDays = 365) {
    const initial = updateRetentionDays(0, initialRetentionDays);
    if (!initial.accepted) throw new RangeError(initial.errors[0]?.message);
    this.#retentionDays = initial.value;
  }

  async getRetentionDays(): Promise<number> {
    return this.#retentionDays;
  }

  async updateRetentionDays(proposed: unknown, _updatedBy: string): Promise<RetentionSettingUpdate> {
    const result = updateRetentionDays(this.#retentionDays, proposed);
    if (result.accepted) this.#retentionDays = result.value;
    return structuredClone(result);
  }
}

export function createArchivalEligibilityJob(
  openedAt: string,
  availableAt = openedAt,
): ArchivalEligibilityJobDefinition {
  const normalizedOpenedAt = instantFromReference(openedAt).toString();
  return {
    type: ARCHIVAL_ELIGIBILITY_JOB_TYPE,
    payloadVersion: ARCHIVAL_ELIGIBILITY_JOB_PAYLOAD_VERSION,
    payload: { openedAt: normalizedOpenedAt },
    availableAt: instantFromReference(availableAt).toString(),
    maxAttempts: 3,
    idempotencyKey: `${ARCHIVAL_ELIGIBILITY_JOB_TYPE}:v1:${normalizedOpenedAt}`,
  };
}

export class ArchivalEligibilityService {
  constructor(
    private readonly events: ArchivalEligibilityRepository,
    private readonly settings: RetentionSettingsRepository,
  ) {}

  async listEligible(openedAt: string): Promise<EventRecord[]> {
    const evaluatedAt = instantFromReference(openedAt).toString();
    const retentionDays = await this.settings.getRetentionDays();
    return this.events.listEligibleForArchival(evaluatedAt, retentionDays);
  }

  async runJob(openedAt: string): Promise<ArchivalEligibilityJobResult> {
    const evaluatedAt = instantFromReference(openedAt).toString();
    const retentionDays = await this.settings.getRetentionDays();
    const eligible = await this.events.listEligibleForArchival(evaluatedAt, retentionDays);
    return {
      jobType: ARCHIVAL_ELIGIBILITY_JOB_TYPE,
      evaluatedAt,
      retentionDays,
      eligibleEventIds: eligible.map((event) => event.id).sort((left, right) => left.localeCompare(right)),
    };
  }
}

export class ArchivalEligibilityJobHandler {
  constructor(private readonly service: ArchivalEligibilityService) {}

  async handle(payloadVersion: number, payload: unknown): Promise<ArchivalEligibilityJobResult> {
    if (payloadVersion !== ARCHIVAL_ELIGIBILITY_JOB_PAYLOAD_VERSION) {
      throw new TypeError('Unsupported archival eligibility job payload version.');
    }
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as { openedAt?: unknown }).openedAt !== 'string'
    ) {
      throw new TypeError('Archival eligibility job payload must contain openedAt.');
    }
    return this.service.runJob((payload as ArchivalEligibilityJobPayload).openedAt);
  }
}
