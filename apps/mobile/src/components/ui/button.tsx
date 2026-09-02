import { ActivityIndicator, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { ThemedText } from './themed-text';

type Variant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, accessibilityHint }: ButtonProps) {
  const tokens = useThemeTokens();
  const isDisabled = disabled || loading;

  const backgroundColor =
    variant === 'primary' ? tokens.primary : variant === 'secondary' ? tokens.surfaceAlt : 'transparent';
  const textColor = variant === 'primary' ? tokens.primaryText : tokens.text;
  const borderColor = variant === 'ghost' ? 'transparent' : variant === 'secondary' ? tokens.border : backgroundColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={isDisabled}
      // 44dp minimum touch target on every platform, per WCAG 2.5.5 / HIG.
      style={({ pressed }) => [
        styles.base,
        { backgroundColor, borderColor, opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText variant="subtitle" style={{ color: textColor }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
