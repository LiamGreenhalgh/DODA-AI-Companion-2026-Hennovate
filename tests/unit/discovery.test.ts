import { describe, expect, it } from 'vitest';
import type { CanonicalSourceRecord } from '@delaware-scene/domain';
import {
  AdapterRegistry,
  DISCOVERY_URL_LIMIT,
  selectAdapter,
  selectDiscoveryUrls,
  type SourceAdapter,
} from '@delaware-scene/ingestion';
import { buildSource } from '@delaware-scene/test-support';

interface TestAdapter extends SourceAdapter {
  readonly retrieve: () => void;
}

function testAdapter(
  key: string,
  supports: SourceAdapter['supports'],
  retrieve: () => void = () => undefined,
): TestAdapter {
  return { key, supports, retrieve };
}

describe('discovery URL selection', () => {
  it('prefers event URLs and preserves first-occurrence catalog order without mutating the source', () => {
    const first = 'https://events.example.org/first';
    const second = 'https://events.example.org/second';
    const source = buildSource({
      organizationUrls: { kind: 'values', values: ['https://organization.example.org/'] },
      sitemapUrls: { kind: 'values', values: ['https://organization.example.org/sitemap.xml'] },
      eventUrls: { kind: 'values', values: [first, second, first] },
    });
    const before = structuredClone(source);

    expect(selectDiscoveryUrls(source)).toEqual({
      urls: [first, second],
      omittedCount: 0,
    });
    expect(source).toEqual(before);
  });

  it('falls back to organization URLs followed by sitemap URLs for every absent event-URL state', () => {
    const organization = 'https://organization.example.org/';
    const shared = 'https://shared.example.org/';
    const sitemap = 'https://organization.example.org/sitemap.xml';
    const absentEventFields: CanonicalSourceRecord['eventUrls'][] = [
      { kind: 'known-absence' },
      { kind: 'unspecified' },
      { kind: 'values', values: [] },
    ];

    for (const eventUrls of absentEventFields) {
      const source = buildSource({
        organizationUrls: { kind: 'values', values: [organization, shared, organization] },
        sitemapUrls: { kind: 'values', values: [shared, sitemap, sitemap] },
        eventUrls,
      });

      expect(selectDiscoveryUrls(source)).toEqual({
        urls: [organization, shared, sitemap],
        omittedCount: 0,
      });
    }
  });

  it('excludes disabled sources from discovery', () => {
    const source = buildSource({
      collectionState: 'disabled',
      eventUrls: { kind: 'values', values: ['https://events.example.org/'] },
    });

    expect(selectDiscoveryUrls(source)).toEqual({ urls: [], omittedCount: 0 });
  });

  it('caps the distinct ordered result at 100 and counts only omitted distinct URLs', () => {
    const distinct = Array.from(
      { length: DISCOVERY_URL_LIMIT + 3 },
      (_, index) => `https://events-${index}.example.org/`,
    );
    const source = buildSource({
      eventUrls: {
        kind: 'values',
        values: [...distinct, distinct[0]!, distinct[DISCOVERY_URL_LIMIT + 2]!],
      },
    });

    expect(selectDiscoveryUrls(source)).toEqual({
      urls: distinct.slice(0, DISCOVERY_URL_LIMIT),
      omittedCount: 3,
    });
  });
});

describe('adapter registry resolution', () => {
  const source = buildSource({ id: 'source-adapter-test' });
  const discoveryUrl = 'https://events.example.org/';
  const input = { source, discoveryUrl };

  it('returns the one compatible registered adapter', () => {
    const incompatible = testAdapter('incompatible', () => false);
    const compatible = testAdapter(
      'public-web',
      ({ discoveryUrl: candidate }) => candidate === discoveryUrl,
    );

    const result = selectAdapter([incompatible, compatible], input);

    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.adapter).toBe(compatible);
  });

  it('returns a traceable unsupported result without invoking retrieval', () => {
    let retrievalCalls = 0;
    const adapters = [
      testAdapter('json', () => false, () => {
        retrievalCalls += 1;
      }),
      testAdapter('calendar', () => false, () => {
        retrievalCalls += 1;
      }),
    ];

    expect(new AdapterRegistry(adapters).resolve(input)).toEqual({
      kind: 'unsupported',
      sourceRecordId: source.id,
      discoveryUrl,
    });
    expect(retrievalCalls).toBe(0);
  });

  it('returns matching adapter keys in registry order on conflict without invoking retrieval', () => {
    let retrievalCalls = 0;
    const retrieve = (): void => {
      retrievalCalls += 1;
    };
    const adapters = [
      testAdapter('source-specific', () => true, retrieve),
      testAdapter('unrelated', () => false, retrieve),
      testAdapter('public-web', () => true, retrieve),
    ];

    expect(new AdapterRegistry(adapters).resolve(input)).toEqual({
      kind: 'conflict',
      sourceRecordId: source.id,
      discoveryUrl,
      adapterKeys: ['source-specific', 'public-web'],
    });
    expect(retrievalCalls).toBe(0);
  });

  it('snapshots registration order independently of later array changes', () => {
    const compatible = testAdapter('public-web', () => true);
    const registrations: SourceAdapter[] = [compatible];
    const registry = new AdapterRegistry(registrations);
    registrations.push(testAdapter('late-conflict', () => true));

    const result = registry.resolve(input);
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.adapter).toBe(compatible);
  });
});
