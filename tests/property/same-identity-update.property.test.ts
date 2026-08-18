import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventIngestionRepository,
  type EventIngestionObservation,
} from '@delaware-scene/application';
import {
  normalizeEvent,
  type EventRecord,
  type RawEventCandidate,
  type Result,
} from '@delaware-scene/domain';

const updateCaseArbitrary = fc.record({
  caseIdentifier: fc.integer({ min: 0, max: 100_000 }),
  detail: fc
    .array(fc.constantFrom('a', 'B', '7', 'é', '中', '🎨', ' '), {
      minLength: 0,
      maxLength: 40,
    })
    .map((characters) => characters.join('')),
  retrievalGapSeconds: fc.integer({ min: 1, max: 86_400 }),
  replayCount: fc.integer({ min: 1, max: 5 }),
});

function instantText(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().replace(/\.000Z$/u, 'Z');
}

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function normalizedEvent(input: {
  id: string;
  caseIdentifier: number;
  description: string;
  retrievedAt: string;
}): EventRecord {
  const candidate: RawEventCandidate = {
    id: input.id,
    sourceRecordId: `source-${input.caseIdentifier}`,
    sourceCategory: 'government',
    sourceUrl: `https://events.example.org/generated/${input.caseIdentifier}`,
    sourceSuppliedId: `source-event-${input.caseIdentifier}`,
    retrievedAt: input.retrievedAt,
    title: `Generated Event ${input.caseIdentifier}`,
    description: input.description,
    venue: 'Generated Hall',
    city: 'Dover',
    occurrences: [{ id: 'occurrence-generated', start: '2027-05-01' }],
  };
  return requireSuccess(normalizeEvent(candidate));
}

function observation(event: EventRecord, payloadDigest: string): EventIngestionObservation {
  return {
    event,
    payloadDigest,
    adapterKey: 'fixture-json-ld',
    adapterVersion: '1.0.0',
    extractionFormat: 'json-ld',
    runId: 'run-generated',
  };
}

describe('same-identity event update properties', () => {
  it('updates the stable record and stores a changed observation exactly once under replay', async () => {
    // Feature: delaware-scene-full-stack-clone, Property 14: Same-identity updates are exact-once observations
    // **Validates: Requirements 4.15, 4.16**
    await fc.assert(
      fc.asyncProperty(
        updateCaseArbitrary,
        async ({ caseIdentifier, detail, retrievalGapSeconds, replayCount }) => {
          const initialEpochMilliseconds =
            Date.parse('2026-08-18T12:00:00Z') + caseIdentifier * 1_000;
          const initialRetrievedAt = instantText(initialEpochMilliseconds);
          const changedRetrievedAt = instantText(
            initialEpochMilliseconds + retrievalGapSeconds * 1_000,
          );
          const initial = normalizedEvent({
            id: `event-original-${caseIdentifier}`,
            caseIdentifier,
            description: `Initial description ${detail}`,
            retrievedAt: initialRetrievedAt,
          });
          const changed = normalizedEvent({
            id: `event-replacement-${caseIdentifier}`,
            caseIdentifier,
            description: `Updated description ${detail}`,
            retrievedAt: changedRetrievedAt,
          });
          const repository = new InMemoryEventIngestionRepository();

          expect(changed.canonicalIdentity).toBe(initial.canonicalIdentity);
          const created = await repository.upsertNormalizedEvent(
            observation(initial, 'a'.repeat(64)),
          );
          const updated = await repository.upsertNormalizedEvent(
            observation(changed, 'b'.repeat(64)),
          );
          const replays = [];
          for (let replay = 0; replay < replayCount; replay += 1) {
            replays.push(
              await repository.upsertNormalizedEvent(observation(changed, 'b'.repeat(64))),
            );
          }

          const retained = await repository.list();
          const history = await repository.listIngestionHistory(initial.id);
          const changedHistory = history.filter(
            (record) => record.retrievedAt === changedRetrievedAt,
          );

          expect(created.action).toBe('created');
          expect(updated).toMatchObject({
            action: 'updated',
            provenanceCreated: 1,
            historyCreated: 1,
            event: {
              id: initial.id,
              canonicalIdentity: initial.canonicalIdentity,
              description: changed.description,
              version: 2,
            },
          });
          expect(replays).toEqual(
            Array.from({ length: replayCount }, () =>
              expect.objectContaining({
                action: 'duplicate',
                provenanceCreated: 0,
                historyCreated: 0,
                event: expect.objectContaining({ id: initial.id, version: 2 }),
              }),
            ),
          );
          expect(retained).toHaveLength(1);
          expect(retained[0]).toMatchObject({
            id: initial.id,
            description: changed.description,
            version: 2,
          });
          expect(history).toHaveLength(2);
          expect(changedHistory).toEqual([
            expect.objectContaining({ action: 'updated', payloadDigest: 'b'.repeat(64) }),
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
