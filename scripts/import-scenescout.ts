import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { JsonEventRepository, JsonStateStore } from '../packages/database/src/index.js';
import {
  DELAWARE_TIME_ZONE,
  isUpcoming,
  normalizeEvent,
  normalizeWhitespace,
  type CanonicalSourceRecord,
  type EventRecord,
  type RawEventCandidate,
  type RawOccurrence,
  type UrlField,
} from '../packages/domain/src/index.js';
import { parseRfc4180 } from '../packages/ingestion/src/index.js';
import {
  dedupeText,
  eventDedupeKey,
  mergeEvents,
  serializeMasterEvents,
  stableUuid,
  writeAtomically,
} from './scrape-events.js';

const EXPECTED_HEADERS = [
  'venue ID',
  'presenter ID (if different)',
  'title of program',
  'categories',
  'URL',
  'box office phone',
  'low price',
  'high price',
  'start date',
  'start time',
  'end date',
  'ticket URL',
  'description',
] as const;
const SCENESCOUT_PREFIX = 'scenescout:';
const FALLBACK_SOURCE_URL = 'https://delawarescene.com/';

const CATEGORY_BY_ID: Readonly<Record<string, string>> = {
  '1': 'Attractions',
  '2': 'Dance',
  '3': 'Festivals & Special Events',
  '4': 'Film',
  '5': 'Free',
  '6': 'Kids & Family Friendly',
  '7': 'Lectures & Workshops',
  '8': 'Literature & Poetry',
  '9': 'Music',
  '10': 'Theater & Performance',
  '11': 'Visual Arts',
  '13': 'Choral',
  '14': 'Classical / Opera',
  '15': 'Country / Folk / Bluegrass',
  '16': 'Hip-Hop / R&B',
  '17': 'Jazz / Blues',
  '18': 'Rock / Pop',
  '20': 'Comedy / Drama',
  '21': 'Musical',
  '22': 'Variety',
  '24': 'Holiday',
  '25': 'Art Tours',
  '26': 'Exhibitions',
  '27': 'Galleries',
  '28': 'Museums',
};

interface SceneScoutOccurrenceInput {
  physicalRow: number;
  startDate: string;
  startTime: string;
  endDate: string;
}

interface SceneScoutEventInput {
  physicalRow: number;
  venueId: string;
  presenterId: string;
  title: string;
  categories: string;
  url: string;
  boxOfficePhone: string;
  lowPrice: string;
  highPrice: string;
  ticketUrl: string;
  description: string;
  occurrences: SceneScoutOccurrenceInput[];
}

interface LocationHint {
  venue: string | null;
  city: string | null;
  region: string | null;
  address: Record<string, string> | null;
}

interface ImportSummaryItem {
  id: string;
  title: string;
  starts: string[];
  publicSourceUrl: string | null;
}

interface ImportReport {
  sourceFile: string;
  sourceSha256: string;
  importedAt: string;
  dryRun: boolean;
  csvDataRows: number;
  logicalEvents: number;
  continuationRows: number;
  sourceOccurrences: number;
  existingEventCount: number;
  finalEventCount: number;
  importedEventCount: number;
  mergedWorkbookDuplicateCount: number;
  importedOccurrenceCount: number;
  skippedExistingCount: number;
  skippedCancelledCount: number;
  skippedExpiredCount: number;
  inferredVenueCount: number;
  categoryIds: string[];
  imported: ImportSummaryItem[];
}

function valueAt(fields: readonly string[], headers: ReadonlyMap<string, number>, name: string): string {
  const index = headers.get(name);
  if (index === undefined) throw new Error(`SceneScout CSV is missing required header ${name}.`);
  return (fields[index] ?? '').trim();
}

