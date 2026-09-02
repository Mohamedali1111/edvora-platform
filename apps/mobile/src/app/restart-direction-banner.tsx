import { View } from 'react-native';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { spacing } from '@/lib/theme/tokens';

/**
 * `I18nManager.forceRTL` (see lib/i18n/i18n-context.tsx) flips the native layout
 * direction for the *next* app launch — RN resolves flex/text-alignment direction
 * once per native process, so switching EN<->AR mid-session cannot fully mirror
 * every screen without an app restart. This banner is the honest alternative to
 * either lying about the flip being complete or silently doing nothing.
 */
export function RestartDirectionBanner() {
  const { restartRequiredForDirection, t } = useI18n();
  const tokens = useThemeTokens();

  if (!restartRequiredForDirection) {
    return null;
  }

  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: tokens.warningSurface, padding: spacing.sm, paddingTop: spacing.md }}
    >
      <ThemedText variant="muted" style={{ color: tokens.warning, textAlign: 'center' }}>
        {t('common.restartRequired')}
      </ThemedText>
    </View>
  );
}
