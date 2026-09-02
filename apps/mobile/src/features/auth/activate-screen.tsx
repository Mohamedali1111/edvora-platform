import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { StatusPanel } from '@/components/ui/status-panel';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { activateAccount } from './auth-client';
import { mapActivationError } from './error-mapping';
import { validateActivationInput, type ActivationFieldErrors } from './validate';

const FIELD_ERROR_KEY: Record<'required' | 'tooShort', 'auth.activate.passwordRequired' | 'auth.activate.passwordTooShort'> = {
  required: 'auth.activate.passwordRequired',
  tooShort: 'auth.activate.passwordTooShort',
};

export function ActivateScreen() {
  const { t } = useI18n();
  const router = useRouter();
  // Deliberately never sourced from a route/query param or any deep link: a
  // one-time activation secret must only ever exist as explicit runtime input the
  // student types or pastes into this field, never in a URL, navigation history,
  // or persisted state (see repair note in the milestone report).
  const [activationToken, setActivationToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ActivationFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const onSubmit = async () => {
    const errors = validateActivationInput({ activationToken, newPassword, confirmPassword });
    setFieldErrors(errors);
    setFormError(null);

    if (errors.activationToken || errors.newPassword || errors.confirmPassword) {
      return;
    }

    setSubmitting(true);

    try {
      await activateAccount({ activationToken, newPassword });
      // The activation token and the chosen password are single-use secrets: clear
      // them from runtime state immediately on success so nothing lingers in this
      // screen's memory (or React DevTools / a component inspector) after the
      // backend has already consumed the token.
      setActivationToken('');
      setNewPassword('');
      setConfirmPassword('');
      setSucceeded(true);
    } catch (error: unknown) {
      setFormError(t(mapActivationError(error)));
    } finally {
      setSubmitting(false);
    }
  };

  if (succeeded) {
    return (
      <Screen center>
        <StatusPanel title={t('auth.activate.success')} tone="success">
          <Button label={t('auth.activate.backToLogin')} onPress={() => router.replace('/login')} />
        </StatusPanel>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <ThemedText variant="title">{t('auth.activate.title')}</ThemedText>
        <ThemedText variant="muted">{t('auth.activate.subtitle')}</ThemedText>
      </View>

      {formError ? (
        <View style={{ marginBottom: spacing.md }}>
          <StatusPanel title={formError} tone="danger" />
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <TextField
          label={t('auth.activate.token')}
          placeholder={t('auth.activate.tokenPlaceholder')}
          value={activationToken}
          onChangeText={setActivationToken}
          error={fieldErrors.activationToken ? t('auth.activate.tokenRequired') : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <TextField
          label={t('auth.activate.newPassword')}
          value={newPassword}
          onChangeText={setNewPassword}
          error={fieldErrors.newPassword ? t(FIELD_ERROR_KEY[fieldErrors.newPassword]) : undefined}
          isPassword
          showLabel={t('auth.login.showPassword')}
          hideLabel={t('auth.login.hidePassword')}
          textContentType="newPassword"
          autoComplete="password-new"
        />
        <TextField
          label={t('auth.activate.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={fieldErrors.confirmPassword ? t('auth.activate.passwordMismatch') : undefined}
          isPassword
          showLabel={t('auth.login.showPassword')}
          hideLabel={t('auth.login.hidePassword')}
          textContentType="newPassword"
          autoComplete="password-new"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <Button
          label={submitting ? t('auth.activate.submitting') : t('auth.activate.submit')}
          onPress={onSubmit}
          loading={submitting}
        />
      </View>

      <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
        <Link href="/login" accessibilityRole="link">
          <ThemedText variant="label">{t('auth.activate.backToLogin')}</ThemedText>
        </Link>
      </View>
    </Screen>
  );
}
