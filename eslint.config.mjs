import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const restricted = (...patterns) => [
  'error',
  {
    patterns: patterns.map((group) => ({
      group: Array.isArray(group) ? group : [group],
      message: 'Import crosses an architecture boundary; depend on an allowed port instead.',
    })),
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.types/**',
      '**/cdk.out/**',
      '**/coverage/**',
      '**/node_modules/**',
      'data/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['packages/contracts/src/**/*.{ts,tsx}', 'packages/domain/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted('@delaware-scene/*'),
    },
  },
  {
    files: ['packages/application/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted([
        '@delaware-scene/database',
        '@delaware-scene/ingestion',
        '@delaware-scene/auth',
        '@delaware-scene/observability',
        '@delaware-scene/ui',
        'fastify',
        'pg',
        'kysely',
      ]),
    },
  },
  {
    files: ['packages/ingestion/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted([
        '@delaware-scene/application',
        '@delaware-scene/database',
        '@delaware-scene/auth',
        '@delaware-scene/observability',
        '@delaware-scene/ui',
        'fastify',
        'pg',
        'kysely',
      ]),
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted([
        '@delaware-scene/domain',
        '@delaware-scene/application',
        '@delaware-scene/database',
        '@delaware-scene/ingestion',
        '@delaware-scene/auth',
        '@delaware-scene/observability',
        'fastify',
        'pg',
        'kysely',
      ]),
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
