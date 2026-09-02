import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/features/auth/auth-context';

export default function AuthLayout() {
  const { status } = useAuth();

  // A deep link (or a stale nav state) landing directly on /login or /activate
  // while already signed in must not render the sign-in form underneath a valid
  // session — send it back through the root decider instead.
  if (status === 'authenticated') {
    return <Redirect href="/device-check" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
