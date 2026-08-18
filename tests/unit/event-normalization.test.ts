import { describe, expect, it } from 'vitest';
import { FakeClock } from '@delaware-scene/test-support';
import {
  DELAWARE_TIME_ZONE,
  isUpcoming,
  normalizeEvent,
  normalizeTitle,
  parseOccurrence,
  type Clock,
  type RawEventCandidate,
  type Result,
} from '@delaware-scene/domain';

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function candidate(overrides: Partial<RawEventCandidate> = {}): RawEventCandidate {
  return {
    id: 'event-0001',
    sourceRecordId: 'source-0001',
    sourceCategory: 'government',
    sourceUrl: 'https://events.example.org/art-night',
    retrievedAt: '2026-08-18T12:00:00Z',
    title: 'Art Night',
    occurrences: [{ id: 'occurrence-0001', start: '2026-09-01' }],
    ...overrides,
  };
}

describe('event title normalization', () => {
  it('trims boundaries, collapses Unicode whitespace, and accepts exact character bounds', () => {
    expect(requireSuccess(normalizeTitle('  Delaware\t Arts\n\n Night  '))).toBe(
      'Delaware Arts Night',
    );
    expect(requireSuccess(normalizeTitle('🎨'.repeat(300)))).toBe('🎨'.repeat(300));
  });

  it('rejects normalized titles outside one through 300 characters', () => {
    const blank = normalizeTitle(' \t\r\n ');
    const overlong = normalizeTitle('a'.repeat(301));

    expect(blank).toEqual({
      ok: false,
      errors: [expect.objectContaining({ path: 'title', code: 'invalid_length' })],
    });
    expect(overlong).toEqual({
      ok: false,
      errors: [expect.objectContaining({ path: 'title', code: 'invalid_length' })],
    });
  });
});

describe('event occurrence value objects', () => {
  it('preserves exact date-only values without adding a time or timezone', () => {
    const occurrence = requireSuccess(
      parseOccurrence({
        id: 'occurrence-date',
        start: '2028-02-29',
        end: '2028-03-01',
        sourceTimezone: 'America/New_York',
      }),
    );

    expect(occurrence).toEqual({
      id: 'occurrence-date',
      kind: 'date',
      startDate: '2028-02-29',
      endDate: '2028-03-01',
      originalStart: '2028-02-29',
      originalEnd: '2028-03-01',
    });
    expect('startAt' in occurrence).toBe(false);
    expect('sourceTimezone' in occurrence).toBe(false);
  });

  it('preserves the represented instant, source timezone, source-local values, and originals', () => {
    const occurrence = requireSuccess(
      parseOccurrence({
        id: 'occurrence-instant',
        start: '2026-03-08T01:30:00-05:00[America/New_York]',
        end: '2026-03-08T03:30:00-04:00[America/New_York]',
      }),
    );

    expect(occurrence).toEqual({
      id: 'occurrence-instant',
      kind: 'instant',
      startAt: '2026-03-08T06:30:00Z',
      endAt: '2026-03-08T07:30:00Z',
      sourceTimezone: 'America/New_York',
      localDate: '2026-03-08',
      localTime: '01:30:00',
      originalStart: '2026-03-08T01:30:00-05:00[America/New_York]',
      originalEnd: '2026-03-08T03:30:00-04:00[America/New_York]',
    });
  });

  it('uses a separately supplied IANA timezone for source-local timestamps', () => {
    const occurrence = requireSuccess(
      parseOccurrence({
        id: 'occurrence-local',
        start: '2026-08-18T19:00:00',
        sourceTimezone: 'America/New_York',
      }),
    );

    expect(occurrence).toMatchObject({
      kind: 'instant',
      startAt: '2026-08-18T23:00:00Z',
      sourceTimezone: 'America/New_York',
      localDate: '2026-08-18',
      localTime: '19:00:00',
    });
  });

  it('preserves both distinct instants in the repeated hour at the DST fall transition', () => {
    const earlier = requireSuccess(
      parseOccurrence({
        id: 'occurrence-fall-earlier',
        start: '2026-11-01T01:30:00-04:00[America/New_York]',
      }),
    );
    const later = requireSuccess(
      parseOccurrence({
        id: 'occurrence-fall-later',
        start: '2026-11-01T01:30:00-05:00[America/New_York]',
      }),
    );

    expect(earlier).toMatchObject({
      kind: 'instant',
      startAt: '2026-11-01T05:30:00Z',
      sourceTimezone: 'America/New_York',
      localDate: '2026-11-01',
      localTime: '01:30:00',
    });
    expect(later).toMatchObject({
      kind: 'instant',
      startAt: '2026-11-01T06:30:00Z',
      sourceTimezone: 'America/New_York',
      localDate: '2026-11-01',
      localTime: '01:30:00',
    });
  });

  it('returns field-specific errors for invalid dates, unqualified timestamps, and timezones', () => {
    const invalidDate = parseOccurrence({ id: 'bad-date', start: '2027-02-29' });
    const missingZone = parseOccurrence({ id: 'missing-zone', start: '2026-08-18T19:00:00Z' });
    const invalidZone = parseOccurrence({
      id: 'bad-zone',
      start: '2026-08-18T19:00:00Z',
      sourceTimezone: 'Not/A_Real_Zone',
    });

    expect(invalidDate).toEqual({
      ok: false,
      errors: [expect.objectContaining({ path: 'occurrence.start', code: 'invalid_timestamp' })],
    });
    expect(missingZone).toEqual({
      ok: false,
      errors: [expect.objectContaining({ path: 'occurrence.start', code: 'invalid_timestamp' })],
    });
    expect(invalidZone).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          path: 'occurrence.sourceTimezone',
          code: 'invalid_timezone',
        }),
      ],
    });
  });
});

