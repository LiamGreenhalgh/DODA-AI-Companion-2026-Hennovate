import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeEvent,
  type RawEventCandidate,
  type Result,
} from '@delaware-scene/domain';

function utcZonedTimestamp(epochMilliseconds: number): string {
  const instant = new Date(epochMilliseconds).toISOString().replace(/\.000Z$/u, 'Z');
  return `${instant.slice(0, -1)}+00:00[UTC]`;
}

const invalidEndCaseArbitrary = fc
  .record({
    epochMilliseconds: fc.integer({ min: 946_684_800_000, max: 2_082_758_399_000 }),
    earlierBySeconds: fc.integer({ min: 0, max: 604_800 }),
  })
  .map(({ epochMilliseconds, earlierBySeconds }) => ({
    originalStart: utcZonedTimestamp(epochMilliseconds),
    originalEnd: utcZonedTimestamp(epochMilliseconds - earlierBySeconds * 1_000),
  }));

function candidate(originalStart: string, originalEnd: string): RawEventCandidate {
  return {
    id: 'event-generated',
    sourceRecordId: 'source-generated',
    sourceCategory: 'government',
    sourceUrl: 'https://events.example.org/generated',
    retrievedAt: '2026-08-18T12:00:00Z',
    title: 'Generated Event',
    occurrences: [
      {
        id: 'occurrence-generated',
        start: originalStart,
        end: originalEnd,
      },
    ],
  };
}

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('invalid occurrence end-ordering properties', () => {
  it('retains every non-later end for review without publishing it implicitly', () => {
    // Feature: delaware-scene-full-stack-clone, Property 12: Invalid end ordering is retained for review, not published implicitly
    // **Validates: Requirements 4.8, 4.9**
    fc.assert(
      fc.property(invalidEndCaseArbitrary, ({ originalStart, originalEnd }) => {
        const event = requireSuccess(normalizeEvent(candidate(originalStart, originalEnd)));
        const occurrence = event.occurrences[0];

        expect(event.publicationStatus).toBe('pending');
        expect(event.validationIssues).toEqual([
          {
            path: 'occurrences.0.end',
            code: 'end_not_after_start',
            message: 'End timestamp must occur after the corresponding start timestamp.',
            rejectedValue: { start: originalStart, end: originalEnd },
          },
        ]);
        expect(occurrence).toMatchObject({
          kind: 'instant',
          endAt: null,
          originalStart,
          originalEnd,
        });
      }),
      { numRuns: 100 },
    );
  });
});
