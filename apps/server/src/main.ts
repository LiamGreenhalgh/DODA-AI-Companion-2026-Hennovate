import { join } from 'node:path';
import { EnvironmentSecretProvider } from '@delaware-scene/auth';
import { JsonCatalogRepository, JsonEventRepository, JsonStateStore } from '@delaware-scene/database';
import { SystemClock } from '@delaware-scene/domain';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { resolveWorkspacePaths } from './paths.js';

const workspacePaths = resolveWorkspacePaths();
const config = loadConfig(process.env, process.cwd(), workspacePaths.defaultDataDirectory);
const store = new JsonStateStore(join(config.dataDirectory, 'state.json'));
const repository = new JsonEventRepository(store);
const sourceReader = new JsonCatalogRepository(store);
const app = await buildApp({
  config,
  repository,
  sourceReader,
  secretProvider: new EnvironmentSecretProvider(),
  clock: new SystemClock(),
  staticDirectory: workspacePaths.staticDirectory,
  logger: true,
});

const close = async (): Promise<void> => {
  await app.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({ host: config.host, port: config.port });
