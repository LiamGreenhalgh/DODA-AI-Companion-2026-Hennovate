import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_BY_FILE,
  type AuthoritativeCatalogFileName,
  type CanonicalSourceRecord,
  type SourceCategory,
} from '@delaware-scene/domain';
import {
  AtomicCatalogImporter,
  type CatalogRepository,
} from '@delaware-scene/ingestion';
import { safeDomainArbitrary } from '@delaware-scene/test-support';

interface RepositoryCall {
  category: SourceCategory;
  records: readonly CanonicalSourceRecord[];
}

class RecordingCatalogRepository implements CatalogRepository {
  readonly calls: RepositoryCall[] = [];

  async replaceCategory(
    category: SourceCategory,
    records: readonly CanonicalSourceRecord[],
  ): Promise<void> {
    this.calls.push({ category, records: structuredClone(records) });
  }
}

const fileNameArbitrary = fc.constantFrom<AuthoritativeCatalogFileName>(
  'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
  'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
  'Library Events.csv',
  'Government Events.csv',
);

const organizationNameArbitrary = fc.oneof(
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9 -]{0,30}$/u),
  fc.constantFrom('Música Delaware', 'Arts & Culture', 'Théâtre Community'),
);

const optionalUrlFieldArbitrary = fc.oneof(
  fc.constant(''),
  fc.constant('NKS'),
  safeDomainArbitrary,
  safeDomainArbitrary.map((domain) => `https://${domain}/events`),
);

const sourceRowArbitrary = fc.record({
  organizationName: organizationNameArbitrary,
  organizationUrl: safeDomainArbitrary,
  sitemap: optionalUrlFieldArbitrary,
  events: optionalUrlFieldArbitrary,
});

const validCatalogArbitrary = fc
  .record({
    fileName: fileNameArbitrary,
    rows: fc.array(sourceRowArbitrary, { minLength: 0, maxLength: 12 }),
    aliases: fc.constantFrom(
      ['Site Map', 'Events'] as const,
      ['Sitemap', 'Event Page'] as const,
    ),
    lineEnding: fc.constantFrom('\r\n', '\n'),
    preferZeroByte: fc.boolean(),
  })
  .map(({ fileName, rows, aliases, lineEnding, preferZeroByte }) => {
    const zeroByteAllowed = fileName === 'Library Events.csv' || fileName === 'Government Events.csv';
    const useZeroByte = rows.length === 0 && zeroByteAllowed && preferZeroByte;
    const header = `Organization Name,Organization URL,${aliases[0]},${aliases[1]}`;
    const data = rows.map(
      ({ organizationName, organizationUrl, sitemap, events }) =>
        `${organizationName},${organizationUrl},${sitemap},${events}`,
    );
    return {
      fileName,
      rows,
      text: useZeroByte ? '' : [header, ...data].join(lineEnding) + lineEnding,
    };
  });

describe('catalog mapping properties', () => {
  it('maps every valid physical record to the filename-derived category', async () => {
    // Feature: delaware-scene-full-stack-clone, Property 1: Authoritative catalog mapping is total and category-safe
    // **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7**
    await fc.assert(
      fc.asyncProperty(validCatalogArbitrary, async ({ fileName, rows, text }) => {
        const repository = new RecordingCatalogRepository();
        const result = await new AtomicCatalogImporter(repository).import(fileName, text);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const expectedCategory = CATEGORY_BY_FILE[fileName];
        expect(result.value.category).toBe(expectedCategory);
        expect(result.value.physicalRowCount).toBe(rows.length);
        expect(result.value.records).toHaveLength(rows.length);
        expect(
          result.value.records.every(
            (record) =>
              record.sourceCategory === expectedCategory &&
              record.catalogFileName === fileName &&
              record.collectionState === 'enabled',
          ),
        ).toBe(true);
        expect(repository.calls).toHaveLength(1);
        expect(repository.calls[0]?.category).toBe(expectedCategory);
        expect(repository.calls[0]?.records).toEqual(result.value.records);
      }),
    );
  });
});
