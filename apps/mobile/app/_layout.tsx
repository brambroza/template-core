import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restoreNumberFormat } from '../src/lib/number-format';
import { RegistryProvider } from '../src/lib/registry';
import { getSession, restoreSession } from '../src/lib/session';
import { useIsDark, usePalette, type Palette } from '../src/lib/theme';

/** Navigation colours from our palette, so transitions, headers and cards never flash white in dark mode. */
function navTheme(c: Palette, dark: boolean): Theme {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark,
    colors: { ...base.colors, primary: c.signal, background: c.concrete, card: c.chrome, text: c.onChrome, border: c.rule, notification: c.stop },
  };
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const segments = useSegments();
  const c = usePalette();
  const dark = useIsDark();

  // the session, then the number format this phone remembers for that company (no flash of the default on the first screen)
  useEffect(() => { restoreSession().then((s) => restoreNumberFormat(s?.tenant.code)).then(() => setReady(true)); }, []);
  // anything but the login screen needs a session
  useEffect(() => {
    if (ready && !getSession() && segments[0] !== 'login') router.replace('/login');
  }, [ready, segments]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: c.concrete }} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme(c, dark)}>
        {/* light header by default: dark status-bar icons */}
        <StatusBar style={dark ? 'light' : 'dark'} />
        <RegistryProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: c.chrome },
              headerTintColor: c.onChrome,
              headerTitleStyle: { fontWeight: '600', color: c.onChrome },
              headerShadowVisible: dark ? false : undefined,
              contentStyle: { backgroundColor: c.concrete },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false, contentStyle: { backgroundColor: c.concrete } }} />
            <Stack.Screen name="index" options={{ title: 'งานวันนี้' }} />
          </Stack>
        </RegistryProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
