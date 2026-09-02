import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/features/auth/auth-context';
import { DeviceProvider } from '@/features/device/device-context';
import { useForegroundRevalidation } from '@/lib/app-lifecycle';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ThemeProvider, useTheme } from '@/lib/theme/theme-context';
import { RestartDirectionBanner } from './restart-direction-banner';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <DeviceProvider>
              <AppShell />
            </DeviceProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  useForegroundRevalidation();
  const { resolvedTheme } = useTheme();

  return (
    <SafeAreaProvider>
      <RestartDirectionBanner />
      <Slot />
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
