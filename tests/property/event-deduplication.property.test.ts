import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventIngestionRepository,
  type EventIngestionObservation,
} from '@delaware-scene/application';
import {
  normalizeEvent,
  type EventRecord,
  type ProvenanceRecord,
  type Result,
} from '@delaware-scene/domain';

interface IngestionSet {
  sequence: ProvenanceRecord[];
  distinctContributions: ProvenanceRecord[];
}

function retrievedAt(identifier: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00Z') + identifier * 1_000)
    .toISOString()
    .replace(/\.000Z$/u, 'Z');
}

const distinctContributionsArbitrary = fc
  .uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), {
    minLength: 1,
    maxLength: 6,
  })
  .map((identifiers) =>
    identifiers.map((identifier) => ({
      sourceRecordId: 'source-stable',
      sourceUrl: `https://events.example.org/generated/${identifier}`,
      sourceSuppliedId: `source-event-${identifier}`,
      retrievedAt: retrievedAt(identifier),
    })),
  );

const ingestionSetArbitrary: fc.Arbitrary<IngestionSet> = distinctContributionsArbitrary.chain(
  (distinctContributions) =>
    fc
      .tuple(
        fc.shuffledSubarray(distinctContributions, {
          minLength: distinctContributions.length,
          maxLength: distinctContributions.length,
        }),
        fc.array(fc.integer({ min: 0, max: distinctContributions.length - 1 }), {
          minLength: 1,
          maxLength: 6,
        }),
      )
      .map(([ordered, repeatedIndexes]) => ({
        sequence: [
          ...ordered,
          ...repeatedIndexes.map((index) => distinctContributions[index] as ProvenanceRecord),
        ],
        distinctContributions,
      })),
);

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function eventFor(provenance: ProvenanceRecord): EventRecord {
  return requireSuccess(
    normalizeEvent({
      id: 'event-stable',
      sourceRecordId: provenance.sourceRecordId,
      sourceCategory: 'government',
      sourceUrl: provenance.sourceUrl,
      sourceSuppliedId: provenance.sourceSuppliedId,
      retrievedAt: provenance.retrievedAt,
      title: 'Generated Arts Event',
      description: 'Equivalent generated payload',
      venue: 'Generated Hall',
      city: 'Dover',
      occurrences: [{ id: 'occurrence-stable', start: '2027-05-01' }],
    }),
  );
}

function observation(event: EventRecord): EventIngestionObservation {
  return {
    event,
    payloadDigest: 'a'.repeat(64),
    adapterKey: 'fixture-json-ld',
    adapterVersion: '1.0.0',
    extractionFormat: 'json-ld',
    runId: 'run-generated',
  };
}

function provenanceKey(provenance: ProvenanceRecord): string {
  return JSON.stringify([
    provenance.sourceRecordId,
    provenance.sourceUrl,
    provenance.sourceSuppliedId,
    provenance.retrievedAt,
  ]);
}

async function ingest(sequence: readonly ProvenanceRecord[]): Promise<EventRecord[]> {
  const repository = new InMemoryEventIngestionRepository();
  for (const provenance of sequence) {
    await repository.upsertNormalizedEvent(observation(eventFor(provenance)));
  }
  return repository.list();
}

describe('same-identity event deduplication properties', () => {
  it('retains one event and the order-independent union of all contributing provenance', async () => {
    // Feature: delaware-scene-full-stack-clone, Property 13: Deduplication retains one event and all provenance
    // **Validates: Requirements 4.13, 4.14, 14.11, 14.12**
    await fc.assert(
      fc.asyncProperty(
        ingestionSetArbitrary,
        async ({ sequence, distinctContributions }) => {
          const forward = await ingest(sequence);
          const reordered = await ingest([...sequence].reverse());
          const expectedProvenance = distinctContributions.map(provenanceKey).sort();

          expect(forward).toHaveLength(1);
          expect(reordered).toHaveLength(1);
          expect(forward[0]?.canonicalIdentity).toBe(reordered[0]?.canonicalIdentity);
          expect(forward[0]?.provenance.map(provenanceKey).sort()).toEqual(expectedProvenance);
          expect(reordered[0]?.provenance.map(provenanceKey).sort()).toEqual(expectedProvenance);
          expect(new Set(forward[0]?.provenance.map(provenanceKey)).size).toBe(
            distinctContributions.length,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
