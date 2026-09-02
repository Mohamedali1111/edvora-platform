import type { ReactNode } from 'react';
import { Text, type TextProps } from 'react-native';
import { useThemeTokens } from '@/lib/theme/theme-context';

type Variant = 'title' | 'subtitle' | 'body' | 'muted' | 'label' | 'error';

type ThemedTextProps = TextProps & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANT_STYLE: Record<Variant, { fontSize: number; fontWeight: '400' | '500' | '600' | '700' }> = {
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 16, fontWeight: '500' },
  body: { fontSize: 15, fontWeight: '400' },
  muted: { fontSize: 14, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 13, fontWeight: '500' },
};

export function ThemedText({ variant = 'body', style, children, ...rest }: ThemedTextProps) {
  const tokens = useThemeTokens();
  const color =
    variant === 'muted'
      ? tokens.textMuted
      : variant === 'error'
        ? tokens.danger
        : tokens.text;

  return (
    <Text
      // Respects the OS text-scaling setting (dynamic type / font-scale
      // accessibility preference) — never disabled via allowFontScaling={false}.
      style={[{ color }, VARIANT_STYLE[variant], style]}
      {...rest}
    >
      {children}
    </Text>
  );
}
