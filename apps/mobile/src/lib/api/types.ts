// Mirrors apps/api/src/infrastructure/http/pagination.ts's OffsetPage<T> exactly —
// the one standard shape for every bounded offset-paginated list response in this
// API. No `total` field (the backend deliberately omits it).
export type OffsetPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type BackendErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

export function isBackendErrorEnvelope(value: unknown): value is BackendErrorEnvelope {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return false;
  }

  const error = (value as { error: unknown }).error;

  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