describe('ingested event normalization', () => {
  it('preserves omitted optional fields as unknown rather than fabricating values', () => {
    const event = requireSuccess(normalizeEvent(candidate({ title: '  Art\t Night  ' })));

    expect(event).toMatchObject({
      title: 'Art Night',
      description: null,
      categories: [],
      organization: null,
      venue: null,
      city: null,
      region: null,
      cost: null,
      audience: null,
      accessibility: null,
      address: null,
      coordinates: null,
      onlineLocationUrl: null,
      publicSourceUrl: null,
      ticketUrl: null,
      registrationUrl: null,
      attribution: null,
      rightsNotice: null,
      publicationStatus: 'pending',
      validationIssues: [],
      provenance: [{ sourceSuppliedId: null }],
    });
  });

  it('retains invalid end-order originals for review while clearing the normalized end instant', () => {
    const originalStart = '2026-09-01T14:00:00-04:00[America/New_York]';
    const originalEnd = '2026-09-01T14:00:00-04:00[America/New_York]';
    const event = requireSuccess(
      normalizeEvent(
        candidate({
          occurrences: [
            {
              id: 'occurrence-invalid-end',
              start: originalStart,
              end: originalEnd,
            },
          ],
        }),
      ),
    );

    expect(event.publicationStatus).toBe('pending');
    expect(event.occurrences).toEqual([
      expect.objectContaining({
        kind: 'instant',
        endAt: null,
        originalStart,
        originalEnd,
      }),
    ]);
    expect(event.validationIssues).toEqual([
      {
        path: 'occurrences.0.end',
        code: 'end_not_after_start',
        message: 'End timestamp must occur after the corresponding start timestamp.',
        rejectedValue: { start: originalStart, end: originalEnd },
      },
    ]);
  });

  it('rejects an event when any occurrence start cannot be parsed', () => {
    const result = normalizeEvent(
      candidate({ occurrences: [{ id: 'occurrence-invalid', start: 'not-a-date' }] }),
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          path: 'occurrences.0.start',
          code: 'invalid_timestamp',
        }),
      ],
    });
  });
});

describe('date-only upcoming classification', () => {
  it('uses the injected Delaware calendar date and preserves the exact stored date', () => {
    const calls: string[] = [];
    const calendarDate = new FakeClock('2026-08-18T12:00:00Z').today(DELAWARE_TIME_ZONE);
    const clock: Clock = {
      now() {
        throw new Error('Date-only classification must use Clock.today.');
      },
      today(zone) {
        calls.push(zone);
        return calendarDate;
      },
    };
    const today = requireSuccess(
      parseOccurrence({ id: 'today', start: '2026-08-18' }),
    );
    const yesterday = requireSuccess(
      parseOccurrence({ id: 'yesterday', start: '2026-08-17' }),
    );

    expect(isUpcoming(today, clock)).toBe(true);
    expect(isUpcoming(yesterday, clock)).toBe(false);
    expect(today).toMatchObject({
      kind: 'date',
      startDate: '2026-08-18',
      originalStart: '2026-08-18',
    });
    expect(calls).toEqual([DELAWARE_TIME_ZONE, DELAWARE_TIME_ZONE]);
  });
});
