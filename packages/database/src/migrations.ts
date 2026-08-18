import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';

export interface AppliedMigration {
  fileName: string;
}

export async function migrationFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((fileName) => /^\d+_[a-z0-9_-]+\.sql$/u.test(fileName))
    .sort((left, right) => left.localeCompare(right));
}

export async function runMigrationsWithClient(
  client: PoolClient,
  directory: string,
): Promise<AppliedMigration[]> {
  const applied: AppliedMigration[] = [];
  for (const fileName of await migrationFiles(directory)) {
    const sql = await readFile(resolve(directory, fileName), 'utf8');
    try {
      await client.query(sql);
      applied.push({ fileName });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  return applied;
}

export async function runMigrations(
  connectionString: string,
  directory: string,
): Promise<AppliedMigration[]> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await runMigrationsWithClient(client, directory);
  } finally {
    client.release();
    await pool.end();
  }
}

export function assertLocalMigrationTarget(connectionString: string): URL {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }
  if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('The local migration command refuses non-loopback databases.');
  }
  if (url.pathname === '/' || url.pathname.toLocaleLowerCase('en-US') === '/postgres') {
    throw new Error('The local migration command requires a named application database.');
  }
  return url;
}
