import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@delaware-scene/contracts': `${root}packages/contracts/src/index.ts`,
      '@delaware-scene/domain': `${root}packages/domain/src/index.ts`,
      '@delaware-scene/application': `${root}packages/application/src/index.ts`,
      '@delaware-scene/ingestion': `${root}packages/ingestion/src/index.ts`,
      '@delaware-scene/database': `${root}packages/database/src/index.ts`,
      '@delaware-scene/auth': `${root}packages/auth/src/index.ts`,
      '@delaware-scene/observability': `${root}packages/observability/src/index.ts`,
      '@delaware-scene/test-support': `${root}packages/test-support/src/index.ts`
    }
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    sequence: { concurrent: false }
  }
});
