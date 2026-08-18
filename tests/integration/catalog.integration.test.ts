import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_FILE_NAMES,
  CATEGORY_BY_FILE,
  type AuthoritativeCatalogFileName,
} from '@delaware-scene/domain';
import {
  PostgresCatalogRepository,
  createPostgresDatabase,
  runMigrationsWithClient,
} from '@delaware-scene/database';
import {
  AtomicCatalogImporter,
  decodeUtf8Catalog,
  type CatalogImportResult,
} from '@delaware-scene/ingestion';
import { withDisposablePostgresSchema } from '@delaware-scene/test-support';

const connectionString = process.env.TEST_DATABASE_URL;
const databaseDescribe = connectionString ? describe : describe.skip;
const canonicalHeader = 'Organization Name,Organization URL,Sitemap,Event Page';

function schemaConnection(raw: string, schema: string): string {
  const url = new URL(raw);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  return url.href;
}

function requireImport(result: Awaited<ReturnType<AtomicCatalogImporter['import']>>): CatalogImportResult {
  if (!result.ok) throw new Error(`Expected import success: ${JSON.stringify(result.errors)}`);
  return result.value;
}

async function authoritativeText(fileName: AuthoritativeCatalogFileName): Promise<string> {
  const bytes = await readFile(join(process.cwd(), 'data', 'source-catalogs', fileName));
  const decoded = decodeUtf8Catalog(bytes);
  if (!decoded.ok) throw new Error(`Invalid supplied UTF-8: ${JSON.stringify(decoded.errors)}`);
  return decoded.value;
}

databaseDescribe('PostgreSQL source catalog repository', () => {
  it('atomically imports all four supplied catalogs with enabled defaults', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(
        client,
        join(process.cwd(), 'packages', 'database', 'migrations'),
      );
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresCatalogRepository(database);
      const importer = new AtomicCatalogImporter(repository);
      try {
        const results: CatalogImportResult[] = [];
        for (const fileName of AUTHORITATIVE_FILE_NAMES) {
          results.push(requireImport(await importer.import(fileName, await authoritativeText(fileName))));
        }
        expect(results.map(({ fileName, category }) => ({ fileName, category }))).toEqual(
          AUTHORITATIVE_FILE_NAMES.map((fileName) => ({
            fileName,
            category: CATEGORY_BY_FILE[fileName],
          })),
        );
        const records = await repository.listSources();
        expect(records).toHaveLength(98);
        expect(records.every((record) => record.collectionState === 'enabled')).toBe(true);
        expect(
          records.every(
            (record) =>
              CATEGORY_BY_FILE[record.catalogFileName as AuthoritativeCatalogFileName] ===
              record.sourceCategory,
          ),
        ).toBe(true);
      } finally {
        await database.destroy();
      }
    });
  });

  it('preserves disabled state and rolls back parser and transaction failures', async () => {
    await withDisposablePostgresSchema(connectionString as string, async ({ client, schema }) => {
      await runMigrationsWithClient(
        client,
        join(process.cwd(), 'packages', 'database', 'migrations'),
      );
      const database = createPostgresDatabase(schemaConnection(connectionString as string, schema));
      const repository = new PostgresCatalogRepository(database);
      const importer = new AtomicCatalogImporter(repository);
      const validCatalog = `${canonicalHeader}\r\nFixture,fixture.example.org,NKS,`;
      try {
        requireImport(await importer.import('Government Events.csv', validCatalog));
        const first = (await repository.listSources())[0];
        if (!first) throw new Error('Expected one persisted source.');
        await database
          .updateTable('source_records')
          .set({ collection_state: 'disabled' })
          .where('id', '=', first.id)
          .executeTakeFirstOrThrow();

        requireImport(await importer.import('Government Events.csv', validCatalog));
        const beforeFailure = await repository.listSources();
        expect(beforeFailure).toMatchObject([
          {
            id: first.id,
            collectionState: 'disabled',
            organizationUrls: { kind: 'values', values: ['https://fixture.example.org/'] },
          },
        ]);

        const rejected = await importer.import(
          'Government Events.csv',
          `${canonicalHeader}\r\nReplacement,not a URL,,`,
        );
        expect(rejected.ok).toBe(false);
        expect(await repository.listSources()).toEqual(beforeFailure);

        const persisted = beforeFailure[0];
        if (!persisted) throw new Error('Expected persisted source before transaction failure.');
        await expect(
          repository.replaceCategory('government', [
            {
              ...persisted,
              organizationUrls: { kind: 'values', values: ['not an absolute URL'] },
            },
          ]),
        ).rejects.toThrow();
        expect(await repository.listSources()).toEqual(beforeFailure);
      } finally {
        await database.destroy();
      }
    });
  });
});
