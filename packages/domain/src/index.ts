import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';

export const AUTHORITATIVE_FILE_NAMES = [
  'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
  'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
  'Library Events.csv',
  'Government Events.csv',
] as const;

export type AuthoritativeCatalogFileName = (typeof AUTHORITATIVE_FILE_NAMES)[number];
export type SourceCategory = 'ddoa-grantee' | 'non-grantee' | 'library' | 'government';
export type PublicationStatus = 'pending' | 'published' | 'rejected' | 'archived';
export type CollectionState = 'enabled' | 'disabled';

export const CATEGORY_BY_FILE: Readonly<Record<AuthoritativeCatalogFileName, SourceCategory>> = {
  'DelawareScene Events Master List - DDOA-funded grantee websites.csv': 'ddoa-grantee',
  'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv':
    'non-grantee',
  'Library Events.csv': 'library',
  'Government Events.csv': 'government',
};

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  fileName?: string;
  physicalRow?: number;
  rejectedValue?: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ValidationIssue[] };

export const DELAWARE_TIME_ZONE = 'America/New_York' as const;
export type DelawareTimeZone = typeof DELAWARE_TIME_ZONE;
export type InstantReference = string | Temporal.Instant | Pick<Clock, 'now'>;

export interface Clock {
  now(): Temporal.Instant;
  today(zone: DelawareTimeZone): Temporal.PlainDate;
}

export interface IdGenerator {
  next(prefix?: string): string;
}

export class SystemClock implements Clock {
  now(): Temporal.Instant {
    return Temporal.Now.instant();
  }

  today(zone: DelawareTimeZone): Temporal.PlainDate {
    return this.now().toZonedDateTimeISO(zone).toPlainDate();
  }
}

export type UrlField =
  | { kind: 'known-absence' }
  | { kind: 'unspecified' }
  | { kind: 'values'; values: readonly string[] };

export interface CanonicalSourceRecord {
  id: string;
  catalogFileName: string;
  physicalRow: number;
  sourceCategory: SourceCategory;
  organizationName: string;
  organizationUrls: UrlField;
  sitemapUrls: UrlField;
  eventUrls: UrlField;
  collectionState: CollectionState;
}

export const CANONICAL_EVENT_IDENTITY_VERSION = 1 as const;
export type CanonicalEventIdentityVersion = typeof CANONICAL_EVENT_IDENTITY_VERSION;

export type EventOccurrence = DateOccurrence | InstantOccurrence;

export interface DateOccurrence {
  id: string;
  kind: 'date';
  startDate: string;
  endDate: string | null;
  originalStart: string;
  originalEnd: string | null;
}

export interface InstantOccurrence {
  id: string;
  kind: 'instant';
  startAt: string;
  endAt: string | null;
  sourceTimezone: string;
  localDate: string;
  localTime: string;
  originalStart: string;
  originalEnd: string | null;
}

export interface EventRecord {
  id: string;
  canonicalIdentity: string;
  identityVersion: CanonicalEventIdentityVersion;
  title: string;
  description: string | null;
  categories: string[];
  organization: string | null;
  venue: string | null;
  city: string | null;
  region: string | null;
  cost: string | null;
  audience: string | null;
  accessibility: string | null;
  address: Record<string, string> | null;
  coordinates: { latitude: number; longitude: number } | null;
  onlineLocationUrl: string | null;
  publicSourceUrl: string | null;
  ticketUrl: string | null;
  registrationUrl: string | null;
  attribution: string | null;
  rightsNotice: string | null;
  sourceCategory: SourceCategory;
  publicationStatus: PublicationStatus;
  occurrences: EventOccurrence[];
  validationIssues: ValidationIssue[];
  provenance: ProvenanceRecord[];
  version: number;
}

export interface ProvenanceRecord {
  sourceRecordId: string;
  sourceUrl: string;
  sourceSuppliedId: string | null;
  retrievedAt: string;
}

export interface RawOccurrence {
  id: string;
  start: string;
  end?: string | null;
  sourceTimezone?: string;
}

