import type {
  ApiErrorResponse,
  Page,
  PublicEventDetailDto,
  PublicEventSummaryDto,
  SearchMetadataDto,
  SessionDto,
  SourceSummaryDto,
} from '@delaware-scene/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiErrorResponse | null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(body?.error.message ?? `Request failed with status ${response.status}.`, response.status, body);
  }
  return response.json() as Promise<T>;
}

export const api = {
  events(search: URLSearchParams, signal?: AbortSignal) {
    return request<Page<PublicEventSummaryDto>>(`/api/v1/events?${search.toString()}`, { signal });
  },
  event(id: string, signal?: AbortSignal) {
    return request<PublicEventDetailDto>(`/api/v1/events/${encodeURIComponent(id)}`, { signal });
  },
  metadata(signal?: AbortSignal) {
    return request<SearchMetadataDto>('/api/v1/search-metadata', { signal });
  },
  login(accountId: string, accessCode: string) {
    return request<SessionDto>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId, accessCode }),
    });
  },
  session() {
    return request<SessionDto>('/api/v1/auth/session');
  },
  moderationEvents() {
    return request<{ items: Array<PublicEventSummaryDto & { publicationStatus: string; version: number }> }>('/api/v1/moderation/events');
  },
  moderationSources() {
    return request<{ items: SourceSummaryDto[]; totalCount: number }>('/api/v1/moderation/sources');
  },
  transition(
    eventId: string,
    action: 'approve' | 'reject' | 'archive',
    version: number,
    csrfToken: string,
    reason?: string,
  ) {
    return request<{ event: { id: string; publicationStatus: string; version: number } }>(
      `/api/v1/moderation/events/${encodeURIComponent(eventId)}/${action}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ version, ...(reason ? { reason } : {}) }),
      },
    );
  },
  logout(csrfToken: string) {
    return request<{ ok: true }>('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
  },
};
