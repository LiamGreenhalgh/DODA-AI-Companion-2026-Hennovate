import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  AUTHORITATIVE_FILE_NAMES,
  type AuthoritativeCatalogFileName,
  type CanonicalSourceRecord,
} from '../packages/domain/src/index.js';
import { JsonStateStore } from '../packages/database/src/index.js';
import {
  decodeUtf8Catalog,
  parseAuthoritativeCatalog,
  serializeCanonicalCatalog,
  type CatalogImportResult,
} from '../packages/ingestion/src/index.js';
import { syncCatalogs } from './sync-catalogs.js';

function selectedFiles(arguments_: readonly string[]): readonly AuthoritativeCatalogFileName[] {
  if (arguments_.length === 0 || arguments_.includes('--all')) return AUTHORITATIVE_FILE_NAMES;
  const fileIndex = arguments_.indexOf('--file');
  const supplied = fileIndex >= 0 ? arguments_[fileIndex + 1] : undefined;
  if (!supplied) throw new Error('Use --all or --file <exact-authoritative-file-name>.');
  const fileName = basename(supplied);
  if (!AUTHORITATIVE_FILE_NAMES.includes(fileName as AuthoritativeCatalogFileName)) {
    throw new Error(`Unknown authoritative catalog file: ${fileName}`);
  }
  return [fileName as AuthoritativeCatalogFileName];
}

function formatErrors(fileName: string, errors: readonly { fileName?: string; physicalRow?: number; path: string; message: string }[]): string[] {
  return errors.map(
    (error) =>
      `${error.fileName ?? fileName}:${error.physicalRow ?? '?'}:${error.path}: ${error.message}`,
  );
}

function orderedSources(records: readonly CanonicalSourceRecord[]): CanonicalSourceRecord[] {
  const fileOrder = new Map(AUTHORITATIVE_FILE_NAMES.map((fileName, index) => [fileName, index]));
  return [...records].sort(
    (left, right) =>
      (fileOrder.get(left.catalogFileName as AuthoritativeCatalogFileName) ?? Number.MAX_SAFE_INTEGER) -
        (fileOrder.get(right.catalogFileName as AuthoritativeCatalogFileName) ?? Number.MAX_SAFE_INTEGER) ||
      left.physicalRow - right.physicalRow ||
      left.organizationName.localeCompare(right.organizationName),
  );
}

const root = process.cwd();
const files = selectedFiles(process.argv.slice(2));
await syncCatalogs(root);
const parsedFiles: CatalogImportResult[] = [];
const errors: string[] = [];
for (const fileName of files) {
  const bytes = await readFile(join(root, 'data', 'source-catalogs', fileName));
  const decoded = decodeUtf8Catalog(bytes);
  if (!decoded.ok) {
    errors.push(...formatErrors(fileName, decoded.errors));
    continue;
  }
  const parsed = parseAuthoritativeCatalog(fileName, decoded.value);
  if (parsed.ok) parsedFiles.push(parsed.value);
  else errors.push(...formatErrors(fileName, parsed.errors));
}
if (errors.length > 0) throw new Error(`Catalog import rejected atomically:\n${errors.join('\n')}`);

const store = new JsonStateStore(join(root, 'data', 'generated', 'state.json'));
const persisted = await store.update((state) => {
  const replacedCategories = new Set(parsedFiles.map((result) => result.category));
  const previousStates = new Map(
    state.sources.map((source) => [source.id, source.collectionState] as const),
  );
  const retained = state.sources.filter(
    (source) => !replacedCategories.has(source.sourceCategory),
  );
  const imported = parsedFiles.flatMap((result) =>
    result.records.map((record) => ({
      ...record,
      collectionState: previousStates.get(record.id) ?? 'enabled',
    })),
  );
  return {
    ...state,
    sources: orderedSources([...retained, ...imported]),
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
});
await writeFile(
  join(root, 'data', 'generated', 'canonical-source-catalog.csv'),
  serializeCanonicalCatalog(persisted.sources),
  'utf8',
);
console.log(
  `Imported ${parsedFiles.reduce((count, result) => count + result.records.length, 0)} source records from ${files.length} authoritative catalog(s).`,
);
