import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeEvent,
  parseOccurrence,
  type RawEventCandidate,
  type RawOccurrence,
  type Result,
} from '@delaware-scene/domain';

interface DateCase {
  kind: 'date';
  raw: RawOccurrence;
  expectedStart: string;
  expectedEnd: string | null;
}

interface InstantCase {
  kind: 'instant';
  raw: RawOccurrence;
  expectedStart: string;
  expectedEnd: string | null;
  expectedZone: string;
  expectedLocalDate: string;
  expectedLocalTime: string;
}

interface InvalidCase {
  kind: 'invalid';
  raw: RawOccurrence;
}

type OccurrenceCase = DateCase | InstantCase | InvalidCase;

const millisecondsPerDay = 86_400_000;
const zones = ['America/New_York', 'America/Chicago', 'Europe/London', 'Asia/Tokyo', 'UTC'] as const;

function dateFromDayOffset(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offset * millisecondsPerDay)
    .toISOString()
    .slice(0, 10);
}

function instantText(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().replace(/\.000Z$/u, 'Z');
}

function localDateTime(
  epochMilliseconds: number,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
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
  const fraction = epochMilliseconds % 1_000;
  const fractionalSecond =
    fraction === 0
      ? ''
      : `.${String(fraction).padStart(3, '0').replace(/0+$/u, '')}`;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}${fractionalSecond}`,
  };
}

const dateCaseArbitrary: fc.Arbitrary<DateCase> = fc
  .record({
    dayOffset: fc.integer({ min: -20_000, max: 20_000 }),
    endOffset: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 30 })),
    zone: fc.constantFrom(...zones),
  })
  .map(({ dayOffset, endOffset, zone }) => {
    const start = dateFromDayOffset(dayOffset);
    const end = endOffset === null ? null : dateFromDayOffset(dayOffset + endOffset);
    return {
      kind: 'date',
      raw: {
        id: `date-${dayOffset}`,
        start,
        end: end ?? undefined,
        sourceTimezone: zone,
      },
      expectedStart: start,
      expectedEnd: end,
    };
  });

const instantCaseArbitrary: fc.Arbitrary<InstantCase> = fc
  .record({
    epochMilliseconds: fc.integer({ min: 946_684_800_000, max: 2_082_758_399_000 }),
    endMinutes: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 10_080 })),
    zone: fc.constantFrom(...zones),
  })
  .map(({ epochMilliseconds, endMinutes, zone }) => {
    const endMilliseconds =
      endMinutes === null ? null : epochMilliseconds + endMinutes * 60_000;
    const local = localDateTime(epochMilliseconds, zone);
    return {
      kind: 'instant',
      raw: {
        id: `instant-${epochMilliseconds}`,
        start: instantText(epochMilliseconds),
        end: endMilliseconds === null ? undefined : instantText(endMilliseconds),
        sourceTimezone: zone,
      },
      expectedStart: instantText(epochMilliseconds),
      expectedEnd: endMilliseconds === null ? null : instantText(endMilliseconds),
      expectedZone: zone,
      expectedLocalDate: local.date,
      expectedLocalTime: local.time,
    };
  });

const invalidCaseArbitrary: fc.Arbitrary<InvalidCase> = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((value) => ({
    kind: 'invalid',
    raw: { id: `invalid-${value}`, start: `not-a-temporal-value-${value}` },
  }));

const occurrenceCaseArbitrary: fc.Arbitrary<OccurrenceCase> = fc.oneof(
  dateCaseArbitrary,
  instantCaseArbitrary,
  invalidCaseArbitrary,
);

function candidate(occurrence: RawOccurrence): RawEventCandidate {
  return {
    id: 'event-generated',
    sourceRecordId: 'source-generated',
    sourceCategory: 'government',
    sourceUrl: 'https://events.example.org/generated',
    retrievedAt: '2026-08-18T12:00:00Z',
    title: 'Generated Event',
    occurrences: [occurrence],
  };
}

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('event occurrence parsing properties', () => {
  it('preserves date-only and instant semantics while rejecting invalid starts', () => {
    // Feature: delaware-scene-full-stack-clone, Property 11: Occurrence parsing preserves temporal kind and meaning
    // **Validates: Requirements 4.4, 4.5, 4.6, 4.7**
    fc.assert(
      fc.property(occurrenceCaseArbitrary, (generated) => {
        const parsed = parseOccurrence(generated.raw);

        if (generated.kind === 'invalid') {
          if (parsed.ok) throw new Error('An invalid temporal value must not produce an occurrence.');
          expect(parsed.errors).toEqual([
            expect.objectContaining({ path: 'occurrence.start', code: 'invalid_timestamp' }),
          ]);
          const normalized = normalizeEvent(candidate(generated.raw));
          if (normalized.ok) throw new Error('An event with an invalid start must not be writable.');
          expect(normalized.errors).toEqual([
            expect.objectContaining({ path: 'occurrences.0.start', code: 'invalid_timestamp' }),
          ]);
          return;
        }

        const occurrence = requireSuccess(parsed);
        if (generated.kind === 'date') {
          if (occurrence.kind !== 'date') throw new Error('A date-only value changed temporal kind.');
          expect(occurrence).toEqual({
            id: generated.raw.id,
            kind: 'date',
            startDate: generated.expectedStart,
            endDate: generated.expectedEnd,
            originalStart: generated.raw.start,
            originalEnd: generated.raw.end ?? null,
          });
          expect('startAt' in occurrence).toBe(false);
          expect('sourceTimezone' in occurrence).toBe(false);
          return;
        }

        if (occurrence.kind !== 'instant') throw new Error('A timestamp changed temporal kind.');
        expect(Date.parse(occurrence.startAt)).toBe(Date.parse(generated.expectedStart));
        expect(occurrence.endAt === null ? null : Date.parse(occurrence.endAt)).toBe(
          generated.expectedEnd === null ? null : Date.parse(generated.expectedEnd),
        );
        expect(occurrence.sourceTimezone).toBe(generated.expectedZone);
        expect(occurrence.localDate).toBe(generated.expectedLocalDate);
        expect(occurrence.localTime).toBe(generated.expectedLocalTime);
        expect(occurrence.originalStart).toBe(generated.raw.start);
        expect(occurrence.originalEnd).toBe(generated.raw.end ?? null);
      }),
      { numRuns: 100 },
    );
  });
});
