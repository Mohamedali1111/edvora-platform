import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import type { Locale } from '@/lib/i18n/translations';
import { useTheme, type ThemePreference } from '@/lib/theme/theme-context';
import { spacing } from '@/lib/theme/tokens';

export function HomeScreen() {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <ThemedText variant="title">{t('home.title')}</ThemedText>
        <ThemedText variant="subtitle">
          {t('home.welcome')}
          {user?.displayName ? `, ${user.displayName}` : ''}
        </ThemedText>
        <ThemedText variant="muted">{t('home.subtitle')}</ThemedText>
      </View>

      <StatusPanel title={t('home.myCourses')} body={t('home.myCoursesSubtitle')}>
        <Button label={t('home.myCourses')} onPress={() => router.push('/courses')} />
      </StatusPanel>

      <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
        <ThemedText variant="label">{t('home.settings')}</ThemedText>

        <SegmentedControl<ThemePreference>
          label={t('common.theme')}
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'light', label: t('common.theme.light') },
            { value: 'dark', label: t('common.theme.dark') },
            { value: 'system', label: t('common.theme.system') },
          ]}
        />

        <SegmentedControl<Locale>
          label={t('common.language')}
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
        />

        <Button label={t('common.logOut')} variant="secondary" onPress={() => void logout()} />
      </View>
    </Screen>
  );
}
