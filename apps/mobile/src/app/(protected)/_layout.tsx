import { Redirect, Stack } from 'expo-router';
import { LoadingPanel } from '@/components/ui/status-panel';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-context';
import { useI18n } from '@/lib/i18n/i18n-context';

export default function ProtectedLayout() {
  const { t } = useI18n();
  const { status } = useAuth();

  // Defense in depth alongside app/index.tsx's own redirect: no protected route
  // ever mounts without a currently-authenticated, backend-confirmed STUDENT
  // session. Device authorization is gated per-route below (device-check.tsx /
  // home.tsx), since "authenticated" alone is not "this device may proceed".
  if (status === 'bootstrapping') {
    return (
      <Screen>
        <LoadingPanel label={t('session.bootstrapping')} />
      </Screen>
    );
  }

  if (status !== 'authenticated') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
