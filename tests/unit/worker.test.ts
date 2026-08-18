import { describe, expect, it } from 'vitest';
import { runWorker } from '../../apps/worker/src/main.js';

describe('worker composition root', () => {
  it('starts and exits cleanly in one-shot validation mode', async () => {
    await expect(runWorker({ once: true })).resolves.toBeUndefined();
  });

  it('requires a termination signal for service mode', async () => {
    await expect(runWorker()).rejects.toThrow('requires an AbortSignal');
  });
});