function parseSceneScoutCsv(text: string): { csvDataRows: number; events: SceneScoutEventInput[] } {
  const parsed = parseRfc4180(text);
  if (!parsed.ok) {
    throw new Error(
      `SceneScout CSV parsing failed: ${parsed.errors.map((error) => error.message).join('; ')}`,
    );
  }
  const [headerRow, ...dataRows] = parsed.value;
  if (!headerRow) throw new Error('SceneScout CSV is empty.');
  const headers = new Map(headerRow.fields.map((field, index) => [field.trim(), index]));
  const missing = EXPECTED_HEADERS.filter((header) => !headers.has(header));
  if (missing.length > 0) throw new Error(`SceneScout CSV is missing headers: ${missing.join(', ')}.`);

  const events: SceneScoutEventInput[] = [];
  let current: SceneScoutEventInput | null = null;
  for (const row of dataRows) {
    if (row.fields.every((field) => field.trim().length === 0)) continue;
    if (row.fields.length !== headerRow.fields.length) {
      throw new Error(
        `SceneScout CSV row ${row.physicalRow} has ${row.fields.length} fields; expected ${headerRow.fields.length}.`,
      );
    }
    const title = valueAt(row.fields, headers, 'title of program');
    if (title.length > 0) {
      current = {
        physicalRow: row.physicalRow,
        venueId: valueAt(row.fields, headers, 'venue ID'),
        presenterId: valueAt(row.fields, headers, 'presenter ID (if different)'),
        title,
        categories: valueAt(row.fields, headers, 'categories'),
        url: valueAt(row.fields, headers, 'URL'),
        boxOfficePhone: valueAt(row.fields, headers, 'box office phone'),
        lowPrice: valueAt(row.fields, headers, 'low price'),
        highPrice: valueAt(row.fields, headers, 'high price'),
        ticketUrl: valueAt(row.fields, headers, 'ticket URL'),
        description: valueAt(row.fields, headers, 'description'),
        occurrences: [],
      };
      events.push(current);
    }
    if (!current) {
      throw new Error(`SceneScout CSV row ${row.physicalRow} is a continuation without an event.`);
    }
    const startDate = valueAt(row.fields, headers, 'start date');
    if (startDate.length > 0) {
      current.occurrences.push({
        physicalRow: row.physicalRow,
        startDate,
        startTime: valueAt(row.fields, headers, 'start time'),
        endDate: valueAt(row.fields, headers, 'end date'),
      });
    }
  }
  for (const event of events) {
    if (event.occurrences.length === 0) {
      throw new Error(`SceneScout event on row ${event.physicalRow} has no occurrence.`);
    }
  }
  return { csvDataRows: dataRows.length, events };
}

