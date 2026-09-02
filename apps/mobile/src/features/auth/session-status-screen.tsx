import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { StatusPanel } from '@/components/ui/status-panel';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useAuth } from './auth-context';

export function ApiUnavailableScreen() {
  const { t } = useI18n();
  const { refreshSession } = useAuth();

  return (
    <Screen center>
      <StatusPanel title={t('session.apiUnavailable')} body={t('session.apiUnavailableBody')} tone="warning">
        <Button label={t('common.retry')} onPress={() => void refreshSession()} />
      </StatusPanel>
    </Screen>
  );
}

export function ForbiddenScreen() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const router = useRouter();

  const onBack = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <Screen center>
      <StatusPanel title={t('session.forbidden')} body={t('session.forbiddenBody')} tone="warning">
        <Button label={t('auth.activate.backToLogin')} onPress={() => void onBack()} />
      </StatusPanel>
    </Screen>
  );
}