export interface RawEventCandidate {
  id: string;
  sourceRecordId: string;
  sourceCategory: SourceCategory;
  sourceUrl: string;
  sourceSuppliedId?: string | null;
  retrievedAt: string;
  title: string;
  description?: string | null;
  categories?: string[];
  organization?: string | null;
  venue?: string | null;
  city?: string | null;
  region?: string | null;
  cost?: string | null;
  audience?: string | null;
  accessibility?: string | null;
  address?: Record<string, string> | null;
  coordinates?: { latitude: number; longitude: number } | null;
  onlineLocationUrl?: string | null;
  publicSourceUrl?: string | null;
  ticketUrl?: string | null;
  registrationUrl?: string | null;
  attribution?: string | null;
  rightsNotice?: string | null;
  occurrences: RawOccurrence[];
}

export interface EventFilters {
  categories?: readonly string[];
  regions?: readonly string[];
  organizations?: readonly string[];
  costs?: readonly string[];
  audiences?: readonly string[];
  accessibility?: readonly string[];
}

export interface CanonicalEventLocation {
  venue: string | null;
  city: string | null;
  address: Readonly<Record<string, string>> | null;
  onlineLocationUrl: string | null;
}

export interface RetentionSettingUpdate {
  accepted: boolean;
  value: number;
  errors: ValidationIssue[];
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function normalizeTitle(value: string): Result<string> {
  const normalized = normalizeWhitespace(value);
  const characterCount = [...normalized].length;
  if (characterCount < 1 || characterCount > 300) {
    return {
      ok: false,
      errors: [
        {
          path: 'title',
          code: 'invalid_length',
          message: 'Title must contain from 1 through 300 characters after normalization.',
        },
      ],
    };
  }
  return { ok: true, value: normalized };
}

function parseDate(value: string): Temporal.PlainDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return null;
  }
}

function extractBracketedZone(value: string): string | null {
  return value.match(/\[([^\]]+)\]$/u)?.[1] ?? null;
}

