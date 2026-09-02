import { Redirect } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { useDevice } from './device-context';

export function DeviceCheckScreen() {
  const { t } = useI18n();
  const { status, requestChange, retry } = useDevice();

  if (status === 'authorized') {
    return <Redirect href="/home" />;
  }

  if (status === 'idle' || status === 'checking') {
    return (
      <Screen>
        <LoadingPanel label={t('device.checking.title')} />
      </Screen>
    );
  }

  if (status === 'change_pending') {
    return (
      <Screen center>
        <StatusPanel title={t('device.pending.title')} body={t('device.pending.body')} tone="warning">
          <Button label={t('device.pending.refresh')} onPress={retry} variant="secondary" />
        </StatusPanel>
        <ReviewNote />
      </Screen>
    );
  }

  if (status === 'change_required' || status === 'requesting_change') {
    return (
      <Screen center>
        <StatusPanel title={t('device.changeRequired.title')} body={t('device.changeRequired.body')} tone="warning">
          <Button
            label={status === 'requesting_change' ? t('device.changeRequired.requesting') : t('device.changeRequired.requestButton')}
            onPress={() => void requestChange()}
            loading={status === 'requesting_change'}
          />
        </StatusPanel>
        <ReviewNote />
      </Screen>
    );
  }

  return (
    <Screen center>
      <StatusPanel title={t('device.error.title')} body={t('device.error.body')} tone="danger">
        <Button label={t('common.retry')} onPress={retry} />
      </StatusPanel>
    </Screen>
  );
}

function ReviewNote() {
  const { t } = useI18n();

  return (
    <ThemedText variant="muted" style={{ marginTop: spacing.lg, textAlign: 'center' }}>
      {t('device.reviewNote')}
    </ThemedText>
  );
}
