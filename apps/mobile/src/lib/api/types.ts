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
