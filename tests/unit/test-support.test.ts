import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DeterministicIdGenerator,
  FakeClock,
  assertLoopbackUrl,
  assertSafeTestDatabaseUrl,
  equivalentTestOutcomes,
  readTestResultManifest,
  writeTestResultManifest,
  type TestResultManifest,
} from '@delaware-scene/test-support';

describe('deterministic test support', () => {
  it('provides controllable time and replayable identifiers', () => {
    const clock = new FakeClock('2026-03-08T06:30:00Z');
    expect(clock.today('America/New_York').toString()).toBe('2026-03-08');
    clock.advance({ hours: 2 });
    expect(clock.now().toString()).toBe('2026-03-08T08:30:00Z');
    const ids = new DeterministicIdGenerator();
    expect([ids.next('event'), ids.next('event')]).toEqual(['event-0001', 'event-0002']);
    ids.reset();
    expect(ids.next('event')).toBe('event-0001');
  });

  it('rejects all non-loopback fixture and database targets', () => {
    expect(assertLoopbackUrl('http://127.0.0.1:9000/events').hostname).toBe('127.0.0.1');
    expect(() => assertLoopbackUrl('https://example.org/events')).toThrow('non-loopback');
    expect(
      assertSafeTestDatabaseUrl('postgresql://user:secret@localhost/delaware_test').hostname,
    ).toBe('localhost');
    expect(() =>
      assertSafeTestDatabaseUrl('postgresql://user:secret@db.example.org/delaware_test'),
    ).toThrow('loopback');
    expect(() =>
      assertSafeTestDatabaseUrl('postgresql://user:secret@localhost/delaware_production'),
    ).toThrow('must contain "test"');
  });

  it('writes canonical manifests and compares only deterministic outcomes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'delaware-scene-manifest-'));
    const path = join(directory, 'run.json');
    const manifest: TestResultManifest = {
      schemaVersion: 1,
      runId: 'run-1',
      fixedDataRevision: 'fixture-v1',
      seed: 1234,
      results: [
        { testId: 'b', outcome: 'passed' },
        { testId: 'a', outcome: 'skipped' },
      ],
    };
    try {
      await writeTestResultManifest(path, manifest);
      const restored = await readTestResultManifest(path);
      expect(restored.results.map((result) => result.testId)).toEqual(['a', 'b']);
      expect(
        equivalentTestOutcomes([
          restored,
          { ...restored, runId: 'run-2', seed: 5678 },
          { ...restored, runId: 'run-3', seed: 9012 },
        ]),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
