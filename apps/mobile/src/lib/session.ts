import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

export interface Session {
  token: string;
  gatewayUrl: string;
  tenant: { id: string; code: string; name: string };
  user: { id: string; email: string; name: string };
  permissions: string[];
}

const KEY = 'erp.session';
let current: Session | null = null;

export const defaultGatewayUrl = (): string =>
  process.env.EXPO_PUBLIC_GATEWAY_URL ?? (Constants.expoConfig?.extra as { gatewayUrl?: string } | undefined)?.gatewayUrl ?? 'http://localhost:8080';

export async function restoreSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  return current;
}

export const getSession = () => current;

export async function saveSession(s: Session): Promise<void> {
  current = s;
  await SecureStore.setItemAsync(KEY, JSON.stringify(s)).catch(() => undefined);
}

export async function clearSession(): Promise<void> {
  current = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