function parseUsDate(value: string, physicalRow: number): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (!match) throw new Error(`Invalid SceneScout date ${JSON.stringify(value)} on row ${physicalRow}.`);
  const [, month = '', day = '', year = ''] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid SceneScout date ${JSON.stringify(value)} on row ${physicalRow}.`);
  }
  return `${year}-${month}-${day}`;
}

function parseTime(value: string, physicalRow: number): string {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/iu);
  if (!match) throw new Error(`Invalid SceneScout time ${JSON.stringify(value)} on row ${physicalRow}.`);
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) {
    throw new Error(`Invalid SceneScout time ${JSON.stringify(value)} on row ${physicalRow}.`);
  }
  const hour = (hour12 % 12) + (match[3]?.toLowerCase() === 'p' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function canonicalUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.href;
  } catch {
    return null;
  }
}

function values(field: UrlField): string[] {
  return field.kind === 'values' ? [...field.values] : [];
}

function configuredUrls(source: CanonicalSourceRecord): string[] {
  return [
    ...values(source.organizationUrls),
    ...values(source.sitemapUrls),
    ...values(source.eventUrls),
  ];
}

function findFallbackSource(sources: readonly CanonicalSourceRecord[]): CanonicalSourceRecord {
  const source = sources.find((candidate) => /delaware.?scene/iu.test(candidate.organizationName));
  if (!source) throw new Error('The canonical DelawareScene source record is unavailable.');
  return source;
}

function matchSource(
  event: SceneScoutEventInput,
  sources: readonly CanonicalSourceRecord[],
  fallback: CanonicalSourceRecord,
): CanonicalSourceRecord {
  const candidateUrls = [event.url, event.ticketUrl]
    .map(canonicalUrl)
    .filter((value): value is string => value !== null);
  const ranked: Array<{ source: CanonicalSourceRecord; score: number }> = [];
  for (const source of sources) {
    let score = -1;
    for (const configured of configuredUrls(source)) {
      const normalized = canonicalUrl(configured);
      if (!normalized) continue;
      const configuredUrl = new URL(normalized);
      for (const candidate of candidateUrls) {
        const candidateUrl = new URL(candidate);
        if (candidateUrl.hostname !== configuredUrl.hostname) continue;
        const configuredPath = configuredUrl.pathname.replace(/\/+$/u, '');
        const pathScore =
          configuredPath.length > 1 && candidateUrl.pathname.startsWith(configuredPath)
            ? configuredPath.length
            : 0;
        score = Math.max(score, 1000 + pathScore);
      }
    }
    if (score >= 0) ranked.push({ source, score });
  }
  ranked.sort(
    (left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id),
  );
  return ranked[0]?.source ?? fallback;
}

function eventStartDates(event: EventRecord): string[] {
  return event.occurrences.map((occurrence) =>
    occurrence.kind === 'date' ? occurrence.startDate : occurrence.localDate,
  );
}

function titleDateKey(title: string, date: string): string {
  return `${dedupeText(title)}|${date}`;
}

function buildTitleDateIndex(events: readonly EventRecord[]): Map<string, EventRecord[]> {
  const index = new Map<string, EventRecord[]>();
  for (const event of events) {
    for (const date of eventStartDates(event)) {
      const key = titleDateKey(event.title, date);
      const values = index.get(key) ?? [];
      values.push(event);
      index.set(key, values);
    }
  }
  return index;
}

function buildExistingUrlIndex(events: readonly EventRecord[]): Set<string> {
  const urls = new Set<string>();
  for (const event of events) {
    for (const value of [
      event.publicSourceUrl,
      event.ticketUrl,
      ...event.provenance.map((item) => item.sourceUrl),
    ]) {
      const normalized = canonicalUrl(value);
      if (normalized) urls.add(normalized);
    }
  }
  return urls;
}

function resolveVenueHints(
  inputs: readonly SceneScoutEventInput[],
  existing: readonly EventRecord[],
  titleDates: ReadonlyMap<string, EventRecord[]>,
): Map<string, LocationHint> {
  const candidates = new Map<string, Map<string, { count: number; hint: LocationHint }>>();
  for (const input of inputs) {
    if (!input.venueId) continue;
    const matched = new Map<string, EventRecord>();
    for (const occurrence of input.occurrences) {
      const date = parseUsDate(occurrence.startDate, occurrence.physicalRow);
      for (const event of titleDates.get(titleDateKey(input.title, date)) ?? []) {
        matched.set(event.id, event);
      }
    }
    for (const event of matched.values()) {
      if (!event.venue && !event.city && !event.address) continue;
      const hint: LocationHint = {
        venue: event.venue,
        city: event.city,
        region: event.region,
        address: event.address ? { ...event.address } : null,
      };
      const key = JSON.stringify(hint);
      const byHint = candidates.get(input.venueId) ?? new Map();
      const current = byHint.get(key);
      byHint.set(key, { count: (current?.count ?? 0) + 1, hint });
      candidates.set(input.venueId, byHint);
    }
  }

  const resolved = new Map<string, LocationHint>();
  for (const [venueId, byHint] of candidates) {
    const selected = [...byHint.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        right.count - left.count || leftKey.localeCompare(rightKey),
    )[0]?.[1];
    if (selected) resolved.set(venueId, selected.hint);
  }

  const venuesByHost = new Map<string, Map<string, LocationHint>>();
  for (const event of existing) {
    if (!event.venue && !event.city && !event.address) continue;
    const hint: LocationHint = {
      venue: event.venue,
      city: event.city,
      region: event.region,
      address: event.address ? { ...event.address } : null,
    };
    const hintKey = JSON.stringify(hint);
    for (const value of [event.publicSourceUrl, ...event.provenance.map((item) => item.sourceUrl)]) {
      const normalized = canonicalUrl(value);
      if (!normalized) continue;
      const host = new URL(normalized).hostname;
      const byHint = venuesByHost.get(host) ?? new Map();
      byHint.set(hintKey, hint);
      venuesByHost.set(host, byHint);
    }
  }
  for (const input of inputs) {
    if (!input.venueId || resolved.has(input.venueId)) continue;
    const normalized = canonicalUrl(input.url);
    if (!normalized) continue;
    const byHint = venuesByHost.get(new URL(normalized).hostname);
    if (byHint?.size === 1) resolved.set(input.venueId, [...byHint.values()][0] as LocationHint);
  }
  return resolved;
}

function categoryNames(value: string): string[] {
  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(ids.map((id) => CATEGORY_BY_ID[id] ?? `SceneScout category ${id}`))];
}

function price(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/[$,]/gu, '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function costText(lowValue: string, highValue: string): string | null {
  const low = price(lowValue);
  const high = price(highValue);
  if (low === null && high === null) return null;
  if ((low ?? high) === 0 && (high ?? low) === 0) return 'Free';
  if (low !== null && high !== null) {
    return low === high ? formatPrice(low) : `${formatPrice(low)}–${formatPrice(high)}`;
  }
  return low !== null ? `From ${formatPrice(low)}` : `Up to ${formatPrice(high as number)}`;
}

function suppliedId(event: SceneScoutEventInput, occurrences: readonly RawOccurrence[]): string {
  const stableValue = JSON.stringify([
    event.venueId,
    event.presenterId,
    dedupeText(event.title),
    canonicalUrl(event.url),
    canonicalUrl(event.ticketUrl),
    occurrences[0]?.start ?? '',
    occurrences[0]?.end ?? null,
  ]);
  return `${SCENESCOUT_PREFIX}${createHash('sha256').update(stableValue, 'utf8').digest('hex').slice(0, 32)}`;
}

function rawOccurrences(event: SceneScoutEventInput): RawOccurrence[] {
  const values: Array<Omit<RawOccurrence, 'id'>> = [];
  for (const occurrence of event.occurrences) {
    const startDate = parseUsDate(occurrence.startDate, occurrence.physicalRow);
    const endDate = occurrence.endDate
      ? parseUsDate(occurrence.endDate, occurrence.physicalRow)
      : null;
    if (endDate && endDate < startDate) {
      throw new Error(`SceneScout end date precedes start date on row ${occurrence.physicalRow}.`);
    }
    if (endDate && endDate > startDate) {
      values.push({ start: startDate, end: endDate });
    } else if (occurrence.startTime) {
      values.push({
        start: `${startDate}T${parseTime(occurrence.startTime, occurrence.physicalRow)}`,
        end: null,
        sourceTimezone: DELAWARE_TIME_ZONE,
      });
    } else {
      values.push({ start: startDate, end: endDate });
    }
  }
  const unique = new Map(
    values.map((occurrence) => [
      JSON.stringify([occurrence.start, occurrence.end ?? null, occurrence.sourceTimezone ?? null]),
      occurrence,
    ]),
  );
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, occurrence], index) => ({
      ...occurrence,
      id: stableUuid(`${dedupeText(event.title)}|${occurrence.start}|${occurrence.end ?? ''}|${index}`),
    }));
}

function normalizedCandidate(
  input: SceneScoutEventInput,
  source: CanonicalSourceRecord,
  fallback: CanonicalSourceRecord,
  location: LocationHint | undefined,
  retrievedAt: string,
): EventRecord | null {
  const sourceUrl = canonicalUrl(input.url) ?? canonicalUrl(input.ticketUrl) ?? FALLBACK_SOURCE_URL;
  const publicSourceUrl =
    canonicalUrl(input.url) ?? canonicalUrl(input.ticketUrl) ?? FALLBACK_SOURCE_URL;
  const allRawOccurrences = rawOccurrences(input);
  const stableSuppliedId = suppliedId(input, allRawOccurrences);
  const candidate: RawEventCandidate = {
    id: stableUuid(`${source.id}|${stableSuppliedId}`),
    sourceRecordId: source.id,
    sourceCategory: source.sourceCategory,
    sourceUrl,
    sourceSuppliedId: stableSuppliedId,
    retrievedAt,
    title: input.title,
    description: input.description ? normalizeWhitespace(input.description) : null,
    categories: categoryNames(input.categories),
    organization: source.id === fallback.id ? null : source.organizationName,
    venue: location?.venue ?? null,
    city: location?.city ?? null,
    region: location?.region ?? null,
    cost: costText(input.lowPrice, input.highPrice),
    address: location?.address ?? null,
    publicSourceUrl,
    ticketUrl: canonicalUrl(input.ticketUrl),
    occurrences: allRawOccurrences,
  };
  const normalized = normalizeEvent(candidate);
  if (!normalized.ok) {
    throw new Error(
      `SceneScout event on row ${input.physicalRow} is invalid: ${normalized.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
    );
  }
  const keptIndexes = normalized.value.occurrences.flatMap((occurrence, index) =>
    isUpcoming(occurrence, retrievedAt) ? [index] : [],
  );
  if (keptIndexes.length === 0) return null;
  if (keptIndexes.length === allRawOccurrences.length) {
    return { ...normalized.value, publicationStatus: 'published' };
  }
  const future = normalizeEvent({
    ...candidate,
    occurrences: keptIndexes.map((index) => allRawOccurrences[index] as RawOccurrence),
  });
  if (!future.ok) throw new Error(`Unable to normalize filtered SceneScout event row ${input.physicalRow}.`);
  return { ...future.value, publicationStatus: 'published' };
}

