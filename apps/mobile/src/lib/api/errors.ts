export type ApiFailureKind = 'backend' | 'network' | 'parse';

/**
 * Mirrors the web app's ApiError shape (`apps/web/src/lib/api/client.ts`) so error
 * handling reads the same way across Edvora clients: `kind` distinguishes a reachable
 * backend that rejected the request from a request that never got a response, `code`
 * carries the backend's stable error code (e.g. `DEVICE_CHANGE_REQUIRED`), and
 * `status` carries the HTTP status when one exists.
 */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status?: number;
  readonly code: string;

  constructor(input: { kind: ApiFailureKind; message: string; code: string; status?: number }) {
    super(input.message);
    this.name = 'ApiError';
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
