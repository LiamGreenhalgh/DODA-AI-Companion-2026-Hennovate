import { join } from 'node:path';
import {
  assertLocalMigrationTarget,
  runMigrations,
} from '../packages/database/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required and must be supplied through the designated local secret environment.');
}
assertLocalMigrationTarget(connectionString);
const applied = await runMigrations(
  connectionString,
  join(process.cwd(), 'packages', 'database', 'migrations'),
);
console.log(`Validated and applied ${applied.length} local migration file(s).`);
