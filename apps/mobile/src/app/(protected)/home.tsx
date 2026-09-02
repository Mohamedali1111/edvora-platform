import { Redirect } from 'expo-router';
import { useDevice } from '@/features/device/device-context';
import { HomeScreen } from '@/features/student/home-screen';

export default function HomeRoute() {
  const { status } = useDevice();

  // No UI-only role/device gate: this reads the same DeviceProvider state the
  // device-check screen derives from real `/student/device/*` responses, and every
  // request this screen's data will eventually make still carries its own
  // StudentDeviceGuard check server-side regardless of what this client believes.
  if (status !== 'authorized') {
    return <Redirect href="/device-check" />;
  }

  return <HomeScreen />;
}
