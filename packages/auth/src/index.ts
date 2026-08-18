import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SecretProvider {
  get(name: string): Promise<Uint8Array | null>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  async get(name: string): Promise<Uint8Array | null> {
    const value = process.env[name];
    return value ? Buffer.from(value, 'utf8') : null;
  }
}

export interface DemoSession {
  token: string;
  accountId: string;
  role: 'editor' | 'contributor';
  csrfToken: string;
  expiresAt: string;
}

interface StoredSession extends Omit<DemoSession, 'token'> {
  tokenDigest: Buffer;
  csrfDigest: Buffer;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function equalDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class DemoSessionStore {
  readonly #sessions: StoredSession[] = [];

  create(accountId: string, role: 'editor' | 'contributor', now: Date): DemoSession {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    this.#sessions.push({
      accountId,
      role,
      expiresAt,
      csrfToken,
      tokenDigest: digest(token),
      csrfDigest: digest(csrfToken),
    });
    return { token, accountId, role, csrfToken, expiresAt };
  }

  find(token: string | undefined, now: Date): Omit<DemoSession, 'token'> | null {
    if (!token) return null;
    const tokenDigest = digest(token);
    const session = this.#sessions.find((candidate) => equalDigest(candidate.tokenDigest, tokenDigest));
    if (!session || Date.parse(session.expiresAt) <= now.getTime()) return null;
    return { accountId: session.accountId, role: session.role, expiresAt: session.expiresAt, csrfToken: session.csrfToken };
  }

  validateCsrf(token: string | undefined, csrfToken: string | undefined, now: Date): boolean {
    if (!token || !csrfToken) return false;
    const tokenDigest = digest(token);
    const csrfDigest = digest(csrfToken);
    const session = this.#sessions.find((candidate) => equalDigest(candidate.tokenDigest, tokenDigest));
    return Boolean(
      session && Date.parse(session.expiresAt) > now.getTime() && equalDigest(session.csrfDigest, csrfDigest),
    );
  }

  revoke(token: string | undefined): void {
    if (!token) return;
    const tokenDigest = digest(token);
    const index = this.#sessions.findIndex((candidate) => equalDigest(candidate.tokenDigest, tokenDigest));
    if (index >= 0) this.#sessions.splice(index, 1);
  }
}

export function constantTimeSecretEqual(expected: Uint8Array, supplied: string): boolean {
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expected.length === suppliedBytes.length && timingSafeEqual(expected, suppliedBytes);
}
