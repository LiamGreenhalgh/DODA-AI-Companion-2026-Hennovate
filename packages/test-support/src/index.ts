import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Temporal } from '@js-temporal/polyfill';
import fc from 'fast-check';
import { Pool, type PoolClient } from 'pg';
import {
  CATEGORY_BY_FILE,
  type AuthoritativeCatalogFileName,
  type CanonicalSourceRecord,
  type Clock,
  type EventRecord,
  type IdGenerator,
  type SourceCategory,
  type UrlField,
} from '@delaware-scene/domain';

export class FakeClock implements Clock {
  #instant: Temporal.Instant;

  constructor(value = '2026-08-18T12:00:00Z') {
    this.#instant = Temporal.Instant.from(value);
  }

  now(): Temporal.Instant {
    return this.#instant;
  }

  today(zone: 'America/New_York'): Temporal.PlainDate {
    return this.#instant.toZonedDateTimeISO(zone).toPlainDate();
  }

  set(value: string): void {
    this.#instant = Temporal.Instant.from(value);
  }

  advance(duration: Temporal.DurationLike): void {
    this.#instant = this.#instant.add(duration);
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  #counter = 0;

  next(prefix = 'id'): string {
    this.#counter += 1;
    return `${prefix}-${String(this.#counter).padStart(4, '0')}`;
  }

  reset(): void {
    this.#counter = 0;
  }
}

export const safeDomainArbitrary = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9]{1,10}$/u), fc.constantFrom('org', 'com', 'net'))
  .map(([name, suffix]) => `${name}.${suffix}`);

export const absoluteHttpUrlArbitrary = fc
  .tuple(fc.constantFrom('http', 'https'), safeDomainArbitrary, fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/u), { maxLength: 3 }))
  .map(([scheme, domain, path]) => `${scheme}://${domain}/${path.join('/')}`);

export const urlFieldArbitrary: fc.Arbitrary<UrlField> = fc.oneof(
  fc.constant({ kind: 'known-absence' } as const),
  fc.constant({ kind: 'unspecified' } as const),
  fc
    .array(absoluteHttpUrlArbitrary, { minLength: 1, maxLength: 5 })
    .map((values) => ({ kind: 'values' as const, values })),
);

export function buildSource(
  overrides: Partial<CanonicalSourceRecord> = {},
): CanonicalSourceRecord {
  return {
    id: 'source-0001',
    catalogFileName: 'Government Events.csv',
    physicalRow: 2,
    sourceCategory: 'government',
    organizationName: 'Fixture Arts Organization',
    organizationUrls: { kind: 'values', values: ['https://example.org/'] },
    sitemapUrls: { kind: 'unspecified' },
    eventUrls: { kind: 'known-absence' },
    collectionState: 'enabled',
    ...overrides,
  };
}

export const canonicalSourceRecordArbitrary: fc.Arbitrary<CanonicalSourceRecord> = fc
  .record({
    fileName: fc.constantFrom<AuthoritativeCatalogFileName>(
      'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
      'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
      'Library Events.csv',
      'Government Events.csv',
    ),
    physicalRow: fc.integer({ min: 2, max: 10_000 }),
    organizationName: fc
      .string({ minLength: 1, maxLength: 80 })
      .map((value) => value.replace(/\r\n?/gu, '\n').trim())
      .filter((value: string) => value.length > 0 && !value.includes('\u0000')),
    organizationUrls: fc
      .array(absoluteHttpUrlArbitrary, { minLength: 1, maxLength: 4 })
      .map((values) => ({ kind: 'values' as const, values })),
    sitemapUrls: urlFieldArbitrary,
    eventUrls: urlFieldArbitrary,
    collectionState: fc.constantFrom('enabled' as const, 'disabled' as const),
  })
  .map((value) => ({
    id: `source-${value.fileName.length}-${value.physicalRow}-${Buffer.from(value.organizationName).toString('hex').slice(0, 12)}`,
    catalogFileName: value.fileName,
    physicalRow: value.physicalRow,
    sourceCategory: CATEGORY_BY_FILE[value.fileName],
    organizationName: value.organizationName,
    organizationUrls: value.organizationUrls,
    sitemapUrls: value.sitemapUrls,
    eventUrls: value.eventUrls,
    collectionState: value.collectionState,
  }));

export const canonicalCatalogArbitrary = fc.array(canonicalSourceRecordArbitrary, {
  minLength: 0,
  maxLength: 12,
});

