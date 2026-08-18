import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  AuthoritativeCatalogFileName,
  CanonicalSourceRecord,
  SourceCategory,
  ValidationIssue,
} from '@delaware-scene/domain';
import {
  AtomicCatalogImporter,
  type CatalogRepository,
} from '@delaware-scene/ingestion';
import { safeDomainArbitrary } from '@delaware-scene/test-support';

interface InvalidCatalogCase {
  fileName: string;
  text: string;
  expected: Pick<ValidationIssue, 'code' | 'path' | 'fileName'> & {
    physicalRow?: number;
  };
}

class RecordingCatalogRepository implements CatalogRepository {
  readonly calls: Array<{
    category: SourceCategory;
    records: readonly CanonicalSourceRecord[];
  }> = [];

  async replaceCategory(
    category: SourceCategory,
    records: readonly CanonicalSourceRecord[],
  ): Promise<void> {
    this.calls.push({ category, records: structuredClone(records) });
  }
}

const knownFileNameArbitrary = fc.constantFrom<AuthoritativeCatalogFileName>(
  'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
  'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
  'Library Events.csv',
  'Government Events.csv',
);
const header = 'Organization Name,Organization URL,Sitemap,Event Page';
const validRowArbitrary = fc
  .tuple(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,20}$/u), safeDomainArbitrary)
  .map(([name, domain]) => `${name},${domain},,`);
const prefixRowsArbitrary = fc.array(validRowArbitrary, { maxLength: 5 });

const unknownFileCaseArbitrary: fc.Arbitrary<InvalidCatalogCase> = fc
  .stringMatching(/^[A-Za-z0-9-]{1,20}$/u)
  .map((suffix) => {
    const fileName = `Unknown-${suffix}.csv`;
    return {
      fileName,
      text: `${header}\r\n`,
      expected: { code: 'unknown_catalog_file', path: 'fileName', fileName },
    };
  });

const missingValueCaseArbitrary: fc.Arbitrary<InvalidCatalogCase> = fc
  .tuple(
    knownFileNameArbitrary,
    prefixRowsArbitrary,
    fc.constantFrom<'Organization Name' | 'Organization URL'>(
      'Organization Name',
      'Organization URL',
    ),
    fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,20}$/u),
    safeDomainArbitrary,
  )
  .map(([fileName, prefixRows, missingField, name, domain]) => {
    const invalidRow =
      missingField === 'Organization Name' ? `,https://${domain},,` : `${name},,,`;
    return {
      fileName,
      text: [header, ...prefixRows, invalidRow].join('\r\n'),
      expected: {
        code: 'missing_required_field',
        path: missingField,
        fileName,
        physicalRow: prefixRows.length + 2,
      },
    };
  });

const invalidUrlCaseArbitrary: fc.Arbitrary<InvalidCatalogCase> = fc
  .tuple(
    knownFileNameArbitrary,
    prefixRowsArbitrary,
    fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,20}$/u),
    fc.constantFrom(
      'ftp://invalid.example.org',
      'javascript:alert(1)',
      'not a URL',
      'http://localhost',
    ),
  )
  .map(([fileName, prefixRows, name, invalidUrl]) => ({
    fileName,
    text: [header, ...prefixRows, `${name},${invalidUrl},,`].join('\r\n'),
    expected: {
      code: 'invalid_url',
      path: 'Organization URL',
      fileName,
      physicalRow: prefixRows.length + 2,
    },
  }));

const malformedCsvCaseArbitrary: fc.Arbitrary<InvalidCatalogCase> = fc
  .tuple(knownFileNameArbitrary, prefixRowsArbitrary)
  .map(([fileName, prefixRows]) => ({
    fileName,
    text: [header, ...prefixRows, '"unterminated'].join('\r\n'),
    expected: {
      code: 'invalid_csv',
      path: 'csv',
      fileName,
      physicalRow: prefixRows.length + 2,
    },
  }));

const missingColumnCaseArbitrary: fc.Arbitrary<InvalidCatalogCase> = fc
  .tuple(
    knownFileNameArbitrary,
    fc.constantFrom('Organization Name', 'Organization URL', 'Sitemap', 'Event Page'),
  )
  .map(([fileName, missingColumn]) => ({
    fileName,
    text: `${['Organization Name', 'Organization URL', 'Sitemap', 'Event Page']
      .filter((column) => column !== missingColumn)
      .join(',')}\r\n`,
    expected: {
      code: 'missing_column',
      path: missingColumn,
      fileName,
      physicalRow: 1,
    },
  }));

const invalidCatalogCaseArbitrary = fc.oneof(
  unknownFileCaseArbitrary,
  missingValueCaseArbitrary,
  invalidUrlCaseArbitrary,
  malformedCsvCaseArbitrary,
  missingColumnCaseArbitrary,
);

describe('invalid catalog properties', () => {
  it('rejects every invalid class before a repository write with deterministic metadata', async () => {
    // Feature: delaware-scene-full-stack-clone, Property 3: Invalid catalogs are rejected atomically with deterministic locations
    // **Validates: Requirements 2.5, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21**
    await fc.assert(
      fc.asyncProperty(invalidCatalogCaseArbitrary, async ({ fileName, text, expected }) => {
        const repository = new RecordingCatalogRepository();
        const importer = new AtomicCatalogImporter(repository);
        const first = await importer.import(fileName, text);
        const replay = await importer.import(fileName, text);

        expect(first.ok).toBe(false);
        expect(replay.ok).toBe(false);
        if (first.ok || replay.ok) return;
        expect(first.errors).toContainEqual(expect.objectContaining(expected));
        expect(replay.errors).toEqual(first.errors);
        expect(repository.calls).toEqual([]);
      }),
    );
  });
});
