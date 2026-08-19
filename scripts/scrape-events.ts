import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
} from '../packages/domain/src/index.js';

const USER_AGENT =
  'DelawareSceneEventIndexer/1.0 (+https://delawarescene.com; public event metadata)';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_PAGES_PER_SOURCE = 80;
const MAX_DELAWARE_SCENE_PAGES = 1_200;
const DELAWARE_SCENE_DISCOVERY_DAYS = 366;
const DELAWARE_SCENE_REQUEST_DELAY_MS = 40;
const MAX_DISCOVERED_LINKS_PER_PAGE = 250;
const SOURCE_CONCURRENCY = 6;
const RETRIES = 2;
const EVENT_HINT =
  /(?:event|calendar|concert|performance|performances|show|shows|season|exhibit|festival|program|ticket|workshop|class|lecture|tour|screening|production)/iu;
const PUBLIC_SOCIAL_HOST = /(?:^|\.)(?:eventbrite\.(?:com|co\.uk)|facebook\.com|instagram\.com|meetup\.com)$/iu;
const DIRECT_PUBLIC_SOCIAL_EVENT =
  /(?:facebook\.com\/events\/\d+|eventbrite\.(?:com|co\.uk)\/e\/|meetup\.com\/[^/]+\/events\/\d+)/iu;
const GENERIC_EVENT_PAGE_TITLE =
  /^(?:(?:upcoming|special)?\s*events?(?: archive)?|events? calendar|calendar|exhibitions|performances|programs|recitals,? concerts,? (?:&|and) events|for adults)(?:\s*[|–—-].*)?$/iu;
const IGNORED_ASSET =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webm|webp|woff2?)(?:$|[?#])/iu;
const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: DELAWARE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

interface FetchResult {
  url: string;
  contentType: string;
  body: string;
}

interface ScrapeError {
  url: string;
  message: string;
}

type SourceStatus = 'completed' | 'completed-no-events' | 'blocked' | 'failed';

interface SourceReport {
  sourceId: string;
  organizationName: string;
  sourceCategory: CanonicalSourceRecord['sourceCategory'];
  status: SourceStatus;
  entryUrls: string[];
  attemptedUrls: string[];
  pagesFetched: number;
  eventsExtracted: number;
  eventsAccepted: number;
  errors: ScrapeError[];
}

interface ScrapeReport {
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  sourceStatusCounts: Record<SourceStatus, number>;
  pagesFetched: number;
  eventsExtracted: number;
  eventsAccepted: number;
  sources: SourceReport[];
}

interface ExtractedEvent {
  sourceUrl: string;
  suppliedId: string | null;
  title: string;
  description: string | null;
  categories: string[];
  organization: string | null;
  venue: string | null;
  city: string | null;
  region: string | null;
  cost: string | null;
  address: Record<string, string> | null;
  onlineLocationUrl: string | null;
  publicSourceUrl: string | null;
  ticketUrl: string | null;
  occurrences: Array<{ start: string; end: string | null; timezone?: string }>;
}

interface SourceScrapeResult {
  report: SourceReport;
  events: EventRecord[];
}

interface RobotsPolicy {
  disallow: string[];
  allow: string[];
}

const robotsCache = new Map<string, Promise<RobotsPolicy>>();

export function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    mdash: '—',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/gu, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([\da-f]+);/giu, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&([a-z]+);/giu, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = normalizeWhitespace(
    decodeHtml(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
        .replace(/<[^>]+>/gu, ' '),
    ),
  );
  return cleaned.length > 0 ? cleaned : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function textFrom(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return cleanText(direct);
  const object = asObject(value);
  return object ? cleanText(asString(object.name) ?? asString(object.text)) : null;
}

function stringsFrom(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    const text = textFrom(item);
    return text ? [text] : [];
  });
}

