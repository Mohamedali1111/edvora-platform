import type { BackendErrorEnvelope } from "./types";

export type ApiFailureKind = "backend" | "network" | "parse";

export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status?: number;
  readonly code: string;

  constructor(input: { kind: ApiFailureKind; message: string; code: string; status?: number }) {
    super(input.message);
    this.name = "ApiError";
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
  refresh?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
};

const DEFAULT_API_BASE_URL = "http://localhost:3001";

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly getAccessToken: () => string | null;
  private readonly setAccessToken: (token: string | null) => void;
  private readonly refresh?: () => Promise<string | null>;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.NEXT_PUBLIC_EDVORA_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    );
    this.fetchFn = options.fetchFn ?? fetch;
    this.getAccessToken = options.getAccessToken ?? (() => null);
    this.setAccessToken = options.setAccessToken ?? (() => undefined);
    this.refresh = options.refresh;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.requestInternal<T>(path, { retryOnUnauthorized: true, ...options });
  }

  private async requestInternal<T>(path: string, options: RequestOptions): Promise<T> {
    const headers = new Headers();
    const token = options.auth === false ? null : this.getAccessToken();

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;

    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: "include",
      });
    } catch {
      throw new ApiError({
        kind: "network",
        code: "NETWORK_UNAVAILABLE",
        message: "The API is unavailable.",
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

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = new ApiError({
    kind: "backend",
    status: response.status,
    code: `HTTP_${response.status}`,
    message: "The request could not be completed.",
  });

  try {
    const data: unknown = await response.json();

    if (isBackendErrorEnvelope(data)) {
      return new ApiError({
        kind: "backend",
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
      kind: "parse",
      status: response.status,
      code: "INVALID_JSON",
      message: "The API returned an unreadable response.",
    });
  }
}

function isBackendErrorEnvelope(value: unknown): value is BackendErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }

  const error = (value as { error: unknown }).error;

  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
