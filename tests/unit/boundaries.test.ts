import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

async function imports(directory: string): Promise<string[]> {
  const files = await sourceFiles(directory);
  const values: string[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
      if (match[1]) values.push(match[1]);
    }
  }
  return values;
}

describe('architecture boundaries', () => {
  it('keeps domain and contracts independent of application adapters', async () => {
    const values = [
      ...(await imports(join(process.cwd(), 'packages', 'domain', 'src'))),
      ...(await imports(join(process.cwd(), 'packages', 'contracts', 'src'))),
    ];
    expect(values.filter((value) => value.startsWith('@delaware-scene/'))).toEqual([]);
  });

  it('keeps the application layer on contracts and domain ports only', async () => {
    const values = (await imports(join(process.cwd(), 'packages', 'application', 'src'))).filter(
      (value) => value.startsWith('@delaware-scene/'),
    );
    expect(new Set(values)).toEqual(
      new Set(['@delaware-scene/contracts', '@delaware-scene/domain']),
    );
  });

  it('keeps browser code isolated from domain and persistence modules', async () => {
    const values = await imports(join(process.cwd(), 'apps', 'web', 'src'));
    expect(
      values.filter((value) =>
        [
          '@delaware-scene/domain',
          '@delaware-scene/application',
          '@delaware-scene/database',
          '@delaware-scene/ingestion',
        ].includes(value),
      ),
    ).toEqual([]);
  });
});