function isValidTimeZone(value: string): boolean {
  try {
    Temporal.Instant.from('1970-01-01T00:00:00Z').toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}

function parseInstant(value: string, sourceTimezone: string): Temporal.Instant | null {
  try {
    if (extractBracketedZone(value) !== null) {
      return Temporal.ZonedDateTime.from(value).toInstant();
    }
    try {
      return Temporal.Instant.from(value);
    } catch {
      return Temporal.PlainDateTime.from(value).toZonedDateTime(sourceTimezone).toInstant();
    }
  } catch {
    return null;
  }
}

export function parseOccurrence(raw: RawOccurrence): Result<EventOccurrence> {
  const hasEnd = raw.end !== undefined && raw.end !== null;
  const startDate = parseDate(raw.start);
  const endDate = hasEnd ? parseDate(raw.end as string) : null;
  if (startDate) {
    if (hasEnd && !endDate) {
      return {
        ok: false,
        errors: [
          { path: 'occurrence.end', code: 'invalid_date', message: 'End must be a valid date.' },
        ],
      };
    }
    return {
      ok: true,
      value: {
        id: raw.id,
        kind: 'date',
        startDate: startDate.toString(),
        endDate: endDate?.toString() ?? null,
        originalStart: raw.start,
        originalEnd: raw.end ?? null,
      },
    };
  }

  const suppliedZone = raw.sourceTimezone?.trim();
  const zone = suppliedZone || extractBracketedZone(raw.start);
  if (!zone) {
    return {
      ok: false,
      errors: [
        {
          path: 'occurrence.start',
          code: 'invalid_timestamp',
          message: 'Start must be a date or a timezone-qualified timestamp.',
        },
      ],
    };
  }
  if (!isValidTimeZone(zone)) {
    return {
      ok: false,
      errors: [
        {
          path: 'occurrence.sourceTimezone',
          code: 'invalid_timezone',
          message: 'Source timezone must be a valid IANA timezone.',
        },
      ],
    };
  }

  const start = parseInstant(raw.start, zone);
  if (!start) {
    return {
      ok: false,
      errors: [
        {
          path: 'occurrence.start',
          code: 'invalid_timestamp',
          message: 'Start must be a date or a timezone-qualified timestamp.',
        },
      ],
    };
  }
  const zoned = start.toZonedDateTimeISO(zone);
  const end = hasEnd ? parseInstant(raw.end as string, zone) : null;
  if (hasEnd && !end) {
    return {
      ok: false,
      errors: [
        {
          path: 'occurrence.end',
          code: 'invalid_timestamp',
          message: 'End must be a timezone-qualified timestamp.',
        },
      ],
    };
  }

  return {
    ok: true,
    value: {
      id: raw.id,
      kind: 'instant',
      startAt: start.toString(),
      endAt: end?.toString() ?? null,
      sourceTimezone: zone,
      localDate: zoned.toPlainDate().toString(),
      localTime: zoned.toPlainTime().toString(),
      originalStart: raw.start,
      originalEnd: raw.end ?? null,
    },
  };
}

function normalizeIdentityText(value: string): string {
  return normalizeWhitespace(value).normalize('NFKC').toLocaleLowerCase('en-US');
}

function frameIdentityValues(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
}

export function canonicalLocationIdentity(
  location: string | null | CanonicalEventLocation,
): string {
  if (location === null || typeof location === 'string') {
    return normalizeIdentityText(location ?? '');
  }
  const address = Object.entries(location.address ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [normalizeIdentityText(key), normalizeIdentityText(value)] as const);
  return frameIdentityValues([
    normalizeIdentityText(location.venue ?? ''),
    normalizeIdentityText(location.city ?? ''),
    ...address.flatMap(([key, value]) => [key, value]),
    normalizeIdentityText(location.onlineLocationUrl ?? ''),
  ]);
}

export function canonicalEventIdentity(input: {
  sourceRecordId: string;
  title: string;
  occurrence: EventOccurrence;
  location: string | null | CanonicalEventLocation;
}): string {
  const occurrence =
    input.occurrence.kind === 'date'
      ? `date:${input.occurrence.startDate}`
      : `instant:${input.occurrence.startAt}`;
  const framed = frameIdentityValues([
    String(CANONICAL_EVENT_IDENTITY_VERSION),
    input.sourceRecordId,
    normalizeIdentityText(input.title),
    occurrence,
    canonicalLocationIdentity(input.location),
  ]);
  return createHash('sha256').update(framed, 'utf8').digest('hex');
}

function orderedAddress(value: Readonly<Record<string, string>> | null): Record<string, string> | null {
  return value === null
    ? null
    : Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function eventContentValue(event: EventRecord): unknown {
  return {
    title: event.title,
    description: event.description,
    categories: event.categories,
    organization: event.organization,
    venue: event.venue,
    city: event.city,
    region: event.region,
    cost: event.cost,
    audience: event.audience,
    accessibility: event.accessibility,
    address: orderedAddress(event.address),
    coordinates: event.coordinates,
    onlineLocationUrl: event.onlineLocationUrl,
    publicSourceUrl: event.publicSourceUrl,
    ticketUrl: event.ticketUrl,
    registrationUrl: event.registrationUrl,
    attribution: event.attribution,
    rightsNotice: event.rightsNotice,
    sourceCategory: event.sourceCategory,
    occurrences: event.occurrences.map(({ id: _id, ...occurrence }) => occurrence),
    validationIssues: event.validationIssues,
  };
}

export function eventContentFingerprint(event: EventRecord): string {
  return createHash('sha256').update(JSON.stringify(eventContentValue(event)), 'utf8').digest('hex');
}

export function eventContentEquals(left: EventRecord, right: EventRecord): boolean {
  return eventContentFingerprint(left) === eventContentFingerprint(right);
}

export function normalizeEvent(candidate: RawEventCandidate): Result<EventRecord> {
  const title = normalizeTitle(candidate.title);
  if (!title.ok) return title;
  if (candidate.occurrences.length < 1) {
    return {
      ok: false,
      errors: [
        {
          path: 'occurrences',
          code: 'missing_occurrence',
          message: 'At least one occurrence is required.',
        },
      ],
    };
  }

  const parsed: EventOccurrence[] = [];
  const errors: ValidationIssue[] = [];
  for (const [index, raw] of candidate.occurrences.entries()) {
    const result = parseOccurrence(raw);
    if (result.ok) parsed.push(result.value);
    else {
      errors.push(
        ...result.errors.map((error) => ({
          ...error,
          path: error.path.replace('occurrence', `occurrences.${index}`),
        })),
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const reviewIssues: ValidationIssue[] = [];
  for (const [index, occurrence] of parsed.entries()) {
    if (
      occurrence.kind === 'instant' &&
      occurrence.endAt !== null &&
      Temporal.Instant.compare(occurrence.endAt, occurrence.startAt) <= 0
    ) {
      reviewIssues.push({
        path: `occurrences.${index}.end`,
        code: 'end_not_after_start',
        message: 'End timestamp must occur after the corresponding start timestamp.',
        rejectedValue: {
          start: occurrence.originalStart,
          end: occurrence.originalEnd,
        },
      });
      occurrence.endAt = null;
    }
  }

  const first = parsed[0];
  if (!first) throw new Error('Occurrence invariant violated.');
  const identity = canonicalEventIdentity({
    sourceRecordId: candidate.sourceRecordId,
    title: title.value,
    occurrence: first,
    location: {
      venue: candidate.venue ?? null,
      city: candidate.city ?? null,
      address: candidate.address ?? null,
      onlineLocationUrl: candidate.onlineLocationUrl ?? null,
    },
  });

  return {
    ok: true,
    value: {
      id: candidate.id,
      canonicalIdentity: identity,
      identityVersion: CANONICAL_EVENT_IDENTITY_VERSION,
      title: title.value,
      description: candidate.description ?? null,
      categories: [...(candidate.categories ?? [])],
      organization: candidate.organization ?? null,
      venue: candidate.venue ?? null,
      city: candidate.city ?? null,
      region: candidate.region ?? null,
      cost: candidate.cost ?? null,
      audience: candidate.audience ?? null,
      accessibility: candidate.accessibility ?? null,
      address: candidate.address ? { ...candidate.address } : null,
      coordinates: candidate.coordinates ? { ...candidate.coordinates } : null,
      onlineLocationUrl: candidate.onlineLocationUrl ?? null,
      publicSourceUrl: candidate.publicSourceUrl ?? null,
      ticketUrl: candidate.ticketUrl ?? null,
      registrationUrl: candidate.registrationUrl ?? null,
      attribution: candidate.attribution ?? null,
      rightsNotice: candidate.rightsNotice ?? null,
      sourceCategory: candidate.sourceCategory,
      publicationStatus: 'pending',
      occurrences: parsed,
      validationIssues: reviewIssues,
      provenance: [
        {
          sourceRecordId: candidate.sourceRecordId,
          sourceUrl: candidate.sourceUrl,
          sourceSuppliedId: candidate.sourceSuppliedId ?? null,
          retrievedAt: candidate.retrievedAt,
        },
      ],
      version: 1,
    },
  };
}

export function instantFromReference(reference: InstantReference): Temporal.Instant {
  if (typeof reference === 'string') return Temporal.Instant.from(reference);
  if (reference instanceof Temporal.Instant) return reference;
  return Temporal.Instant.from(reference.now());
}

function isCalendarClock(reference: InstantReference): reference is Clock {
  return (
    typeof reference !== 'string' &&
    'today' in reference &&
    typeof reference.today === 'function' &&
    'now' in reference &&
    typeof reference.now === 'function'
  );
}

export function isUpcoming(occurrence: EventOccurrence, openedAt: InstantReference): boolean {
  if (occurrence.kind === 'date') {
    const today = isCalendarClock(openedAt)
      ? openedAt.today(DELAWARE_TIME_ZONE)
      : instantFromReference(openedAt).toZonedDateTimeISO(DELAWARE_TIME_ZONE).toPlainDate();
    return Temporal.PlainDate.compare(occurrence.startDate, today) >= 0;
  }
  const instant = instantFromReference(openedAt);
  if (occurrence.endAt) return Temporal.Instant.compare(occurrence.endAt, instant) > 0;
  return Temporal.Instant.compare(occurrence.startAt, instant) >= 0;
}

export function compareOccurrences(
  left: { eventId: string; occurrence: EventOccurrence },
  right: { eventId: string; occurrence: EventOccurrence },
): number {
  const leftDate = left.occurrence.kind === 'date' ? left.occurrence.startDate : left.occurrence.localDate;
  const rightDate =
    right.occurrence.kind === 'date' ? right.occurrence.startDate : right.occurrence.localDate;
  const dateComparison = leftDate.localeCompare(rightDate);
  if (dateComparison !== 0) return dateComparison;
  const kindComparison =
    (left.occurrence.kind === 'date' ? 0 : 1) - (right.occurrence.kind === 'date' ? 0 : 1);
  if (kindComparison !== 0) return kindComparison;
  const leftTime = left.occurrence.kind === 'instant' ? left.occurrence.localTime : '';
  const rightTime = right.occurrence.kind === 'instant' ? right.occurrence.localTime : '';
  const timeComparison = leftTime.localeCompare(rightTime);
  if (timeComparison !== 0) return timeComparison;
  const idComparison = left.eventId.localeCompare(right.eventId);
  return idComparison !== 0 ? idComparison : left.occurrence.id.localeCompare(right.occurrence.id);
}

export function eventMatchesSearch(event: EventRecord, query: string): boolean {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase('en-US');
  if (needle.length === 0) return true;
  const fields = [
    event.title,
    event.description,
    event.organization,
    event.venue,
    event.city,
    ...event.categories,
  ];
  return fields.some((field) =>
    (field ?? '').normalize('NFKC').toLocaleLowerCase('en-US').includes(needle),
  );
}

function matchesGroup(value: string | null, selected: readonly string[] | undefined): boolean {
  return !selected || selected.length === 0 || (value !== null && selected.includes(value));
}

export function eventMatchesFilters(event: EventRecord, filters: EventFilters): boolean {
  const categoriesMatch =
    !filters.categories ||
    filters.categories.length === 0 ||
    event.categories.some((category) => filters.categories?.includes(category));
  return (
    categoriesMatch &&
    matchesGroup(event.region, filters.regions) &&
    matchesGroup(event.organization, filters.organizations) &&
    matchesGroup(event.cost, filters.costs) &&
    matchesGroup(event.audience, filters.audiences) &&
    matchesGroup(event.accessibility, filters.accessibility)
  );
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
} {
  if (!Number.isInteger(page) || page < 1) throw new RangeError('page must be a positive integer');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError('pageSize must be a whole number from 1 through 100');
  }
  const totalCount = items.length;
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, totalCount, totalPages };
}

export function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): Result<number> {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return {
      ok: false,
      errors: [
        {
          path: field,
          code: 'out_of_range',
          message: `${field} must be a whole number from ${minimum} through ${maximum}.`,
        },
      ],
    };
  }
  return { ok: true, value: parsed };
}

function isRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3650;
}

