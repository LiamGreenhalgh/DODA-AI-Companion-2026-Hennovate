import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_FILE_NAMES,
  CATEGORY_BY_FILE,
  type CanonicalSourceRecord,
  type Result,
  type SourceCategory,
} from '@delaware-scene/domain';
import {
  AtomicCatalogImporter,
  decodeUtf8Catalog,
  parseAuthoritativeCatalog,
  parseCanonicalCatalog,
  serializeCanonicalCatalog,
  type CatalogRepository,
} from '@delaware-scene/ingestion';

const canonicalHeader = 'Organization Name,Organization URL,Sitemap,Event Page';

function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function requireFailure<T>(result: Result<T>): Result<T> & { ok: false } {
  if (result.ok) throw new Error('Expected validation failure.');
  return result;
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

describe('authoritative source catalog import', () => {
  it('imports both populated supplied files and accepts both supplied zero-byte categories', async () => {
    let totalRecords = 0;
    for (const fileName of AUTHORITATIVE_FILE_NAMES) {
      const bytes = await readFile(join(process.cwd(), 'data', 'source-catalogs', fileName));
      const text = requireSuccess(decodeUtf8Catalog(bytes));
      const imported = requireSuccess(parseAuthoritativeCatalog(fileName, text));
      expect(imported.category).toBe(CATEGORY_BY_FILE[fileName]);
      expect(imported.physicalRowCount).toBe(imported.records.length);
      expect(
        imported.records.every(
          (record) =>
            record.catalogFileName === fileName &&
            record.sourceCategory === CATEGORY_BY_FILE[fileName] &&
            record.collectionState === 'enabled',
        ),
      ).toBe(true);
      if (fileName === 'Library Events.csv' || fileName === 'Government Events.csv') {
        expect(bytes.byteLength).toBe(0);
        expect(imported.records).toEqual([]);
      } else {
        expect(imported.records.length).toBeGreaterThan(0);
      }
      totalRecords += imported.records.length;
    }
    expect(totalRecords).toBe(98);
  });

  it('handles aliases, escaped quotes, quoted commas, Unicode, multiline fields, and ordered semicolon URLs', () => {
    const csv = [
      canonicalHeader,
      '"Delaware ""Música"",\r\nCollective"," example.org ; https://second.example.com/path ",NKS," ; http://events.example.net/list ; "',
      '',
    ].join('\r\n');
    const imported = requireSuccess(parseAuthoritativeCatalog('Government Events.csv', csv));
    expect(imported.records).toHaveLength(1);
    expect(imported.records[0]).toMatchObject({
      physicalRow: 2,
      organizationName: 'Delaware "Música",\nCollective',
      organizationUrls: {
        kind: 'values',
        values: ['https://example.org/', 'https://second.example.com/path'],
      },
      sitemapUrls: { kind: 'known-absence' },
      eventUrls: { kind: 'values', values: ['http://events.example.net/list'] },
    });
  });

  it('accepts either header alias set and rejects zero-byte populated categories', () => {
    const legacyHeader = 'Organization Name,Organization URL,Site Map,Events\r\n';
    const headerOnly = requireSuccess(
      parseAuthoritativeCatalog('Library Events.csv', legacyHeader),
    );
    expect(headerOnly.records).toEqual([]);
    expect(headerOnly.physicalRowCount).toBe(0);

    const missingHeader = requireFailure(
      parseAuthoritativeCatalog(
        'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
        '',
      ),
    );
    expect(missingHeader.errors).toEqual([
      expect.objectContaining({ code: 'missing_header', physicalRow: 1 }),
    ]);
  });

  it('rejects malformed RFC 4180 input and fatal UTF-8 with stable locations', () => {
    const malformed = requireFailure(
      parseAuthoritativeCatalog(
        'Government Events.csv',
        `${canonicalHeader}\r\n"Unterminated,https://example.org,,,`,
      ),
    );
    expect(malformed.errors).toEqual([
      expect.objectContaining({
        code: 'invalid_csv',
        fileName: 'Government Events.csv',
        physicalRow: 2,
      }),
    ]);

    const invalidUtf8 = requireFailure(decodeUtf8Catalog(new Uint8Array([0xc3, 0x28])));
    expect(invalidUtf8.errors).toEqual([
      expect.objectContaining({ code: 'invalid_encoding', path: 'csv' }),
    ]);
  });

  it('reports missing columns, required values, and invalid URLs deterministically', () => {
    const missingColumn = requireFailure(
      parseAuthoritativeCatalog(
        'Government Events.csv',
        'Organization Name,Organization URL,Event Page\r\nExample,example.org,',
      ),
    );
    expect(missingColumn.errors).toContainEqual(
      expect.objectContaining({ code: 'missing_column', path: 'Sitemap', physicalRow: 1 }),
    );

    const missingValues = requireFailure(
      parseAuthoritativeCatalog(
        'Government Events.csv',
        `${canonicalHeader}\r\n, , ,https://events.example.org`,
      ),
    );
    expect(missingValues.errors.map(({ code, path, physicalRow }) => ({ code, path, physicalRow })))
      .toEqual([
        { code: 'missing_required_field', path: 'Organization Name', physicalRow: 2 },
        { code: 'missing_required_field', path: 'Organization URL', physicalRow: 2 },
      ]);

    const invalidUrl = requireFailure(
      parseAuthoritativeCatalog(
        'Government Events.csv',
        `${canonicalHeader}\r\nExample,ftp://example.org,,`,
      ),
    );
    expect(invalidUrl.errors).toEqual([
      expect.objectContaining({
        code: 'invalid_url',
        path: 'Organization URL',
        fileName: 'Government Events.csv',
        physicalRow: 2,
      }),
    ]);
  });

  it('tracks the first physical line of records following multiline fields', () => {
    const csv = [
      canonicalHeader,
      '"Valid\r\nOrganization",https://valid.example.org,,',
      'Broken,,NKS,',
    ].join('\r\n');
    const imported = requireFailure(parseAuthoritativeCatalog('Government Events.csv', csv));
    expect(imported.errors).toContainEqual(
      expect.objectContaining({
        code: 'missing_required_field',
        path: 'Organization URL',
        physicalRow: 4,
      }),
    );
  });

  it('performs no repository write for a partially valid rejected file and enables valid new rows', async () => {
    const repository = new RecordingCatalogRepository();
    const importer = new AtomicCatalogImporter(repository);
    const rejected = await importer.import(
      'Government Events.csv',
      [
        canonicalHeader,
        'Valid,https://valid.example.org,,',
        'Invalid,not a URL,,',
      ].join('\r\n'),
    );
    expect(rejected.ok).toBe(false);
    expect(repository.calls).toEqual([]);

    const accepted = await importer.import(
      'Government Events.csv',
      `${canonicalHeader}\r\nValid,valid.example.org,,`,
    );
    expect(accepted.ok).toBe(true);
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]).toMatchObject({
      category: 'government',
      records: [{ collectionState: 'enabled', sourceCategory: 'government' }],
    });
  });

  it('serializes and parses canonical tri-state fields and URL order', () => {
    const authoritative = requireSuccess(
      parseAuthoritativeCatalog(
        'Government Events.csv',
        `${canonicalHeader}\r\n"Arts, Inc.","example.org; http://example.net/path",NKS,`,
      ),
    );
    const serialized = serializeCanonicalCatalog(authoritative.records);
    expect(serialized).toContain('Source Category,Organization Name,Organization URL,Sitemap,Event Page');
    expect(serialized).toContain('NKS');
    const restored = requireSuccess(parseCanonicalCatalog(serialized));
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      sourceCategory: 'government',
      organizationName: 'Arts, Inc.',
      organizationUrls: {
        kind: 'values',
        values: ['https://example.org/', 'http://example.net/path'],
      },
      sitemapUrls: { kind: 'known-absence' },
      eventUrls: { kind: 'unspecified' },
    });
  });
});
