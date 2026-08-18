import { pathToFileURL } from 'node:url';
import { createLogger } from '@delaware-scene/observability';

export interface WorkerOptions {
  once?: boolean;
  signal?: AbortSignal;
}

/** Minimal composition root; durable queue polling is added by the ingestion slice. */
export async function runWorker(options: WorkerOptions = {}): Promise<void> {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
  logger.info({ worker: 'ingestion', mode: options.once ? 'once' : 'service' }, 'worker started');
  if (options.once) {
    logger.info({ worker: 'ingestion' }, 'no queued local jobs');
    return;
  }
  if (!options.signal) throw new Error('Long-running worker mode requires an AbortSignal.');
  await new Promise<void>((resolve) => {
    if (options.signal?.aborted) {
      resolve();
      return;
    }
    options.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  logger.info({ worker: 'ingestion' }, 'worker stopped cleanly');
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once') || process.env.NODE_ENV === 'test';
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  await runWorker({ once, signal: controller.signal });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
