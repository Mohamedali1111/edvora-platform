import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api/errors';
import { authorizeCurrentDevice, fetchDeviceStatus, requestDeviceChange } from './device-client';
import { toUiStatus, type DeviceUiStatus } from './device-status-mapping';

export type { DeviceUiStatus };

type DeviceContextValue = {
  status: DeviceUiStatus;
  errorCode: string | null;
  requestChange: (reason?: string) => Promise<void>;
  retry: () => void;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  // Internal: only ever set while genuinely authenticated (see evaluate/requestChange
  // below). The publicly exposed `status` derives 'idle' from authStatus/user directly
  // below instead of an effect resetting this to 'idle' — that keeps this provider from
  // ever momentarily exposing a stale 'authorized'/'change_required'/... from a
  // previous session between a logout and this effect re-running.
  const [internalStatus, setInternalStatus] = useState<DeviceUiStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const status: DeviceUiStatus = authStatus === 'authenticated' && user ? internalStatus : 'idle';

  const evaluate = useCallback(async (userId: string) => {
    setInternalStatus('checking');
    setErrorCode(null);

    try {
      let result = await fetchDeviceStatus();

      // First-device authorization is fully automatic (Milestone spec §9): the
      // backend, not this client, decides whether a device with no prior
      // registration gets approved outright. The client only triggers the call.
      if (result.status === 'NO_DEVICE_REGISTERED') {
        result = await authorizeCurrentDevice();
      }

      setInternalStatus(toUiStatus(result.status));
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrorCode(error.code);
      }
      setInternalStatus('error');
    }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user) {
      return;
    }

    // Fetch-on-mount/on-user-change effect, same false positive as
    // auth-context.tsx's mount effect: evaluate's own setState calls happen after
    // an internal `await`, not synchronously within this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void evaluate(user.userId);
  }, [authStatus, user, evaluate]);

  const retry = useCallback(() => {
    if (user) {
      void evaluate(user.userId);
    }
  }, [user, evaluate]);

  const requestChange = useCallback(
    async (reason?: string) => {
      if (!user) {
        return;
      }

      setInternalStatus('requesting_change');
      setErrorCode(null);

      try {
        const result = await requestDeviceChange(reason);
        setInternalStatus(toUiStatus(result.status));
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          setErrorCode(error.code);

          if (error.code === 'DEVICE_CHANGE_ALREADY_PENDING') {
            setInternalStatus('change_pending');
            return;
          }
        }
        setInternalStatus('error');
      }
    },
    [user],
  );

  const value = useMemo<DeviceContextValue>(
    () => ({ status, errorCode, requestChange, retry }),
    [status, errorCode, requestChange, retry],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext);

  if (!value) {
    throw new Error('useDevice must be used inside DeviceProvider.');
  }

  return value;
}