function starts(event: EventRecord): string[] {
  return event.occurrences.map((occurrence) =>
    occurrence.kind === 'date' ? occurrence.startDate : occurrence.startAt,
  );
}

function parseArguments(): { apply: boolean; filePath: string; summaryOnly: boolean } {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const filePath =
    fileIndex >= 0
      ? args[fileIndex + 1]
      : join(process.cwd(), 'scenescout-export-20260819.csv');
  if (!filePath) throw new Error('--file requires a path.');
  return {
    apply: args.includes('--apply'),
    filePath: resolve(filePath),
    summaryOnly: args.includes('--summary-only'),
  };
}

async function main(): Promise<void> {
  const { apply, filePath, summaryOnly } = parseArguments();
  const root = process.cwd();
  const statePath = join(root, 'data', 'generated', 'state.json');
  const csvText = await readFile(filePath, 'utf8');
  const sourceSha256 = createHash('sha256').update(csvText, 'utf8').digest('hex').toUpperCase();
  const parsed = parseSceneScoutCsv(csvText);
  const store = new JsonStateStore(statePath);
  const repository = new JsonEventRepository(store);
  const state = await store.read();
  const existing = await repository.list();
  const fallback = findFallbackSource(state.sources);
  const titleDates = buildTitleDateIndex(existing);
  const existingUrls = buildExistingUrlIndex(existing);
  const venueHints = resolveVenueHints(parsed.events, existing, titleDates);
  const workbookUrlCounts = new Map<string, number>();
  for (const event of parsed.events) {
    for (const value of [event.url, event.ticketUrl]) {
      const normalized = canonicalUrl(value);
      if (normalized) workbookUrlCounts.set(normalized, (workbookUrlCounts.get(normalized) ?? 0) + 1);
    }
  }

  const retrievedAt = new Date().toISOString();
  const imported: EventRecord[] = [];
  let skippedExistingCount = 0;
  let skippedCancelledCount = 0;
  let skippedExpiredCount = 0;
  let inferredVenueCount = 0;
  for (const input of parsed.events) {
    if (/\b(?:cancelled|canceled)\b/iu.test(input.title.trim())) {
      skippedCancelledCount += 1;
      continue;
    }
    const source = matchSource(input, state.sources, fallback);
    const location = venueHints.get(input.venueId);
    const event = normalizedCandidate(input, source, fallback, location, retrievedAt);
    if (!event) {
      skippedExpiredCount += 1;
      continue;
    }
    const exactTitleDate = eventStartDates(event).some((date) =>
      titleDates.has(titleDateKey(event.title, date)),
    );
    const uniqueUrlMatch = [input.url, input.ticketUrl].some((value) => {
      const normalized = canonicalUrl(value);
      return (
        normalized !== null &&
        workbookUrlCounts.get(normalized) === 1 &&
        existingUrls.has(normalized)
      );
    });
    if (exactTitleDate || uniqueUrlMatch) {
      skippedExistingCount += 1;
      continue;
    }
    if (location) inferredVenueCount += 1;
    imported.push(event);
  }

  const deduplicatedImported = mergeEvents(imported);
  const finalEvents = mergeEvents([...existing, ...deduplicatedImported]);
  if (finalEvents.length !== existing.length + deduplicatedImported.length) {
    const collisions = [...existing, ...deduplicatedImported]
      .reduce((groups, event) => {
        const key = eventDedupeKey(event);
        const values = groups.get(key) ?? [];
        values.push(event);
        groups.set(key, values);
        return groups;
      }, new Map<string, EventRecord[]>())
      .entries()
      .filter(([, events]) => events.length > 1)
      .map(([key, events]) => ({
        key,
        events: events.map((event) => ({ id: event.id, title: event.title, starts: starts(event) })),
      }))
      .toArray();
    throw new Error(
      `SceneScout merge would collapse ${existing.length + deduplicatedImported.length - finalEvents.length} unexpected event(s): ${JSON.stringify(collisions)}.`,
    );
  }
  const ids = new Set(finalEvents.map((event) => event.id));
  if (ids.size !== finalEvents.length) throw new Error('SceneScout merge produced duplicate event IDs.');

  const categoryIds = [...new Set(parsed.events.flatMap((event) => event.categories.split(',')))]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right));
  const report: ImportReport = {
    sourceFile: basename(filePath),
    sourceSha256,
    importedAt: retrievedAt,
    dryRun: !apply,
    csvDataRows: parsed.csvDataRows,
    logicalEvents: parsed.events.length,
    continuationRows: parsed.csvDataRows - parsed.events.length,
    sourceOccurrences: parsed.events.reduce((sum, event) => sum + event.occurrences.length, 0),
    existingEventCount: existing.length,
    finalEventCount: finalEvents.length,
    importedEventCount: deduplicatedImported.length,
    mergedWorkbookDuplicateCount: imported.length - deduplicatedImported.length,
    importedOccurrenceCount: deduplicatedImported.reduce(
      (sum, event) => sum + event.occurrences.length,
      0,
    ),
    skippedExistingCount,
    skippedCancelledCount,
    skippedExpiredCount,
    inferredVenueCount,
    categoryIds,
    imported: deduplicatedImported.map((event) => ({
      id: event.id,
      title: event.title,
      starts: starts(event),
      publicSourceUrl: event.publicSourceUrl,
    })),
  };

  if (apply) {
    await repository.replaceAll(finalEvents);
    await writeAtomically(
      join(root, 'data', 'generated', 'master-events.csv'),
      serializeMasterEvents(finalEvents),
    );
    await writeAtomically(
      join(root, 'data', 'generated', 'scenescout-import-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify(summaryOnly ? { ...report, imported: undefined } : report, null, 2),
  );
}

await main();
