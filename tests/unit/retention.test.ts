import { describe, expect, it } from 'vitest';
import {
  ArchivalEligibilityJobHandler,
  ArchivalEligibilityService,
  InMemoryEventIngestionRepository,
  InMemoryRetentionSettingsRepository,
  createArchivalEligibilityJob,
} from '@delaware-scene/application';
import {
  isOccurrenceArchiveEligible,
  type EventOccurrence,
  type EventRecord,
} from '@delaware-scene/domain';
import { buildEvent } from '@delaware-scene/test-support';

const openedAt = '2026-08-18T12:00:00Z';

function dateOccurrence(startDate: string, endDate: string | null = null): EventOccurrence {
  return {
    id: `occurrence-${startDate}-${endDate ?? 'open'}`,
    kind: 'date',
    startDate,
    endDate,
    originalStart: startDate,
    originalEnd: endDate,
  };
}

function instantOccurrence(startAt: string, endAt: string | null): EventOccurrence {
  return {
    id: `occurrence-${startAt}`,
    kind: 'instant',
    startAt,
    endAt,
    sourceTimezone: 'America/New_York',
    localDate: '2026-08-18',
    localTime: '08:00:00',
    originalStart: startAt,
    originalEnd: endAt,
  };
}

function retainedEvent(
  id: string,
  identityCharacter: string,
  overrides: Partial<EventRecord> = {},
): EventRecord {
  return buildEvent({
    id,
    canonicalIdentity: identityCharacter.repeat(64),
    occurrences: [dateOccurrence('2026-08-17')],
    ...overrides,
  });
}

describe('retention setting persistence policy', () => {
  it('accepts both inclusive bounds and preserves the preceding value for every invalid class', async () => {
    const repository = new InMemoryRetentionSettingsRepository(30);

    expect(await repository.updateRetentionDays(0, 'editor')).toMatchObject({
      accepted: true,
      value: 0,
    });
    expect(await repository.updateRetentionDays(3650, 'editor')).toMatchObject({
      accepted: true,
      value: 3650,
    });

    for (const invalid of [-1, 3651, 1.5, Number.NaN, '30', null]) {
      const rejected = await repository.updateRetentionDays(invalid, 'editor');
      expect(rejected).toMatchObject({
        accepted: false,
        value: 3650,
        errors: [expect.objectContaining({ path: 'retentionDays', code: 'out_of_range' })],
      });
      expect(await repository.getRetentionDays()).toBe(3650);
    }
  });
});

describe('archival eligibility boundaries', () => {
  it('uses the next Delaware calendar day as the zero-day date-only boundary', () => {
    expect(isOccurrenceArchiveEligible(dateOccurrence('2026-08-17'), openedAt, 0)).toBe(true);
    expect(isOccurrenceArchiveEligible(dateOccurrence('2026-08-18'), openedAt, 0)).toBe(false);
    expect(
      isOccurrenceArchiveEligible(
        dateOccurrence('2026-08-01', '2026-08-17'),
        openedAt,
        0,
      ),
    ).toBe(true);
  });

  it('includes the exact elapsed-time boundary for timestamp occurrences', () => {
    const occurrence = instantOccurrence(
      '2026-08-17T11:00:00Z',
      '2026-08-17T12:00:00Z',
    );

    expect(isOccurrenceArchiveEligible(occurrence, '2026-08-18T11:59:59.999Z', 1)).toBe(
      false,
    );
    expect(isOccurrenceArchiveEligible(occurrence, '2026-08-18T12:00:00Z', 1)).toBe(true);
    expect(
      isOccurrenceArchiveEligible(
        instantOccurrence('2026-08-18T12:00:00Z', null),
        openedAt,
        0,
      ),
    ).toBe(true);
  });

  it('reports only fully ended published events without changing any lifecycle state', async () => {
    const eligible = retainedEvent('event-eligible', 'a');
    const stillCurrent = retainedEvent('event-current', 'b', {
      occurrences: [dateOccurrence('2026-08-18')],
    });
    const pending = retainedEvent('event-pending', 'c', { publicationStatus: 'pending' });
    const archived = retainedEvent('event-archived', 'd', { publicationStatus: 'archived' });
    const recurring = retainedEvent('event-recurring', 'e', {
      occurrences: [dateOccurrence('2026-08-17'), dateOccurrence('2026-08-19')],
    });
    const events = new InMemoryEventIngestionRepository([
      eligible,
      stillCurrent,
      pending,
      archived,
      recurring,
    ]);
    const settings = new InMemoryRetentionSettingsRepository(0);
    const service = new ArchivalEligibilityService(events, settings);
    const handler = new ArchivalEligibilityJobHandler(service);
    const before = await events.list();
    const definition = createArchivalEligibilityJob(
      '2026-08-18T08:00:00-04:00',
      '2026-08-18T11:59:00Z',
    );

    expect((await service.listEligible(openedAt)).map((event) => event.id)).toEqual([
      'event-eligible',
    ]);
    expect(definition).toEqual({
      type: 'event-archival-eligibility',
      payloadVersion: 1,
      payload: { openedAt },
      availableAt: '2026-08-18T11:59:00Z',
      maxAttempts: 3,
      idempotencyKey: `event-archival-eligibility:v1:${openedAt}`,
    });
    expect(await handler.handle(definition.payloadVersion, definition.payload)).toEqual({
      jobType: 'event-archival-eligibility',
      evaluatedAt: openedAt,
      retentionDays: 0,
      eligibleEventIds: ['event-eligible'],
    });
    await expect(handler.handle(2, definition.payload)).rejects.toThrow(
      'Unsupported archival eligibility job payload version',
    );
    expect(await events.list()).toEqual(before);
  });
});
