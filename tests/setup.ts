import fc from 'fast-check';

const configuredSeed = process.env.FC_SEED;
const seed = configuredSeed === undefined ? 20260318 : Number(configuredSeed);
if (!Number.isSafeInteger(seed)) {
  throw new Error('FC_SEED must be a safe integer when provided.');
}

fc.configureGlobal({
  numRuns: 100,
  seed,
  interruptAfterTimeLimit: 10_000,
  markInterruptAsFailure: true,
});
