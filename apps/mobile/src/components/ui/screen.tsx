import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { spacing } from '@/lib/theme/tokens';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
  contentStyle?: ViewStyle;
};

export function Screen({ children, scroll = false, center = false, contentStyle }: ScreenProps) {
  const tokens = useThemeTokens();
  const content = (
    <View
      style={[
        styles.content,
        center ? styles.centered : undefined,
        { backgroundColor: tokens.background },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: tokens.background }]} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, center ? styles.centered : undefined, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  centered: {
    alignItems: 'stretch',
    justifyContent: 'center',
  },
});
