import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DELAWARE_TIME_ZONE,
  isEventArchiveEligible,
  isOccurrenceArchiveEligible,
  updateRetentionDays,
  type EventOccurrence,
  type EventRecord,
} from '@delaware-scene/domain';
import { buildEvent } from '@delaware-scene/test-support';

const millisecondsPerDay = 86_400_000;
const proposedRetentionArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -100, max: 3_750 }),
  fc.integer({ min: -10_000, max: 10_000 }).map((value) => value + 0.5),
  fc.integer({ min: -100, max: 3_750 }).map(String),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.boolean(),
  fc.constant({}),
);

const retentionCaseArbitrary = fc.record({
  current: fc.integer({ min: 0, max: 3_650 }),
  proposed: proposedRetentionArbitrary,
  occurrenceKind: fc.constantFrom('date' as const, 'instant' as const),
  dayOffset: fc.integer({ min: -10_000, max: 10_000 }),
  epochMilliseconds: fc.integer({ min: 946_684_800_000, max: 2_082_758_399_000 }),
  hasExplicitEnd: fc.boolean(),
});

function dateFromDayOffset(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offset * millisecondsPerDay)
    .toISOString()
    .slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * millisecondsPerDay)
    .toISOString()
    .slice(0, 10);
}

function instantText(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().replace(/\.000Z$/u, 'Z');
}

function localDateTime(epochMilliseconds: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DELAWARE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMilliseconds));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

function delawareNoon(date: string): string {
  return `${date}T12:00:00Z`;
}

function assertEventBoundary(
  occurrence: EventOccurrence,
  beforeBoundary: string,
  exactBoundary: string,
  retentionDays: number,
): void {
  const published = buildEvent({
    occurrences: [occurrence],
    publicationStatus: 'published',
  });
  const pending: EventRecord = { ...published, publicationStatus: 'pending' };

  expect(isOccurrenceArchiveEligible(occurrence, beforeBoundary, retentionDays)).toBe(false);
  expect(isOccurrenceArchiveEligible(occurrence, exactBoundary, retentionDays)).toBe(true);
  expect(isEventArchiveEligible(published, beforeBoundary, retentionDays)).toBe(false);
  expect(isEventArchiveEligible(published, exactBoundary, retentionDays)).toBe(true);
  expect(isEventArchiveEligible(pending, exactBoundary, retentionDays)).toBe(false);
}

describe('retention setting and archival boundary properties', () => {
  it('accepts only inclusive whole-day bounds and uses the accepted setting at archival boundaries', () => {
    // Feature: delaware-scene-full-stack-clone, Property 15: Retention settings and archive eligibility honor inclusive bounds
    // **Validates: Requirements 4.17, 4.18, 4.19**
    fc.assert(
      fc.property(retentionCaseArbitrary, (generated) => {
        const update = updateRetentionDays(generated.current, generated.proposed);
        const shouldAccept =
          typeof generated.proposed === 'number' &&
          Number.isInteger(generated.proposed) &&
          generated.proposed >= 0 &&
          generated.proposed <= 3_650;

        expect(update.accepted).toBe(shouldAccept);
        expect(update.value).toBe(shouldAccept ? generated.proposed : generated.current);
        if (shouldAccept) {
          expect(update.errors).toEqual([]);
        } else {
          expect(update.errors).toEqual([
            expect.objectContaining({ path: 'retentionDays', code: 'out_of_range' }),
          ]);
        }

        const retentionDays = update.value;
        if (generated.occurrenceKind === 'date') {
          const endedDate = dateFromDayOffset(generated.dayOffset);
          const startDate = generated.hasExplicitEnd ? addDays(endedDate, -1) : endedDate;
          const occurrence: EventOccurrence = {
            id: 'occurrence-date-generated',
            kind: 'date',
            startDate,
            endDate: generated.hasExplicitEnd ? endedDate : null,
            originalStart: startDate,
            originalEnd: generated.hasExplicitEnd ? endedDate : null,
          };
          const boundaryDate = addDays(endedDate, retentionDays + 1);
          assertEventBoundary(
            occurrence,
            delawareNoon(addDays(boundaryDate, -1)),
            delawareNoon(boundaryDate),
            retentionDays,
          );
          return;
        }

        const endedAtMilliseconds = generated.epochMilliseconds;
        const startAtMilliseconds = generated.hasExplicitEnd
          ? endedAtMilliseconds - 3_600_000
          : endedAtMilliseconds;
        const local = localDateTime(startAtMilliseconds);
        const startAt = instantText(startAtMilliseconds);
        const endedAt = instantText(endedAtMilliseconds);
        const occurrence: EventOccurrence = {
          id: 'occurrence-instant-generated',
          kind: 'instant',
          startAt,
          endAt: generated.hasExplicitEnd ? endedAt : null,
          sourceTimezone: DELAWARE_TIME_ZONE,
          localDate: local.date,
          localTime: local.time,
          originalStart: startAt,
          originalEnd: generated.hasExplicitEnd ? endedAt : null,
        };
        const boundaryMilliseconds =
          endedAtMilliseconds + retentionDays * millisecondsPerDay;
        assertEventBoundary(
          occurrence,
          instantText(boundaryMilliseconds - 1),
          instantText(boundaryMilliseconds),
          retentionDays,
        );
      }),
      { numRuns: 100 },
    );
  });
});
