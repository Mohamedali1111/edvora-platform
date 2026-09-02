import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { ThemedText } from './themed-text';

type Tone = 'neutral' | 'success' | 'warning';

type BadgeProps = {
  label: string;
  tone?: Tone;
};

/**
 * Text-only badge — never color/icon alone. Used for lesson type and progress
 * status, both of which must be understandable to a screen reader and to a user
 * who can't distinguish color (see the accessibility requirement this satisfies).
 */
export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const tokens = useThemeTokens();
  const background = tone === 'success' ? tokens.successSurface : tone === 'warning' ? tokens.warningSurface : tokens.surfaceAlt;
  const color = tone === 'success' ? tokens.success : tone === 'warning' ? tokens.warning : tokens.textMuted;

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <ThemedText variant="label" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
