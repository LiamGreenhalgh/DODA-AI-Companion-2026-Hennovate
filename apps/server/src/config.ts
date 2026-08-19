import { resolve } from 'node:path';
import type { RuntimeConfigurationContract } from '@delaware-scene/contracts';
import { parseBoundedInteger, type Result, type ValidationIssue } from '@delaware-scene/domain';

export type AppConfig = RuntimeConfigurationContract;

export const CONFIGURATION_KEYS = [
  'HOST',
  'PORT',
  'PUBLIC_ORIGIN',
  'DATA_DIRECTORY',
  'DEMO_MODE',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_SECONDS',
  'RETENTION_DAYS',
  'SOURCE_FRESHNESS_SECONDS',
  'DEFAULT_PAGE_SIZE',
  'INGESTION_PAGE_LIMIT',
  'RELEASE_VERSION',
  'DATABASE_SECRET_NAME',
  'DEMO_EDITOR_SECRET_NAME',
] as const;

type ConfigurationKey = (typeof CONFIGURATION_KEYS)[number];
type ConfigurationInput = Partial<Record<ConfigurationKey, unknown>>;

function parseBoolean(value: unknown, fallback: boolean, field: string): Result<boolean> {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === true || value === 'true') return { ok: true, value: true };
  if (value === false || value === 'false') return { ok: true, value: false };
  return {
    ok: false,
    errors: [
      {
        path: field,
        code: 'invalid_boolean',
        message: `${field} must be true or false.`,
      },
    ],
  };
}

function parseString(
  value: unknown,
  fallback: string,
  field: string,
  minimumLength = 1,
  maximumLength = Number.MAX_SAFE_INTEGER,
): Result<string> {
  const parsed = value === undefined ? fallback : value;
  if (
    typeof parsed !== 'string' ||
    parsed.length < minimumLength ||
    parsed.length > maximumLength
  ) {
    return {
      ok: false,
      errors: [
        {
          path: field,
          code: 'invalid_string',
          message: `${field} must contain from ${minimumLength} through ${maximumLength} characters.`,
        },
      ],
    };
  }
  return { ok: true, value: parsed };
}

/** Parse an explicit configuration object. Unknown keys are rejected before startup. */
export function parseConfigObject(
  input: Record<string, unknown>,
  cwd = process.cwd(),
  defaultDataDirectory = resolve(cwd, 'data/generated'),
): Result<AppConfig> {
  const errors: ValidationIssue[] = [];
  const allowed = new Set<string>(CONFIGURATION_KEYS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors.push({
        path: key,
        code: 'unknown_configuration',
        message: `${key} is not an allowed configuration field.`,
      });
    }
  }
  const values = input as ConfigurationInput;
  const bounded = (name: ConfigurationKey, fallback: number, minimum: number, maximum: number): number => {
    const result = parseBoundedInteger(values[name] ?? fallback, name, minimum, maximum);
    if (!result.ok) {
      errors.push(...result.errors);
      return fallback;
    }
    return result.value;
  };
  const stringValue = (
    name: ConfigurationKey,
    fallback: string,
    minimumLength = 1,
    maximumLength = Number.MAX_SAFE_INTEGER,
  ): string => {
    const result = parseString(values[name], fallback, name, minimumLength, maximumLength);
    if (!result.ok) {
      errors.push(...result.errors);
      return fallback;
    }
    return result.value;
  };

  const originInput = stringValue('PUBLIC_ORIGIN', 'http://127.0.0.1:3000');
  let publicOrigin = 'http://127.0.0.1:3000';
  try {
    const parsed = new URL(originInput);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('invalid origin');
    }
    publicOrigin = parsed.origin;
  } catch {
    errors.push({
      path: 'PUBLIC_ORIGIN',
      code: 'invalid_url',
      message: 'PUBLIC_ORIGIN must be an absolute HTTP or HTTPS origin without user information.',
    });
  }

  const demoMode = parseBoolean(values.DEMO_MODE, true, 'DEMO_MODE');
  if (!demoMode.ok) errors.push(...demoMode.errors);

  const config: AppConfig = {
    host: stringValue('HOST', '127.0.0.1', 1, 255),
    port: bounded('PORT', 3000, 1, 65_535),
    publicOrigin,
    dataDirectory:
      values.DATA_DIRECTORY === undefined
        ? defaultDataDirectory
        : resolve(cwd, stringValue('DATA_DIRECTORY', 'data/generated')),
    demoMode: demoMode.ok ? demoMode.value : true,
    rateLimitMax: bounded('RATE_LIMIT_MAX', 60, 1, 60),
    rateLimitWindowSeconds: bounded('RATE_LIMIT_WINDOW_SECONDS', 60, 1, 60),
    retentionDays: bounded('RETENTION_DAYS', 365, 0, 3650),
    sourceFreshnessSeconds: bounded(
      'SOURCE_FRESHNESS_SECONDS',
      86_400,
      60,
      2_592_000,
    ),
    defaultPageSize: bounded('DEFAULT_PAGE_SIZE', 12, 1, 100),
    ingestionPageLimit: bounded('INGESTION_PAGE_LIMIT', 100, 1, 1000),
    releaseVersion: stringValue('RELEASE_VERSION', 'local-development', 1, 128),
    databaseSecretName: stringValue('DATABASE_SECRET_NAME', 'DATABASE_URL', 1, 128),
    demoEditorSecretName: stringValue(
      'DEMO_EDITOR_SECRET_NAME',
      'DEMO_EDITOR_CODE',
      1,
      128,
    ),
  };

  errors.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: config };
}

export function parseConfig(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
  defaultDataDirectory = resolve(cwd, 'data/generated'),
): Result<AppConfig> {
  const selected: Record<string, unknown> = {};
  for (const key of CONFIGURATION_KEYS) {
    if (env[key] !== undefined) selected[key] = env[key];
  }
  return parseConfigObject(selected, cwd, defaultDataDirectory);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  defaultDataDirectory = resolve(cwd, 'data/generated'),
): AppConfig {
  const parsed = parseConfig(env, cwd, defaultDataDirectory);
  if (!parsed.ok) {
    throw new Error(
      `Invalid configuration:\n${parsed.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join('\n')}`,
    );
  }
  return parsed.value;
}
