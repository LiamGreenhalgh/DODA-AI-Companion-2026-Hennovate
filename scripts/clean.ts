import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['apps', 'packages'];
for (const root of roots) {
  const directory = join(process.cwd(), root);
  // Individual package outputs are known and bounded; source/data are never removed.
  const patternTargets = root === 'apps' ? ['server', 'worker', 'web'] : [
    'contracts', 'domain', 'application', 'ingestion', 'database', 'auth', 'observability', 'test-support', 'ui',
  ];
  for (const target of patternTargets) {
    await rm(join(directory, target, 'dist'), { recursive: true, force: true });
    await rm(join(directory, target, '.types'), { recursive: true, force: true });
  }
}
console.log('Removed generated TypeScript and web build outputs.');
