import { describe, expect, it } from 'vitest';
import {
  InMemoryEventIngestionRepository,
  type EventIngestionObservation,
} from '@delaware-scene/application';
import {
  CANONICAL_EVENT_IDENTITY_VERSION,
  normalizeEvent,
  type EventRecord,
  type RawEventCandidate,
  type Result,
} from '@delaware-scene/domain';

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function normalizedEvent(overrides: Partial<RawEventCandidate> = {}): EventRecord {
  return requireSuccess(
    normalizeEvent({
      id: 'event-first',
      sourceRecordId: 'source-stable',
      sourceCategory: 'government',
      sourceUrl: 'https://events.example.org/art-night',
      sourceSuppliedId: 'source-event-1',
      retrievedAt: '2026-08-18T12:00:00Z',
      title: 'Art Night',
      description: 'Initial description',
      venue: 'Main Hall',
      city: 'Dover',
      address: { street: '100 Arts Way', postalCode: '19901' },
      occurrences: [{ id: 'occurrence-first', start: '2026-09-01' }],
      ...overrides,
    }),
  );
}

function observation(
  event: EventRecord,
  payloadDigest = 'a'.repeat(64),
): EventIngestionObservation {
  return {
    event,
    payloadDigest,
    adapterKey: 'fixture-json-ld',
    adapterVersion: '1.0.0',
    extractionFormat: 'json-ld',
    runId: 'run-local-1',
  };
}

describe('versioned canonical event identity integration', () => {
  it('is stable across candidate IDs, Unicode normalization, case, whitespace, and address key order', () => {
    const first = normalizedEvent({
      id: 'candidate-one',
      title: '  CAFÉ\tNight  ',
      address: { street: '100 Arts Way', postalCode: '19901' },
      occurrences: [{ id: 'occurrence-one', start: '2026-09-01' }],
    });
    const equivalent = normalizedEvent({
      id: 'candidate-two',
      title: 'cafe\u0301 night',
      address: { postalCode: '19901', street: '100 Arts Way' },
      occurrences: [{ id: 'occurrence-two', start: '2026-09-01' }],
    });

    expect(first.identityVersion).toBe(CANONICAL_EVENT_IDENTITY_VERSION);
    expect(first.canonicalIdentity).toMatch(/^[0-9a-f]{64}$/u);
    expect(equivalent.canonicalIdentity).toBe(first.canonicalIdentity);
  });

  it('changes when a version-one identity component changes', () => {
    const baseline = normalizedEvent();
    const sourceChanged = normalizedEvent({ sourceRecordId: 'source-other' });
    const occurrenceChanged = normalizedEvent({
      occurrences: [{ id: 'occurrence-other', start: '2026-09-02' }],
    });
    const locationChanged = normalizedEvent({ venue: 'Second Hall' });

    expect(
      new Set([
        baseline.canonicalIdentity,
        sourceChanged.canonicalIdentity,
        occurrenceChanged.canonicalIdentity,
        locationChanged.canonicalIdentity,
      ]).size,
    ).toBe(4);
  });
});

describe('deterministic event ingestion repository', () => {
  it('retains the first stable event ID, unions provenance, and appends new observations once', async () => {
    const repository = new InMemoryEventIngestionRepository();
    const initial = normalizedEvent();
    const created = await repository.upsertNormalizedEvent(observation(initial));
    const changed = normalizedEvent({
      id: 'event-replacement-candidate',
      description: 'Updated description',
      retrievedAt: '2026-08-18T13:00:00Z',
      occurrences: [{ id: 'occurrence-replacement', start: '2026-09-01' }],
    });
    const updated = await repository.upsertNormalizedEvent(
      observation(changed, 'b'.repeat(64)),
    );

    expect(created).toMatchObject({
      action: 'created',
      provenanceCreated: 1,
      historyCreated: 1,
      event: { id: 'event-first', publicationStatus: 'pending', version: 1 },
    });
    expect(updated).toMatchObject({
      action: 'updated',
      provenanceCreated: 1,
      historyCreated: 1,
      event: {
        id: 'event-first',
        description: 'Updated description',
        publicationStatus: 'pending',
        version: 2,
      },
    });
    expect(updated.event.provenance).toHaveLength(2);
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.listIngestionHistory()).map((record) => record.action)).toEqual([
      'created',
      'updated',
    ]);
  });

  it('treats an exact observation replay as immutable even if replayed content conflicts', async () => {
    const repository = new InMemoryEventIngestionRepository();
    const original = normalizedEvent();
    await repository.upsertNormalizedEvent(observation(original));
    const replayWithConflictingContent = {
      ...structuredClone(original),
      description: 'This must not overwrite an already-recorded observation.',
    };

    const replay = await repository.upsertNormalizedEvent(
      observation(replayWithConflictingContent),
    );

    expect(replay).toMatchObject({
      action: 'duplicate',
      provenanceCreated: 0,
      historyCreated: 0,
      event: { description: 'Initial description', version: 1 },
    });
    expect(await repository.listIngestionHistory()).toHaveLength(1);
  });

  it('serializes concurrent same-identity writes into one event with all distinct provenance', async () => {
    const repository = new InMemoryEventIngestionRepository();
    const first = normalizedEvent({ id: 'event-concurrent-a' });
    const second = normalizedEvent({
      id: 'event-concurrent-b',
      retrievedAt: '2026-08-18T12:01:00Z',
      occurrences: [{ id: 'occurrence-concurrent-b', start: '2026-09-01' }],
    });

    const results = await Promise.all([
      repository.upsertNormalizedEvent(observation(first)),
      repository.upsertNormalizedEvent(observation(second, 'b'.repeat(64))),
    ]);
    const identitySetBeforeReplay = new Set(
      (await repository.list()).map(
        (event) => `${event.identityVersion}:${event.canonicalIdentity}`,
      ),
    );
    await Promise.all([
      repository.upsertNormalizedEvent(observation(first)),
      repository.upsertNormalizedEvent(observation(second, 'b'.repeat(64))),
    ]);
    const retained = await repository.list();

    expect(results.map((result) => result.action).sort()).toEqual(['created', 'duplicate']);
    expect(new Set(results.map((result) => result.event.id)).size).toBe(1);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.provenance).toHaveLength(2);
    expect(await repository.listIngestionHistory()).toHaveLength(2);
    expect(
      new Set(retained.map((event) => `${event.identityVersion}:${event.canonicalIdentity}`)),
    ).toEqual(identitySetBeforeReplay);
  });

  it('rejects missing provenance and stable-ID collisions without changing prior state', async () => {
    const repository = new InMemoryEventIngestionRepository();
    const original = normalizedEvent();
    await repository.upsertNormalizedEvent(observation(original));
    const before = await repository.list();
    const missingProvenance = { ...structuredClone(original), provenance: [] };
    const collidingId = normalizedEvent({ id: original.id, title: 'Different identity' });

    await expect(
      repository.upsertNormalizedEvent(observation(missingProvenance)),
    ).rejects.toThrow('associated provenance');
    await expect(repository.upsertNormalizedEvent(observation(collidingId))).rejects.toThrow(
      'Stable event ID',
    );
    expect(await repository.list()).toEqual(before);
    expect(await repository.listIngestionHistory()).toHaveLength(1);
  });
});