export function updateRetentionDays(current: number, proposed: unknown): RetentionSettingUpdate {
  if (!isRetentionDays(current)) {
    throw new RangeError('Current retention period must be a whole number from 0 through 3650.');
  }
  if (!isRetentionDays(proposed)) {
    return {
      accepted: false,
      value: current,
      errors: [
        {
          path: 'retentionDays',
          code: 'out_of_range',
          message: 'retentionDays must be a whole number from 0 through 3650.',
        },
      ],
    };
  }
  return { accepted: true, value: proposed, errors: [] };
}

export function isOccurrenceArchiveEligible(
  occurrence: EventOccurrence,
  openedAt: InstantReference,
  retentionDays: number,
): boolean {
  if (!isRetentionDays(retentionDays)) {
    throw new RangeError('Retention period must be a whole number from 0 through 3650.');
  }
  const now = instantFromReference(openedAt);
  if (occurrence.kind === 'date') {
    const today = now.toZonedDateTimeISO(DELAWARE_TIME_ZONE).toPlainDate();
    const endedDate = Temporal.PlainDate.from(occurrence.endDate ?? occurrence.startDate);
    const eligibleDate = endedDate.add({ days: retentionDays + 1 });
    return Temporal.PlainDate.compare(today, eligibleDate) >= 0;
  }
  const endedAt = Temporal.Instant.from(occurrence.endAt ?? occurrence.startAt);
  const eligibleAt = endedAt.add({ hours: retentionDays * 24 });
  return Temporal.Instant.compare(now, eligibleAt) >= 0;
}

export function isEventArchiveEligible(
  event: EventRecord,
  openedAt: InstantReference,
  retentionDays: number,
): boolean {
  const capturedAt = instantFromReference(openedAt);
  return (
    event.publicationStatus === 'published' &&
    event.occurrences.length > 0 &&
    event.occurrences.every((occurrence) =>
      isOccurrenceArchiveEligible(occurrence, capturedAt, retentionDays),
    )
  );
}

export function eventsEligibleForArchival(
  events: readonly EventRecord[],
  openedAt: InstantReference,
  retentionDays: number,
): EventRecord[] {
  const capturedAt = instantFromReference(openedAt);
  return events
    .filter((event) => isEventArchiveEligible(event, capturedAt, retentionDays))
    .map((event) => structuredClone(event));
}
