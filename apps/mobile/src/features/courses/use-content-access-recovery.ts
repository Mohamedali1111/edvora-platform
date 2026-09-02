import { useCallback } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useDevice } from '@/features/device/device-context';
import { ApiError } from '@/lib/api/errors';
import { classifyContentAccessError } from './content-access-recovery';

/**
 * Returns a callback content screens call from their fetch `catch` blocks. Never
 * decides access itself — only triggers the existing AuthProvider/DeviceProvider
 * to re-resolve when a content fetch's error implies one of them is stale (see
 * content-access-recovery.ts for the classification this wraps).
 */
export function useContentAccessRecovery(): (error: unknown) => void {
  const { refreshSession } = useAuth();
  const { retry: retryDevice } = useDevice();

  return useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) {
        return;
      }

      const action = classifyContentAccessError(error.code);

      if (action === 'auth') {
        void refreshSession();
      } else if (action === 'device') {
        retryDevice();
      }
    },
    [refreshSession, retryDevice],
  );
}
