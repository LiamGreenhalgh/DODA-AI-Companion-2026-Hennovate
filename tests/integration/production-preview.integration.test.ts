import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');
const serverDirectory = resolve(workspaceRoot, 'apps', 'server');
const corepack = 'corepack';

let serverProcess: ChildProcessWithoutNullStreams | undefined;
let origin = '';
let serverOutput = '';

async function runBuild(): Promise<void> {
  const build = spawn(corepack, ['pnpm', 'build'], {
    cwd: workspaceRoot,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  const [exitCode] = (await once(build, 'exit')) as [number | null];
  if (exitCode !== 0) throw new Error(`Production build exited with code ${String(exitCode)}.`);
}

async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve a local test port.');
  const { port } = address;
  listener.close();
  await once(listener, 'close');
  return port;
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Production server exited before readiness.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${url}/api/v1/health/live`);
      if (response.ok) return;
    } catch {
      // The listener may not be bound yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Production server did not become ready.\n${serverOutput}`);
}

beforeAll(async () => {
  await runBuild();
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  const environment = { ...process.env };
  delete environment.DATA_DIRECTORY;
  serverProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: serverDirectory,
    env: {
      ...environment,
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      RELEASE_VERSION: 'production-preview-regression',
    },
    stdio: 'pipe',
  });
  serverProcess.stdout.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  await waitUntilReady(origin);
}, 120_000);

afterAll(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill('SIGTERM');
  await once(serverProcess, 'exit');
});

describe('production preview from the server package context', () => {
  it('serves built assets and SPA fallbacks while reading generated production data', async () => {
    const [home, spaFallback, events] = await Promise.all([
      fetch(`${origin}/`),
      fetch(`${origin}/events/client-side-route`),
      fetch(`${origin}/api/v1/events?pageSize=100`),
    ]);

    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(await home.text()).toContain('<div id="root"></div>');

    expect(spaFallback.status).toBe(200);
    expect(spaFallback.headers.get('content-type')).toContain('text/html');
    expect(await spaFallback.text()).toContain('<div id="root"></div>');

    expect(events.status).toBe(200);
    const body = (await events.json()) as {
      items: Array<{ publicSourceUrl: string | null }>;
      totalCount: number;
    };
    expect(body.totalCount).toBeGreaterThan(0);
    expect(body.items).toHaveLength(body.totalCount);
    expect(body.items.every((event) => !event.publicSourceUrl?.includes('example.org'))).toBe(true);
  });
});