function resolveUrl(value: unknown, baseUrl: string): string | null {
  const text = asString(value);
  if (!text) return null;
  try {
    const resolved = new URL(text, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false;
    }
    if (isIP(hostname) === 4) {
      const parts = hostname.split('.').map(Number);
      return !(
        parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
      );
    }
    if (isIP(hostname) === 6) {
      return (
        hostname !== '::1' &&
        !hostname.startsWith('fc') &&
        !hostname.startsWith('fd') &&
        !hostname.startsWith('fe80:')
      );
    }
    return true;
  } catch {
    return false;
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchText(url: string, retries = RETRIES): Promise<FetchResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml,text/calendar;q=0.9,*/*;q=0.5',
          'user-agent': USER_AGENT,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      if (!isSafePublicUrl(response.url)) throw new Error('redirected to a non-public URL');
      return {
        url: response.url,
        contentType: response.headers.get('content-type')?.toLowerCase() ?? '',
        body: await readBoundedBody(response),
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries)
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseRobots(body: string): RobotsPolicy {
  const policy: RobotsPolicy = { disallow: [], allow: [] };
  let applies = false;
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      applies = value === '*' || value.toLowerCase().includes('delawaresceneeventindexer');
    } else if (applies && key === 'disallow' && value) {
      policy.disallow.push(value);
    } else if (applies && key === 'allow' && value) {
      policy.allow.push(value);
    }
  }
  return policy;
}

async function robotsFor(url: string): Promise<RobotsPolicy> {
  const origin = new URL(url).origin;
  let cached = robotsCache.get(origin);
  if (!cached) {
    cached = fetchText(`${origin}/robots.txt`, 0)
      .then((result) => parseRobots(result.body))
      .catch(() => ({ disallow: [], allow: [] }));
    robotsCache.set(origin, cached);
  }
  return cached;
}

function robotsPatternMatches(path: string, pattern: string): boolean {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*')
    .replace(/\$$/u, '$');
  try {
    return new RegExp(`^${expression}`, 'u').test(path);
  } catch {
    return path.startsWith(pattern);
  }
}

async function isAllowedByRobots(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const policy = await robotsFor(url);
  const matchingAllows = policy.allow.filter((rule) => robotsPatternMatches(path, rule));
  const matchingDisallows = policy.disallow.filter((rule) => robotsPatternMatches(path, rule));
  const longestAllow = Math.max(0, ...matchingAllows.map((rule) => rule.length));
  const longestDisallow = Math.max(0, ...matchingDisallows.map((rule) => rule.length));
  return longestDisallow === 0 || longestAllow >= longestDisallow;
}

function fieldValues(field: CanonicalSourceRecord['eventUrls']): string[] {
  return field.kind === 'values' ? [...field.values] : [];
}

function isDelawareSceneSource(source: CanonicalSourceRecord): boolean {
  return entryUrlsFor(source).some((value) => {
    try {
      return new URL(value).hostname.toLowerCase() === 'delawarescene.com';
    } catch {
      return false;
    }
  });
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function delawareSceneDiscoveryUrls(): string[] {
  return [
    'https://delawarescene.com/search/?dates=next7',
    ...Array.from({ length: DELAWARE_SCENE_DISCOVERY_DAYS }, (_unused, index) =>
      `https://delawarescene.com/search/?start=${addDays(TODAY, index)}`,
    ),
  ];
}

function isDirectPublicSocialEventUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return PUBLIC_SOCIAL_HOST.test(url.hostname) && DIRECT_PUBLIC_SOCIAL_EVENT.test(url.href);
  } catch {
    return false;
  }
}

function shouldStopSocialRecursion(value: string): boolean {
  try {
    return PUBLIC_SOCIAL_HOST.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function entryUrlsFor(source: CanonicalSourceRecord): string[] {
  return [
    ...new Set(
      [
        ...fieldValues(source.eventUrls),
        ...fieldValues(source.sitemapUrls),
        ...fieldValues(source.organizationUrls),
      ].filter(isSafePublicUrl),
    ),
  ];
}

function extractXmlLocations(body: string): string[] {
  return [...body.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/giu)]
    .map((match) => cleanText(match[1]) ?? '')
    .filter(Boolean);
}

function isSitemap(body: string, contentType: string, url: string): boolean {
  return (
    /(?:application|text)\/(?:[^;]+\+)?xml/iu.test(contentType) ||
    /(?:sitemap|\.xml(?:$|[?#]))/iu.test(url) ||
    /<(?:sitemapindex|urlset)\b/iu.test(body.slice(0, 1000))
  );
}

function isCalendar(body: string, contentType: string, url: string): boolean {
  return (
    contentType.includes('text/calendar') ||
    /\.ics(?:$|[?#])/iu.test(url) ||
    /^BEGIN:VCALENDAR/mu.test(body)
  );
}

function unfoldIcs(body: string): string[] {
  return body.replace(/\r?\n[ \t]/gu, '').split(/\r?\n/u);
}

function decodeIcs(value: string): string {
  return value
    .replace(/\\n/giu, '\n')
    .replace(/\\,/gu, ',')
    .replace(/\\;/gu, ';')
    .replace(/\\\\/gu, '\\');
}

function icsDate(value: string, parameters: string): { value: string; timezone?: string } | null {
  const raw = value.trim();
  if (/^\d{8}$/u.test(raw)) {
    return { value: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/u);
  if (!match) return null;
  const formatted = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ''}`;
  const timezone = parameters.match(/(?:^|;)TZID=([^;:]+)/iu)?.[1];
  return { value: formatted, timezone: match[7] ? 'UTC' : (timezone ?? DELAWARE_TIME_ZONE) };
}

function parseIcs(body: string, pageUrl: string, organization: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const lines = unfoldIcs(body);
  let block: string[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      block = [];
      continue;
    }
    if (line === 'END:VEVENT' && block) {
      const values = new Map<string, Array<{ parameters: string; value: string }>>();
      for (const item of block) {
        const separator = item.indexOf(':');
        if (separator < 0) continue;
        const keyAndParameters = item.slice(0, separator);
        const [key = '', ...parameterParts] = keyAndParameters.split(';');
        const existing = values.get(key.toUpperCase()) ?? [];
        existing.push({ parameters: parameterParts.join(';'), value: item.slice(separator + 1) });
        values.set(key.toUpperCase(), existing);
      }
      const title = cleanText(decodeIcs(values.get('SUMMARY')?.[0]?.value ?? ''));
      const startValue = values.get('DTSTART')?.[0];
      const start = startValue ? icsDate(startValue.value, startValue.parameters) : null;
      const endValue = values.get('DTEND')?.[0];
      const end = endValue ? icsDate(endValue.value, endValue.parameters) : null;
      if (title && start) {
        const eventUrl = resolveUrl(values.get('URL')?.[0]?.value, pageUrl) ?? pageUrl;
        events.push({
          sourceUrl: pageUrl,
          suppliedId: cleanText(values.get('UID')?.[0]?.value) ?? eventUrl,
          title,
          description: cleanText(decodeIcs(values.get('DESCRIPTION')?.[0]?.value ?? '')),
          categories: (values.get('CATEGORIES')?.[0]?.value ?? '')
            .split(',')
            .map((item) => cleanText(decodeIcs(item)))
            .filter((item): item is string => item !== null),
          organization,
          venue: cleanText(decodeIcs(values.get('LOCATION')?.[0]?.value ?? '')),
          city: null,
          region: null,
          cost: null,
          address: null,
          onlineLocationUrl: null,
          publicSourceUrl: eventUrl,
          ticketUrl: null,
          occurrences: [{ start: start.value, end: end?.value ?? null, timezone: start.timezone }],
        });
      }
      block = null;
      continue;
    }
    if (block) block.push(line);
  }
  return events;
}

function schemaTypes(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .map(asString)
    .filter((item): item is string => item !== null)
    .map((item) => item.split(/[/#]/u).at(-1) ?? item);
}

function collectSchemaEvents(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 10) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectSchemaEvents(item, depth + 1));
  const object = asObject(value);
  if (!object) return [];
  const own = schemaTypes(object['@type']).includes('Event') ? [object] : [];
  return [
    ...own,
    ...Object.entries(object)
      .filter(([key]) =>
        ['@graph', 'itemListElement', 'item', 'subEvent', 'subEvents', 'event'].includes(key),
      )
      .flatMap(([, child]) => collectSchemaEvents(child, depth + 1)),
  ];
}

function schemaAddress(value: unknown): {
  address: Record<string, string> | null;
  city: string | null;
} {
  const object = asObject(value);
  if (!object) return { address: null, city: null };
  const addressObject = asObject(object.address) ?? object;
  const mapping: Array<[string, string]> = [
    ['street', 'streetAddress'],
    ['city', 'addressLocality'],
    ['state', 'addressRegion'],
    ['postalCode', 'postalCode'],
    ['country', 'addressCountry'],
  ];
  const entries = mapping.flatMap(([output, input]) => {
    const text = textFrom(addressObject[input]);
    return text ? [[output, text] as const] : [];
  });
  return {
    address: entries.length > 0 ? Object.fromEntries(entries) : null,
    city: textFrom(addressObject.addressLocality),
  };
}

function regionForCity(city: string | null): string | null {
  if (!city) return null;
  const normalized = city.toLowerCase();
  if (/(?:wilmington|newark|new castle|middletown|claymont|hockessin|arden)/u.test(normalized)) {
    return 'Northern Delaware';
  }
  if (/(?:dover|milford|smyrna|clayton|harrington|felton)/u.test(normalized)) {
    return 'Central Delaware';
  }
  if (
    /(?:rehoboth|lewes|georgetown|seaford|bethany|fenwick|milton|delmar|laurel)/u.test(normalized)
  ) {
    return 'Southern Delaware';
  }
  return null;
}

function costFromOffers(value: unknown): { cost: string | null; ticketUrl: string | null } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    const object = asObject(offer);
    if (!object) continue;
    const price =
      asString(object.price) ?? (typeof object.price === 'number' ? String(object.price) : null);
    const currency = asString(object.priceCurrency);
    return {
      cost:
        price === '0'
          ? 'Free'
          : price
            ? `${currency === 'USD' ? '$' : currency ? `${currency} ` : ''}${price}`
            : null,
      ticketUrl: asString(object.url),
    };
  }
  return { cost: null, ticketUrl: null };
}

function extractSchemaEvent(
  object: Record<string, unknown>,
  pageUrl: string,
  fallbackOrganization: string,
): ExtractedEvent | null {
  const status = asString(object.eventStatus);
  if (status?.toLowerCase().includes('cancel')) return null;
  const title = textFrom(object.name) ?? textFrom(object.headline);
  const start = asString(object.startDate);
  if (!title || !start) return null;
  const locationObject = asObject(
    Array.isArray(object.location) ? object.location[0] : object.location,
  );
  const addressData = schemaAddress(locationObject?.address ?? locationObject);
  const virtualType = locationObject
    ? schemaTypes(locationObject['@type']).includes('VirtualLocation')
    : false;
  const publicUrl = resolveUrl(object.url ?? object['@id'], pageUrl) ?? pageUrl;
  const offer = costFromOffers(object.offers);
  const categories = stringsFrom(object.eventAttendanceMode).some((item) => item.includes('Online'))
    ? [...stringsFrom(object.category), 'Online']
    : stringsFrom(object.category);
  return {
    sourceUrl: pageUrl,
    suppliedId: asString(object.identifier) ?? asString(object['@id']) ?? publicUrl,
    title,
    description: textFrom(object.description),
    categories,
    organization: textFrom(object.organizer) ?? textFrom(object.performer) ?? fallbackOrganization,
    venue: virtualType ? null : textFrom(locationObject),
    city: addressData.city,
    region: regionForCity(addressData.city),
    cost: offer.cost,
    address: addressData.address,
    onlineLocationUrl: virtualType ? resolveUrl(locationObject?.url, pageUrl) : null,
    publicSourceUrl: publicUrl,
    ticketUrl: resolveUrl(offer.ticketUrl, pageUrl),
    occurrences: [
      {
        start,
        end: asString(object.endDate),
        timezone: /(?:Z|[+-]\d{2}:?\d{2}|\[[^\]]+\])$/u.test(start)
          ? undefined
          : DELAWARE_TIME_ZONE,
      },
    ],
  };
}

function extractJsonLd(html: string, pageUrl: string, organization: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/giu,
  );
  for (const match of scripts) {
    const source = decodeHtml((match[1] ?? '').trim())
      .replace(/^<!--|-->$/gu, '')
      .trim();
    if (!source) continue;
    try {
      const parsed: unknown = JSON.parse(source);
      for (const object of collectSchemaEvents(parsed)) {
        const event = extractSchemaEvent(object, pageUrl, organization);
        if (event) events.push(event);
      }
    } catch {
      // Invalid third-party JSON-LD is ignored while other extraction paths continue.
    }
  }
  return events;
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'iu',
    ),
    new RegExp(
      `<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
      'iu',
    ),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return cleanText(value);
  }
  return null;
}

const MONTH_NUMBER = new Map(
  [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].map((month, index) => [month, index + 1] as const),
);

interface NaturalDatePart {
  month: number;
  day: number;
  year: number | null;
  time: { hour: number; minute: number } | null;
}

function parseClock(value: string | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replaceAll('.', '');
  if (normalized === 'noon' || normalized === '12 noon') return { hour: 12, minute: 0 };
  if (normalized === 'midnight' || normalized === '12 midnight') return { hour: 0, minute: 0 };
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/u);
  if (!match) return null;
  const suppliedHour = Number(match[1]);
  if (suppliedHour < 1 || suppliedHour > 12) return null;
  const minute = Number(match[2] ?? 0);
  if (minute > 59) return null;
  return {
    hour: (suppliedHour % 12) + (match[3] === 'pm' ? 12 : 0),
    minute,
  };
}

function parseNaturalDatePart(
  value: string,
  fallbackMonth: number | null = null,
): NaturalDatePart | null {
  const cleaned = value
    .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = cleaned.match(
    /^(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,2})(?:,?\s+(\d{4}))?(?:\s*(?:@|at)\s*(.+))?$/iu,
  );
  if (!match) return null;
  const month = match[1] ? (MONTH_NUMBER.get(match[1].toLowerCase()) ?? null) : fallbackMonth;
  if (!month) return null;
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;
  const time = parseClock(match[4]);
  if (match[4] && !time) return null;
  return { month, day, year, time };
}

function inferredUpcomingYear(month: number, day: number): number {
  const currentYear = Number(TODAY.slice(0, 4));
  const candidate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return candidate < TODAY ? currentYear + 1 : currentYear;
}

function formatNaturalDate(
  part: NaturalDatePart,
  year: number,
  includeTime: boolean,
): string | null {
  const date = `${year}-${String(part.month).padStart(2, '0')}-${String(part.day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== part.month ||
    parsed.getUTCDate() !== part.day
  ) {
    return null;
  }
  if (!includeTime || !part.time) return date;
  return `${date}T${String(part.time.hour).padStart(2, '0')}:${String(part.time.minute).padStart(2, '0')}:00`;
}

function parseDelawareSceneSchedule(
  value: string,
): { start: string; end: string | null; timezone?: string } | null {
  const normalized = normalizeWhitespace(decodeHtml(value))
    .replace(/^now\s+(?:through|to)\s+/iu, `${TODAY.slice(5, 7)}/${TODAY.slice(8, 10)} through `)
    .replace(/\s+-\s+/gu, ' through ');
  const range = normalized.split(/\s+(?:through|to)\s+|(?<=\d)\s*[–—]\s*(?=[A-Za-z\d])/iu);
  const rawStart = range[0]?.trim();
  if (!rawStart) return null;
  let start = parseNaturalDatePart(rawStart);
  if (!start && /^\d{2}\/\d{2}$/u.test(rawStart)) {
    const [month, day] = rawStart.split('/').map(Number);
    if (month && day) start = { month, day, year: null, time: null };
  }
  if (!start) return null;
  const end = range[1] ? parseNaturalDatePart(range[1].trim(), start.month) : null;
  let startYear: number;
  let endYear: number | null = null;
  if (end) {
    endYear = end.year ?? inferredUpcomingYear(end.month, end.day);
    startYear = start.year ?? endYear - (start.month > end.month ? 1 : 0);
  } else {
    startYear = start.year ?? inferredUpcomingYear(start.month, start.day);
  }
  const useTime = end === null && start.time !== null;
  const startValue = formatNaturalDate(start, startYear, useTime);
  const endValue = end && endYear ? formatNaturalDate(end, endYear, false) : null;
  if (!startValue || (end && !endValue)) return null;
  return {
    start: startValue,
    end: endValue,
    timezone: useTime ? DELAWARE_TIME_ZONE : undefined,
  };
}

function htmlLines(value: string): string[] {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function extractDelawareSceneEvent(
  html: string,
  pageUrl: string,
  fallbackOrganization: string,
): ExtractedEvent[] {
  const url = new URL(pageUrl);
  if (url.hostname.toLowerCase() !== 'delawarescene.com' || !/^\/event\/\d+\//u.test(url.pathname)) {
    return [];
  }
  const contentStart = html.search(/<div\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>/iu);
  const relevant = contentStart >= 0 ? html.slice(contentStart) : html;
  const contentEnd = relevant.search(/<a\b[^>]*id=["']moar["']/iu);
  const content = contentEnd >= 0 ? relevant.slice(0, contentEnd) : relevant;
  const title = cleanText(content.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/iu)?.[1]);
  const scheduleText = cleanText(
    content.match(/class=["'][^"']*icon-calendar[^"']*["'][^>]*>([\s\S]*?)<\//iu)?.[1],
  );
  const schedule = scheduleText ? parseDelawareSceneSchedule(scheduleText) : null;
  if (!title || !schedule) return [];

  const introParagraphs = [...content.matchAll(/<p\b[^>]*class=["'][^"']*\bintro\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) => cleanText(match[1]))
    .filter((paragraph): paragraph is string => Boolean(paragraph));
  const presentedParagraph = introParagraphs.find((paragraph) => /^Presented by\b/iu.test(paragraph));
  const organization = presentedParagraph?.replace(/^Presented by\s*/iu, '').replace(/\.$/u, '') ?? fallbackOrganization;
  const description = introParagraphs.filter((paragraph) => !/^Presented by\b/iu.test(paragraph)).join('\n\n') || null;

  const tagsBlock = content.match(/<p\b[^>]*class=["'][^"']*\btags\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/iu)?.[1] ?? '';
  const tags = [...tagsBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => cleanText(match[1]))
    .filter((tag): tag is string => Boolean(tag));
  const region = tags.find((tag) => /^(?:Northern|Central|Southern) Delaware$/iu.test(tag)) ?? null;
  const categories = tags.filter((tag) => tag !== region);

  const venueBlock = content.match(/<h3>Venue<\/h3>\s*<div\b[^>]*class=["']info["'][^>]*>([\s\S]*?)<\/div>/iu)?.[1] ?? '';
  const venue = cleanText(venueBlock.match(/<a\b[^>]*>([\s\S]*?)<\/a>/iu)?.[1]) ?? htmlLines(venueBlock)[0] ?? null;
  const addressLines = htmlLines(venueBlock);
  if (venue && addressLines[0] === venue) addressLines.shift();
  const locality = addressLines.at(-1) ?? '';
  const localityMatch = locality.match(/^(.+?),\s*DE(?:\s+(\d{5}(?:-\d{4})?))?$/iu);
  const city = localityMatch?.[1]?.trim() ?? null;
  const streetLines = localityMatch ? addressLines.slice(0, -1) : addressLines;
  const addressEntries: Array<[string, string]> = [];
  if (streetLines.length > 0) addressEntries.push(['street', streetLines.join(', ')]);
  if (city) addressEntries.push(['city', city]);
  if (localityMatch) addressEntries.push(['state', 'DE']);
  if (localityMatch?.[2]) addressEntries.push(['postalCode', localityMatch[2]]);

  const cost = cleanText(
    content.match(/class=["'][^"']*icon-price[^"']*["'][^>]*>([\s\S]*?)<\//iu)?.[1],
  );
  const anchors = [...content.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)];
  const ticketAnchor = anchors.find((match) => /^get tickets$/iu.test(cleanText(match[2]) ?? ''));
  const ticketUrl = ticketAnchor ? resolveUrl(decodeHtml(ticketAnchor[1] ?? ''), pageUrl) : null;
  const suppliedId = url.pathname.match(/^\/event\/(\d+)/u)?.[1] ?? pageUrl;

  return [
    {
      sourceUrl: pageUrl,
      suppliedId,
      title,
      description,
      categories,
      organization,
      venue,
      city,
      region: region ?? regionForCity(city),
      cost,
      address: addressEntries.length > 0 ? Object.fromEntries(addressEntries) : null,
      onlineLocationUrl: null,
      publicSourceUrl: pageUrl,
      ticketUrl,
      occurrences: [schedule],
    },
  ];
}

function extractCivicPlusEvent(
  html: string,
  pageUrl: string,
  organization: string,
): ExtractedEvent[] {
  const url = new URL(pageUrl);
  if (!/\/calendar\.aspx$/iu.test(url.pathname) || !url.searchParams.has('EID')) return [];
  const title = cleanText(
    html.match(/id=["'][^"']*eventTitle["'][^>]*>([\s\S]*?)<\//iu)?.[1],
  ) ?? metaContent(html, 'og:title');
  const start = cleanText(
    html.match(/itemprop=["']startDate["'][^>]*>([\s\S]*?)<\//iu)?.[1],
  );
  if (!title || !start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(start)) return [];
  const end = cleanText(
    html.match(/itemprop=["']endDate["'][^>]*>([\s\S]*?)<\//iu)?.[1],
  );
  const locationSection = html.match(/itemprop=["']location["'][\s\S]*?<\/div>\s*<\/div>/iu)?.[0] ?? '';
  const venue = cleanText(locationSection.match(/itemprop=["']name["'][^>]*>([\s\S]*?)<\/div>/iu)?.[1]);
  const address: Array<[string, string]> = [];
  const addressFields: Array<[string, string]> = [
    ['street', 'streetAddress'],
    ['city', 'addressLocality'],
    ['state', 'addressRegion'],
    ['postalCode', 'postalCode'],
  ];
  for (const [output, property] of addressFields) {
    const value = cleanText(
      html.match(new RegExp(`itemprop=["']${property}["'][^>]*>([\\s\\S]*?)<\\/`, 'iu'))?.[1],
    );
    if (value) address.push([output, value]);
  }
  const city = address.find(([key]) => key === 'city')?.[1] ?? null;
  const description = cleanText(
    html.match(/itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/iu)?.[1],
  );
  const publicUrl = metaContent(html, 'og:url') ?? pageUrl;
  return [
    {
      sourceUrl: pageUrl,
      suppliedId: url.searchParams.get('EID'),
      title,
      description,
      categories: [],
      organization,
      venue,
      city,
      region: regionForCity(city),
      cost: null,
      address: address.length > 0 ? Object.fromEntries(address) : null,
      onlineLocationUrl: null,
      publicSourceUrl: publicUrl,
      ticketUrl: null,
      occurrences: [{ start, end, timezone: DELAWARE_TIME_ZONE }],
    },
  ];
}

function extractHtmlFallback(
  html: string,
  pageUrl: string,
  organization: string,
): ExtractedEvent[] {
  if (!EVENT_HINT.test(new URL(pageUrl).pathname) && metaContent(html, 'og:type') !== 'event')
    return [];
  const dateTimes = [...html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/giu)].map(
    (match) => match[1] ?? '',
  );
  const distinctDateTimes = [...new Set(dateTimes)];
  const isExplicitEventPage = metaContent(html, 'og:type') === 'event';
  if (distinctDateTimes.length > 2 && !isExplicitEventPage) return [];
  const start = distinctDateTimes.find((value) => /^\d{4}-\d{2}-\d{2}/u.test(value));
  const title =
    metaContent(html, 'og:title') ??
    cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]) ??
    cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]);
  if (!start || !title || GENERIC_EVENT_PAGE_TITLE.test(title)) return [];
  return [
    {
      sourceUrl: pageUrl,
      suppliedId: pageUrl,
      title,
      description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
      categories: [],
      organization,
      venue: null,
      city: null,
      region: null,
      cost: null,
      address: null,
      onlineLocationUrl: null,
      publicSourceUrl: metaContent(html, 'og:url') ?? pageUrl,
      ticketUrl: null,
      occurrences: [
        {
          start,
          end: dateTimes.find((value) => value !== start) ?? null,
          timezone: /(?:Z|[+-]\d{2}:?\d{2}|\[[^\]]+\])$/u.test(start)
            ? undefined
            : DELAWARE_TIME_ZONE,
        },
      ],
    },
  ];
}

function extractLinks(html: string, pageUrl: string): string[] {
  if (shouldStopSocialRecursion(pageUrl)) return [];
  const currentUrl = new URL(pageUrl);
  const pageOrigin = currentUrl.origin;
  const isCivicPlusPage = /\/calendar\.aspx$/iu.test(currentUrl.pathname);
  if (isCivicPlusPage && currentUrl.searchParams.has('EID')) return [];
  const candidates = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/giu)) {
    const resolved = resolveUrl(decodeHtml(match[1] ?? ''), pageUrl);
    if (!resolved || !isSafePublicUrl(resolved) || IGNORED_ASSET.test(resolved)) continue;
    const url = new URL(resolved);
    const isCalendarLink = /\.ics(?:$|[?#])/iu.test(resolved);
    const isSocialEvent = isDirectPublicSocialEventUrl(resolved);
    const isSameOrigin = url.origin === pageOrigin;
    if (!isSameOrigin && !isCalendarLink && !isSocialEvent) continue;
    const isCivicPlusDetail = /\/calendar\.aspx$/iu.test(url.pathname) && url.searchParams.has('EID');
    const isCivicPlusNavigation =
      /\/calendar\.aspx$/iu.test(url.pathname) && !url.searchParams.has('EID');
    if ((isCivicPlusPage && !isCivicPlusDetail) || isCivicPlusNavigation) continue;
    const isDirectEventPage = /\/events?\/[^/]+/iu.test(url.pathname) || isCivicPlusDetail;
    if (!isCalendarLink && !isSocialEvent && !EVENT_HINT.test(url.pathname)) continue;
    const priority =
      isSocialEvent || isCalendarLink || isCivicPlusDetail || isDirectEventPage ? 0 : 1;
    const existing = candidates.get(resolved);
    if (existing === undefined || priority < existing) candidates.set(resolved, priority);
  }
  return [...candidates]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_DISCOVERED_LINKS_PER_PAGE)
    .map(([url]) => url);
}

function normalizeDateInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/u.test(trimmed)) return trimmed.replace(/\s+/u, 'T');
  return trimmed;
}

function toEventRecord(
  source: CanonicalSourceRecord,
  extracted: ExtractedEvent,
  retrievedAt: string,
): EventRecord | null {
  if (/\b(?:cancelled|canceled)\b/iu.test(extracted.title.trim())) return null;
  const rawOccurrences: RawOccurrence[] = extracted.occurrences.map((occurrence, index) => ({
    id: stableUuid(
      `${source.id}|${extracted.suppliedId ?? extracted.sourceUrl}|${occurrence.start}|${index}`,
    ),
    start: normalizeDateInput(occurrence.start),
    end: occurrence.end ? normalizeDateInput(occurrence.end) : null,
    sourceTimezone: occurrence.timezone,
  }));
  const candidate: RawEventCandidate = {
    id: stableUuid(
      `${source.id}|${extracted.suppliedId ?? extracted.sourceUrl}|${extracted.title}|${rawOccurrences[0]?.start ?? ''}`,
    ),
    sourceRecordId: source.id,
    sourceCategory: source.sourceCategory,
    sourceUrl: extracted.sourceUrl,
    sourceSuppliedId: extracted.suppliedId,
    retrievedAt,
    title: extracted.title,
    description: extracted.description,
    categories: extracted.categories,
    organization: extracted.organization ?? source.organizationName,
    venue: extracted.venue,
    city: extracted.city,
    region: extracted.region,
    cost: extracted.cost,
    address: extracted.address,
    onlineLocationUrl: extracted.onlineLocationUrl,
    publicSourceUrl: extracted.publicSourceUrl ?? extracted.sourceUrl,
    ticketUrl: extracted.ticketUrl,
    occurrences: rawOccurrences,
  };
  const normalized = normalizeEvent(candidate);
  if (!normalized.ok) return null;
  const upcoming = normalized.value.occurrences.filter((occurrence) =>
    isUpcoming(occurrence, `${TODAY}T00:00:00-04:00`),
  );
  if (upcoming.length === 0) return null;
  if (upcoming.length !== normalized.value.occurrences.length) {
    const futureCandidate = {
      ...candidate,
      occurrences: rawOccurrences.filter((_occurrence, index) =>
        normalized.value.occurrences[index]
          ? upcoming.includes(normalized.value.occurrences[index])
          : false,
      ),
    };
    const future = normalizeEvent(futureCandidate);
    if (!future.ok) return null;
    return { ...future.value, publicationStatus: 'published' };
  }
  return { ...normalized.value, publicationStatus: 'published' };
}

export function dedupeText(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function eventDedupeKey(event: EventRecord): string {
  const first = event.occurrences[0];
  const start = first?.kind === 'date' ? first.startDate : (first?.startAt ?? '');
  const city = dedupeText(event.city ?? '');
  const location = city ? `city:${city}` : `venue:${dedupeText(event.venue ?? '')}`;
  return [dedupeText(event.title), start, location].join('|');
}

function eventCompletenessScore(event: EventRecord): number {
  const venue = dedupeText(event.venue ?? '');
  const usefulVenue = venue.length > 0 && venue !== 'event location' && venue !== '-';
  return (
    Math.min(3, Math.floor((event.description?.length ?? 0) / 250)) +
    (usefulVenue ? 3 : 0) +
    (event.city ? 2 : 0) +
    (event.address ? 3 : 0) +
    (event.ticketUrl ? 2 : 0) +
    (event.categories.length > 0 ? 1 : 0) +
    (event.organization ? 1 : 0)
  );
}

export function mergeEvents(events: readonly EventRecord[]): EventRecord[] {
  const merged = new Map<string, EventRecord>();
  const keyByEventId = new Map<string, string>();
  for (const event of [...events].sort((left, right) => left.id.localeCompare(right.id))) {
    const key = keyByEventId.get(event.id) ?? eventDedupeKey(event);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, structuredClone(event));
      keyByEventId.set(event.id, key);
      continue;
    }
    const preferred =
      eventCompletenessScore(event) > eventCompletenessScore(existing)
        ? structuredClone(event)
        : existing;
    preferred.provenance = [
      ...existing.provenance,
      ...event.provenance.filter(
        (candidate) =>
          !existing.provenance.some(
            (item) =>
              item.sourceRecordId === candidate.sourceRecordId &&
              item.sourceUrl === candidate.sourceUrl &&
              item.sourceSuppliedId === candidate.sourceSuppliedId &&
              item.retrievedAt === candidate.retrievedAt,
          ),
      ),
    ];
    merged.set(key, preferred);
    keyByEventId.set(existing.id, key);
    keyByEventId.set(event.id, key);
  }
  return [...merged.values()].sort((left, right) => {
    const leftOccurrence = left.occurrences[0];
    const rightOccurrence = right.occurrences[0];
    const leftStart =
      leftOccurrence?.kind === 'date' ? leftOccurrence.startDate : (leftOccurrence?.startAt ?? '');
    const rightStart =
      rightOccurrence?.kind === 'date'
        ? rightOccurrence.startDate
        : (rightOccurrence?.startAt ?? '');
    return (
      leftStart.localeCompare(rightStart) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
    );
  });
}

function normalizeQueuedUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

async function scrapeSource(
  source: CanonicalSourceRecord,
  retrievedAt: string,
): Promise<SourceScrapeResult> {
  const configuredEntryUrls = entryUrlsFor(source).map(normalizeQueuedUrl);
  const delawareScene = isDelawareSceneSource(source);
  const discoveryUrls = delawareScene ? delawareSceneDiscoveryUrls().map(normalizeQueuedUrl) : [];
  const entryUrls = [...new Set([...configuredEntryUrls, ...discoveryUrls])];
  const maxPages = delawareScene ? MAX_DELAWARE_SCENE_PAGES : MAX_PAGES_PER_SOURCE;
  const attemptedUrls: string[] = [];
  const errors: ScrapeError[] = [];
  const extracted: ExtractedEvent[] = [];
  const queue = [...entryUrls];
  const queued = new Set(queue);
  let pagesFetched = 0;
  let blocked = 0;

  while (queue.length > 0 && attemptedUrls.length < maxPages) {
    const url = queue.shift();
    if (!url) break;
    attemptedUrls.push(url);
    try {
      if (!(await isAllowedByRobots(url))) {
        blocked += 1;
        errors.push({ url, message: 'blocked by robots.txt' });
        continue;
      }
      if (delawareScene && new URL(url).hostname.toLowerCase() === 'delawarescene.com') {
        await new Promise((resolve) => setTimeout(resolve, DELAWARE_SCENE_REQUEST_DELAY_MS));
      }
      const page = await fetchText(url);
      pagesFetched += 1;
      if (isCalendar(page.body, page.contentType, page.url)) {
        extracted.push(...parseIcs(page.body, page.url, source.organizationName));
        continue;
      }
      if (isSitemap(page.body, page.contentType, page.url)) {
        const sitemapIsEventSpecific = EVENT_HINT.test(page.url);
        for (const location of extractXmlLocations(page.body)) {
          const resolved = resolveUrl(location, page.url);
          if (!resolved || !isSafePublicUrl(resolved) || queued.has(resolved)) continue;
          const isNestedSitemap = /(?:sitemap|\.xml(?:$|[?#]))/iu.test(resolved);
          if (
            isNestedSitemap ||
            sitemapIsEventSpecific ||
            EVENT_HINT.test(new URL(resolved).pathname)
          ) {
            const normalized = normalizeQueuedUrl(resolved);
            if (!queued.has(normalized)) {
              queued.add(normalized);
              queue.push(normalized);
            }
          }
        }
        continue;
      }
      const structuredEvents = [
        ...extractJsonLd(page.body, page.url, source.organizationName),
        ...extractDelawareSceneEvent(page.body, page.url, source.organizationName),
        ...extractCivicPlusEvent(page.body, page.url, source.organizationName),
      ];
      extracted.push(...structuredEvents);
      if (structuredEvents.length === 0) {
        extracted.push(...extractHtmlFallback(page.body, page.url, source.organizationName));
      }
      for (const link of extractLinks(page.body, page.url)) {
        const normalized = normalizeQueuedUrl(link);
        if (!queued.has(normalized)) {
          queued.add(normalized);
          queue.push(normalized);
        }
      }
    } catch (error) {
      errors.push({ url, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const normalized = extracted.flatMap((event) => {
    const record = toEventRecord(source, event, retrievedAt);
    return record ? [record] : [];
  });
  const accepted = mergeEvents(normalized);
  const status: SourceStatus =
    accepted.length > 0
      ? 'completed'
      : pagesFetched > 0
        ? 'completed-no-events'
        : blocked === attemptedUrls.length && blocked > 0
          ? 'blocked'
          : 'failed';
  return {
    report: {
      sourceId: source.id,
      organizationName: source.organizationName,
      sourceCategory: source.sourceCategory,
      status,
      entryUrls,
      attemptedUrls,
      pagesFetched,
      eventsExtracted: extracted.length,
      eventsAccepted: accepted.length,
      errors: errors.slice(0, 25),
    },
    events: accepted,
  };
}

async function concurrentMap<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function occurrenceValues(event: EventRecord): {
  starts: string;
  ends: string;
  timezones: string;
} {
  return {
    starts: event.occurrences
      .map((occurrence) =>
        occurrence.kind === 'date' ? occurrence.startDate : occurrence.startAt,
      )
      .join('; '),
    ends: event.occurrences
      .map((occurrence) =>
        occurrence.kind === 'date' ? (occurrence.endDate ?? '') : (occurrence.endAt ?? ''),
      )
      .join('; '),
    timezones: event.occurrences
      .map((occurrence) => (occurrence.kind === 'instant' ? occurrence.sourceTimezone : 'date-only'))
      .join('; '),
  };
}

export function serializeMasterEvents(events: readonly EventRecord[]): string {
  const headers = [
    'Event ID',
    'Title',
    'Start',
    'End',
    'Timezone',
    'Organization',
    'Venue',
    'Address',
    'City',
    'Region',
    'Categories',
    'Cost',
    'Description',
    'Public Source URL',
    'Ticket URL',
    'Source Category',
    'Source Record IDs',
    'Source Supplied IDs',
    'Source URLs',
    'Retrieved At',
  ];
  const rows = events.map((event) => {
    const occurrences = occurrenceValues(event);
    const provenance = [...event.provenance].sort(
      (left, right) =>
        left.sourceRecordId.localeCompare(right.sourceRecordId) ||
        left.sourceUrl.localeCompare(right.sourceUrl),
    );
    return [
      event.id,
      event.title,
      occurrences.starts,
      occurrences.ends,
      occurrences.timezones,
      event.organization ?? '',
      event.venue ?? '',
      event.address ? JSON.stringify(event.address) : '',
      event.city ?? '',
      event.region ?? '',
      event.categories.join('; '),
      event.cost ?? '',
      event.description ?? '',
      event.publicSourceUrl ?? '',
      event.ticketUrl ?? '',
      event.sourceCategory,
      [...new Set(provenance.map((item) => item.sourceRecordId))].join('; '),
      [...new Set(provenance.map((item) => item.sourceSuppliedId).filter((value) => value !== null))].join(
        '; ',
      ),
      [...new Set(provenance.map((item) => item.sourceUrl))].join('; '),
      [...new Set(provenance.map((item) => item.retrievedAt))].join('; '),
    ]
      .map((value) => quoteCsv(value))
      .join(',');
  });
  return `${[headers.join(','), ...rows].join('\r\n')}\r\n`;
}

export async function writeAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
}

export function hasSceneScoutProvenance(event: EventRecord): boolean {
  return event.provenance.some((item) => item.sourceSuppliedId?.startsWith('scenescout:'));
}

export async function runScrape(): Promise<void> {
  const root = process.cwd();
  const statePath = join(root, 'data', 'generated', 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')) as {
    sources: CanonicalSourceRecord[];
  };
  const sources = state.sources.filter((source) => source.collectionState === 'enabled');
  if (sources.length === 0) throw new Error('No enabled canonical sources are available.');

  const startedAt = new Date().toISOString();
  console.log(
    `Scraping ${sources.length} enabled event sources with concurrency ${SOURCE_CONCURRENCY}.`,
  );
  const results = await concurrentMap(sources, SOURCE_CONCURRENCY, async (source, index) => {
    const result = await scrapeSource(source, startedAt);
    console.log(
      `[${index + 1}/${sources.length}] ${source.organizationName}: ${result.report.status}, ${result.report.eventsAccepted} accepted event(s), ${result.report.pagesFetched} page(s)`,
    );
    return result;
  });

  const scrapedEvents = mergeEvents(results.flatMap((result) => result.events));
  const repository = new JsonEventRepository(new JsonStateStore(statePath));
  const retainedSceneScoutEvents = (await repository.list()).filter(hasSceneScoutProvenance);
  const events = mergeEvents([...scrapedEvents, ...retainedSceneScoutEvents]);
  await repository.replaceAll(events);

  const sourceStatusCounts: Record<SourceStatus, number> = {
    completed: 0,
    'completed-no-events': 0,
    blocked: 0,
    failed: 0,
  };
  for (const result of results) sourceStatusCounts[result.report.status] += 1;
  const report: ScrapeReport = {
    startedAt,
    completedAt: new Date().toISOString(),
    sourceCount: sources.length,
    sourceStatusCounts,
    pagesFetched: results.reduce((sum, result) => sum + result.report.pagesFetched, 0),
    eventsExtracted: results.reduce((sum, result) => sum + result.report.eventsExtracted, 0),
    eventsAccepted: events.length,
    sources: results.map((result) => result.report),
  };
  await writeAtomically(
    join(root, 'data', 'generated', 'master-events.csv'),
    serializeMasterEvents(events),
  );
  await writeAtomically(
    join(root, 'data', 'generated', 'scrape-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `Persisted ${events.length} real upcoming event(s), including ${retainedSceneScoutEvents.length} retained SceneScout event(s), from ${sources.length} source(s) and exported data/generated/master-events.csv. Statuses: ${JSON.stringify(sourceStatusCounts)}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runScrape();
}
