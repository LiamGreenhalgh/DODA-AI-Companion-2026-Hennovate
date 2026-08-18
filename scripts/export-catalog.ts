import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStateStore } from '../packages/database/src/index.js';
import { CanonicalSourceCatalogSerializer } from '../packages/ingestion/src/index.js';

const root = process.cwd();
const store = new JsonStateStore(join(root, 'data', 'generated', 'state.json'));
const state = await store.read();
const output = join(root, 'data', 'generated', 'canonical-source-catalog.csv');
await writeFile(output, new CanonicalSourceCatalogSerializer().serialize(state.sources), 'utf8');
console.log(`Exported ${state.sources.length} source records to ${output}.`);
