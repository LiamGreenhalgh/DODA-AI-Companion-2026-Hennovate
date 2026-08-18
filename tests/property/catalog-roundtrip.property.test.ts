import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CanonicalSourceRecord, Result, UrlField } from '@delaware-scene/domain';
import {
  parseCanonicalCatalog,
  serializeCanonicalCatalog,
} from '@delaware-scene/ingestion';
import { canonicalCatalogArbitrary } from '@delaware-scene/test-support';

interface SemanticSourceRecord {
  organizationName: string;
  sourceCategory: CanonicalSourceRecord['sourceCategory'];
  organizationUrls: UrlField;
  sitemapUrls: UrlField;
  eventUrls: UrlField;
}

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Canonical parse failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function semanticCatalog(
  records: readonly CanonicalSourceRecord[],
): SemanticSourceRecord[] {
  return records.map((record) => ({
    organizationName: record.organizationName,
    sourceCategory: record.sourceCategory,
    organizationUrls: record.organizationUrls,
    sitemapUrls: record.sitemapUrls,
    eventUrls: record.eventUrls,
  }));
}

describe('canonical catalog round-trip properties', () => {
  it('preserves every defined semantic dimension through two parse/serialize cycles', () => {
    // Feature: delaware-scene-full-stack-clone, Property 4: Canonical source catalogs round-trip semantically
    // **Validates: Requirements 2.22, 2.23, 2.24, 14.9, 14.10**
    fc.assert(
      fc.property(canonicalCatalogArbitrary, (catalog) => {
        const firstSerialization = serializeCanonicalCatalog(catalog);
        const firstParse = requireSuccess(parseCanonicalCatalog(firstSerialization));
        const secondSerialization = serializeCanonicalCatalog(firstParse);
        const secondParse = requireSuccess(parseCanonicalCatalog(secondSerialization));

        expect(semanticCatalog(firstParse)).toEqual(semanticCatalog(catalog));
        expect(semanticCatalog(secondParse)).toEqual(semanticCatalog(firstParse));
        expect(secondSerialization).toBe(firstSerialization);
      }),
    );
  });
});
