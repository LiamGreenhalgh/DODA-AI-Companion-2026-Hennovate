import { describe, expect, it } from 'vitest';
import { parseConfigObject } from '../../apps/server/src/config.js';

describe('closed server configuration', () => {
  it('applies valid defaults without storing secret values', () => {
    const result = parseConfigObject({}, 'C:\\workspace');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      port: 3000,
      defaultPageSize: 12,
      ingestionPageLimit: 100,
      retentionDays: 365,
      sourceFreshnessSeconds: 86_400,
      databaseSecretName: 'DATABASE_URL',
      demoEditorSecretName: 'DEMO_EDITOR_CODE',
    });
    expect(JSON.stringify(result.value)).not.toContain('password');
  });

  it.each([
    ['PORT', '0'],
    ['DEFAULT_PAGE_SIZE', '101'],
    ['INGESTION_PAGE_LIMIT', '1001'],
    ['RETENTION_DAYS', '-1'],
    ['SOURCE_FRESHNESS_SECONDS', '59'],
  ])('rejects the %s boundary violation', (field, value) => {
    const result = parseConfigObject({ [field]: value });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: field, code: 'out_of_range' })]),
    );
  });

  it('rejects unknown configuration fields and unsafe origins', () => {
    const result = parseConfigObject({ UNKNOWN_FIELD: 'value', PUBLIC_ORIGIN: 'javascript:alert(1)' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual([
      'invalid_url',
      'unknown_configuration',
    ]);
  });
});
