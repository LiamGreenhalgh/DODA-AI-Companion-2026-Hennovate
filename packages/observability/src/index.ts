import pino, { type Logger } from 'pino';

const SENSITIVE_KEY = /authorization|cookie|credential|csrf|password|secret|session|token/iu;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(nested),
      ]),
    );
  }
  return value;
}

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
