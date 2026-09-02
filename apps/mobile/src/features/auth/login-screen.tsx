import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { StatusPanel } from '@/components/ui/status-panel';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { useAuth } from './auth-context';
import { mapLoginError } from './error-mapping';
import { validateLoginInput, type LoginFieldErrors } from './validate';

export function LoginScreen() {
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async () => {
    const errors = validateLoginInput(email, password);
    setFieldErrors(errors);
    setFormError(null);

    if (errors.email || errors.password) {
      return;
    }

    setSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (error: unknown) {
      setFormError(t(mapLoginError(error)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <ThemedText variant="title">{t('brand.name')}</ThemedText>
        <ThemedText variant="subtitle">{t('auth.login.title')}</ThemedText>
        <ThemedText variant="muted">{t('auth.login.subtitle')}</ThemedText>
      </View>

      {formError ? (
        <View style={{ marginBottom: spacing.md }}>
          <StatusPanel title={formError} tone="danger" />
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <TextField
          label={t('auth.login.email')}
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email ? t(`auth.login.${fieldErrors.email === 'invalid' ? 'emailInvalid' : 'emailRequired'}`) : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.login.password')}
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password ? t('auth.login.passwordRequired') : undefined}
          isPassword
          showLabel={t('auth.login.showPassword')}
          hideLabel={t('auth.login.hidePassword')}
          textContentType="password"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <Button
          label={submitting ? t('auth.login.submitting') : t('auth.login.submit')}
          onPress={onSubmit}
          loading={submitting}
        />
      </View>

      <View style={{ marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs }}>
        <ThemedText variant="muted">{t('auth.login.activatePrompt')}</ThemedText>
        <Link href="/activate" accessibilityRole="link">
          <ThemedText variant="label">{t('auth.login.activateLink')}</ThemedText>
        </Link>
      </View>
    </Screen>
  );
}
