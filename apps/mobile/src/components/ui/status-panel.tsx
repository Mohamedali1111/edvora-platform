import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { ThemedText } from './themed-text';

type Tone = 'neutral' | 'warning' | 'danger' | 'success';

type StatusPanelProps = {
  title: string;
  body?: string;
  tone?: Tone;
  children?: ReactNode;
};

export function StatusPanel({ title, body, tone = 'neutral', children }: StatusPanelProps) {
  const tokens = useThemeTokens();
  const background =
    tone === 'danger' ? tokens.dangerSurface : tone === 'warning' ? tokens.warningSurface : tone === 'success' ? tokens.successSurface : tokens.surfaceAlt;

  return (
    <View
      accessible
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: background, borderColor: tokens.border }]}
    >
      <ThemedText variant="subtitle">{title}</ThemedText>
      {body ? (
        <ThemedText variant="body" style={styles.body}>
          {body}
        </ThemedText>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  const tokens = useThemeTokens();

  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loading}>
      <ActivityIndicator color={tokens.primary} size="large" />
      <ThemedText variant="muted" style={styles.loadingLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  body: {
    lineHeight: 20,
  },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingLabel: {
    textAlign: 'center',
  },
});
