import { Redirect } from 'expo-router';
import { useAuth } from '@/features/auth/auth-context';
import { ApiUnavailableScreen, ForbiddenScreen } from '@/features/auth/session-status-screen';
import { LoadingPanel } from '@/components/ui/status-panel';
import { Screen } from '@/components/ui/screen';
import { useI18n } from '@/lib/i18n/i18n-context';

export default function RootIndexRoute() {
  const { t } = useI18n();
  const { status } = useAuth();

  if (status === 'bootstrapping') {
    return (
      <Screen>
        <LoadingPanel label={t('session.bootstrapping')} />
      </Screen>
    );
  }

  if (status === 'api-unavailable') {
    return <ApiUnavailableScreen />;
  }

  if (status === 'forbidden') {
    return <ForbiddenScreen />;
  }

  if (status === 'authenticated') {
    return <Redirect href="/device-check" />;
  }

  // 'anonymous' and 'expired' both land here — the difference (a stale session vs.
  // never having had one) is not meaningful UI, only the login screen's own inline
  // handling of a fresh sign-in attempt matters from this point on.
  return <Redirect href="/login" />;
}
