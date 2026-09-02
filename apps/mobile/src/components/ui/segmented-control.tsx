import { Pressable, StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { ThemedText } from './themed-text';

type Option<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const tokens = useThemeTokens();

  return (
    <View style={styles.container}>
      <ThemedText variant="label">{label}</ThemedText>
      <View accessibilityRole="radiogroup" style={[styles.row, { borderColor: tokens.border, backgroundColor: tokens.surfaceAlt }]}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={[styles.segment, selected ? { backgroundColor: tokens.primary } : undefined]}
            >
              <ThemedText variant="label" style={{ color: selected ? tokens.primaryText : tokens.text }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
});
