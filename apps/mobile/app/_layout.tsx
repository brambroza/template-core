import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegistryProvider } from '../src/lib/registry';
import { getSession, restoreSession } from '../src/lib/session';
import { c } from '../src/lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const segments = useSegments();

  useEffect(() => { restoreSession().then(() => setReady(true)); }, []);
  // anything but the login screen needs a session
  useEffect(() => {
    if (ready && !getSession() && segments[0] !== 'login') router.replace('/login');
  }, [ready, segments]);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RegistryProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.ink },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: c.concrete },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'งานวันนี้' }} />
        </Stack>
      </RegistryProvider>
    </SafeAreaProvider>
  );
}
