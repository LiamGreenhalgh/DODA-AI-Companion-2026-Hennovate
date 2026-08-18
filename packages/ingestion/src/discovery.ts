import type { CanonicalSourceRecord } from '@delaware-scene/domain';

export const DISCOVERY_URL_LIMIT = 100 as const;

function values(field: CanonicalSourceRecord['eventUrls']): readonly string[] {
  return field.kind === 'values' ? field.values : [];
}

function firstDistinctUrls(candidates: readonly string[]): string[] {
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    distinct.push(url);
  }
  return distinct;
}

export interface DiscoverySelection {
  urls: string[];
  omittedCount: number;
}

export function selectDiscoveryUrls(source: CanonicalSourceRecord): DiscoverySelection {
  if (source.collectionState === 'disabled') return { urls: [], omittedCount: 0 };

  const eventUrls = values(source.eventUrls);
  const candidates =
    eventUrls.length > 0
      ? eventUrls
      : [...values(source.organizationUrls), ...values(source.sitemapUrls)];
  const distinct = firstDistinctUrls(candidates);
  const urls = distinct.slice(0, DISCOVERY_URL_LIMIT);

  return { urls, omittedCount: distinct.length - urls.length };
}

export interface AdapterMatchInput {
  readonly source: CanonicalSourceRecord;
  readonly discoveryUrl: string;
}

export type AdapterSupportPredicate = (input: AdapterMatchInput) => boolean;

export interface SourceAdapter {
  readonly key: string;
  readonly supports: AdapterSupportPredicate;
}

export type AdapterSelection =
  | { kind: 'selected'; adapter: SourceAdapter }
  | { kind: 'unsupported'; sourceRecordId: string; discoveryUrl: string }
  | { kind: 'conflict'; sourceRecordId: string; discoveryUrl: string; adapterKeys: string[] };

export function selectAdapter(
  adapters: readonly SourceAdapter[],
  input: AdapterMatchInput,
): AdapterSelection {
  const matching = adapters.filter((adapter) => adapter.supports(input));
  if (matching.length === 0) {
    return { kind: 'unsupported', sourceRecordId: input.source.id, discoveryUrl: input.discoveryUrl };
  }
  if (matching.length > 1) {
    return {
      kind: 'conflict',
      sourceRecordId: input.source.id,
      discoveryUrl: input.discoveryUrl,
      adapterKeys: matching.map((adapter) => adapter.key),
    };
  }
  const adapter = matching[0];
  if (!adapter) throw new Error('Adapter cardinality invariant violated.');
  return { kind: 'selected', adapter };
}

export class AdapterRegistry {
  readonly #adapters: readonly SourceAdapter[];

  constructor(adapters: readonly SourceAdapter[] = []) {
    this.#adapters = [...adapters];
  }

  resolve(input: AdapterMatchInput): AdapterSelection {
    return selectAdapter(this.#adapters, input);
  }
}

export interface PageTraversalResult<T> {
  pages: T[];
  limitReached: boolean;
}

export function traversePages<T>(pages: readonly T[], pageLimit: number): PageTraversalResult<T> {
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000) {
    throw new RangeError('pageLimit must be a whole number from 1 through 1000');
  }
  return { pages: pages.slice(0, pageLimit), limitReached: pages.length > pageLimit };
}
