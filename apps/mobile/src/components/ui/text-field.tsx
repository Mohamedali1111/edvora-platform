import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { ThemedText } from './themed-text';

type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  error?: string;
  isPassword?: boolean;
  showLabel?: string;
  hideLabel?: string;
};

export function TextField({ label, error, isPassword, showLabel, hideLabel, ...inputProps }: TextFieldProps) {
  const tokens = useThemeTokens();
  const [visible, setVisible] = useState(false);
  const secure = isPassword ? !visible : undefined;

  return (
    <View style={styles.container}>
      <ThemedText variant="label" style={styles.label}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: tokens.surface, borderColor: error ? tokens.danger : tokens.border },
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={secure}
          accessibilityLabel={label}
          aria-invalid={Boolean(error)}
          placeholderTextColor={tokens.textMuted}
          style={[styles.input, { color: tokens.text }]}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? hideLabel : showLabel}
            onPress={() => setVisible((current) => !current)}
            hitSlop={8}
            style={styles.toggle}
          >
            <ThemedText variant="label" style={{ color: tokens.primary }}>
              {visible ? hideLabel : showLabel}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText variant="error" accessibilityRole="alert" style={styles.errorText}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    marginBottom: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    minHeight: 48,
    fontSize: 16,
  },
  toggle: {
    paddingHorizontal: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  errorText: {
    marginTop: 2,
  },
});
