import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUTHORITATIVE_FILE_NAMES } from '../packages/domain/src/index.js';

export interface CatalogManifestEntry {
  fileName: string;
  byteLength: number;
  sha256: string;
}

export async function syncCatalogs(root = process.cwd()): Promise<CatalogManifestEntry[]> {
  const targetDirectory = join(root, 'data', 'source-catalogs');
  await mkdir(targetDirectory, { recursive: true });
  const entries: CatalogManifestEntry[] = [];
  for (const fileName of AUTHORITATIVE_FILE_NAMES) {
    const bytes = await readFile(join(root, fileName));
    await writeFile(join(targetDirectory, fileName), bytes);
    entries.push({
      fileName,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  await writeFile(
    join(targetDirectory, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
    'utf8',
  );
  return entries;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const entries = await syncCatalogs();
  console.log(`Synchronized ${entries.length} authoritative catalogs without changing source bytes.`);
}
