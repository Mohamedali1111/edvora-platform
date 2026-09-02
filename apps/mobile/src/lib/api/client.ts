import { resolveApiBaseUrl } from './base-url';
import { ApiError } from './errors';
import { isBackendErrorEnvelope } from './types';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestOptions = {
  method?: RequestMethod;
  body?: unknown;
  /** Defaults to true. Set false for endpoints that must not carry a Bearer token (e.g. /auth/login, /auth/refresh). */
  auth?: boolean;
  /** Defaults to true. Set false to skip the automatic refresh-and-retry on a 401 (e.g. the refresh call itself). */
  retryOnUnauthorized?: boolean;
  headers?: Record<string, string>;
};

export type ApiClientOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
  refresh?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
};

/**
 * Native counterpart to the web app's `ApiClient` (`apps/web/src/lib/api/client.ts`):
 * same error shape and coalesced-refresh contract, adapted for React Native.
 *
 * Differences from the web client, both required by the backend's mobile channel
 * contract (`docs/AUTH-HTTP-API.md`, `AuthController`):
 *  - never sends `credentials: "include"` — mobile has no browser cookie jar, and
 *    the backend's `TrustedOriginGuard` only checks WEB-channel/cookie requests, so
 *    omitting an Origin header here is correct, not a workaround.
 *  - the access token is supplied by the caller's in-memory token store only; this
 *    class never persists anything itself.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly getAccessToken: () => string | null;
  private readonly setAccessToken: (token: string | null) => void;
  private readonly refresh?: () => Promise<string | null>;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? resolveApiBaseUrl();
    this.fetchFn = options.fetchFn ?? fetch;
    this.getAccessToken = options.getAccessToken ?? (() => null);
    this.setAccessToken = options.setAccessToken ?? (() => undefined);
    this.refresh = options.refresh;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.requestInternal<T>(path, { retryOnUnauthorized: true, ...options });
  }

  private async requestInternal<T>(path: string, options: RequestOptions): Promise<T> {
    const headers = new Headers(options.headers);
    const token = options.auth === false ? null : this.getAccessToken();

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;

    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError({
        kind: 'network',
        code: 'NETWORK_UNAVAILABLE',
        message: 'The API is unavailable.',
      });
    }

    if (response.status === 401 && options.retryOnUnauthorized !== false && this.refresh && options.auth !== false) {
      const nextToken = await this.refresh();

      if (nextToken) {
        this.setAccessToken(nextToken);
        return this.requestInternal<T>(path, { ...options, retryOnUnauthorized: false });
      }
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return parseJson<T>(response);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = new ApiError({
    kind: 'backend',
    status: response.status,
    code: `HTTP_${response.status}`,
    message: 'The request could not be completed.',
  });

  try {
    const data: unknown = await response.json();

    if (isBackendErrorEnvelope(data)) {
      return new ApiError({
        kind: 'backend',
        status: response.status,
        code: data.error.code,
        message: data.error.message,
      });
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      kind: 'parse',
      status: response.status,
      code: 'INVALID_JSON',
      message: 'The API returned an unreadable response.',
    });
  }
}