export function buildEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'event-0001',
    canonicalIdentity: 'a'.repeat(64),
    identityVersion: 1,
    title: 'Community Arts Night',
    description: 'An independently authored fixture event.',
    categories: ['Visual Arts'],
    organization: 'Fixture Arts Organization',
    venue: 'Fixture Hall',
    city: 'Dover',
    region: 'Central Delaware',
    cost: 'Free',
    audience: 'All ages',
    accessibility: 'Wheelchair accessible',
    address: {
      street: '100 Example Avenue',
      city: 'Dover',
      state: 'DE',
      postalCode: '19901',
    },
    coordinates: { latitude: 39.1582, longitude: -75.5244 },
    onlineLocationUrl: null,
    publicSourceUrl: 'https://example.org/events/community-arts-night',
    ticketUrl: null,
    registrationUrl: null,
    attribution: 'Independent local fixture',
    rightsNotice: null,
    sourceCategory: 'government',
    publicationStatus: 'published',
    occurrences: [
      {
        id: 'occurrence-0001',
        kind: 'date',
        startDate: '2027-05-01',
        endDate: null,
        originalStart: '2027-05-01',
        originalEnd: null,
      },
    ],
    validationIssues: [],
    provenance: [
      {
        sourceRecordId: 'source-0001',
        sourceUrl: 'https://example.org/events/community-arts-night',
        sourceSuppliedId: 'fixture-1',
        retrievedAt: '2026-08-18T12:00:00Z',
      },
    ],
    version: 1,
    ...overrides,
  };
}

export function assertLoopbackUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error(`Network guard rejected non-loopback host: ${url.hostname}`);
  }
  return url;
}

export interface FixtureHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export class LoopbackFixtureHttpClient {
  readonly #requests: string[] = [];

  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  get requests(): readonly string[] {
    return [...this.#requests];
  }

  async get(rawUrl: string, signal?: AbortSignal): Promise<FixtureHttpResponse> {
    const url = assertLoopbackUrl(rawUrl);
    this.#requests.push(url.href);
    const response = await this.fetchImplementation(url, {
      method: 'GET',
      redirect: 'manual',
      signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}

export interface TestResultManifest {
  schemaVersion: 1;
  runId: string;
  fixedDataRevision: string;
  seed: number;
  results: Array<{ testId: string; outcome: 'passed' | 'failed' | 'skipped' }>;
}

function canonicalManifest(manifest: TestResultManifest): TestResultManifest {
  const results = [...manifest.results].sort((left, right) => left.testId.localeCompare(right.testId));
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.testId)) throw new Error(`Duplicate test result: ${result.testId}`);
    seen.add(result.testId);
  }
  return { ...manifest, results };
}

export async function writeTestResultManifest(
  filePath: string,
  manifest: TestResultManifest,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(canonicalManifest(manifest), null, 2)}\n`, 'utf8');
}

export async function readTestResultManifest(filePath: string): Promise<TestResultManifest> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as TestResultManifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.results)) {
    throw new Error('Unsupported test-result manifest.');
  }
  return canonicalManifest(parsed);
}

export function equivalentTestOutcomes(
  manifests: readonly TestResultManifest[],
): boolean {
  if (manifests.length < 2) return true;
  const [first, ...rest] = manifests.map(canonicalManifest);
  const expected = JSON.stringify(first?.results ?? []);
  return rest.every((manifest) => JSON.stringify(manifest.results) === expected);
}

export interface DisposablePostgresContext {
  client: PoolClient;
  schema: string;
}

export function assertSafeTestDatabaseUrl(connectionString: string): URL {
  const url = new URL(connectionString);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
  }
  if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('Integration tests may connect only to a loopback PostgreSQL server.');
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1)).toLocaleLowerCase('en-US');
  if (!databaseName.includes('test')) {
    throw new Error('TEST_DATABASE_URL database name must contain "test".');
  }
  return url;
}

export async function withDisposablePostgresSchema<T>(
  connectionString: string,
  work: (context: DisposablePostgresContext) => Promise<T>,
): Promise<T> {
  assertSafeTestDatabaseUrl(connectionString);
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    await client.query(`CREATE SCHEMA ${quoted}`);
    await client.query(`SET search_path TO ${quoted}, public`);
    return await work({ client, schema });
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    client.release();
    await pool.end();
  }
}

export function sourceCategoryFor(fileName: AuthoritativeCatalogFileName): SourceCategory {
  return CATEGORY_BY_FILE[fileName];
}
