import { useColorScheme } from 'react-native';

/**
 * Same palette as the web app (apps/web/src/app/globals.css): ink on quiet greys, one safety-yellow accent.
 * `light` = :root, `dark` = the `prefers-color-scheme: dark` values. The app follows the phone's setting.
 */
export interface Palette {
  /** main text */
  ink: string;
  /** secondary text */
  inkSoft: string;
  /** placeholders, disabled text */
  inkFaint: string;
  /** screen background */
  concrete: string;
  /** cards, inputs */
  paper: string;
  /** borders */
  rule: string;
  /** hairlines inside cards, quiet tiles */
  ruleSoft: string;
  ruleStrong: string;
  signal: string;
  signalDeep: string;
  /** text/icons on the yellow accent (always dark, in both modes) */
  onSignal: string;
  ok: string;
  warn: string;
  stop: string;
  progress: string;
  /** navigation header, login backdrop, scanner (dark in both modes) */
  chrome: string;
  onChrome: string;
  /** pressed row/tile */
  pressed: string;
  /** yellow tint on a pressed tile */
  pressedSignal: string;
  errorBg: string;
  errorText: string;
  backdrop: string;
}

export const light: Palette = {
  ink: '#141C22',
  inkSoft: '#5B6670',
  inkFaint: '#8A949C',
  concrete: '#F5F6F5',
  paper: '#FFFFFF',
  rule: '#E3E6E3',
  ruleSoft: '#EFF1EF',
  ruleStrong: '#CDD2CE',
  signal: '#F5C518',
  signalDeep: '#D9A800',
  onSignal: '#141C22',
  ok: '#1F9D6B',
  warn: '#C98207',
  stop: '#D64535',
  progress: '#3B6FD8',
  chrome: '#141C22',
  onChrome: '#FFFFFF',
  pressed: '#F7F8F5',
  pressedSignal: 'rgba(245,197,24,0.22)',
  errorBg: '#FBEDEB',
  errorText: '#7D241C',
  backdrop: 'rgba(31,42,51,0.45)',
};

export const dark: Palette = {
  ink: '#E9EEF1',
  inkSoft: '#9AA7B1',
  inkFaint: '#6E7B85',
  concrete: '#0D1216',
  paper: '#141B21',
  rule: '#232D35',
  ruleSoft: '#1B242B',
  ruleStrong: '#33404A',
  signal: '#F5C518',
  signalDeep: '#D9A800',
  onSignal: '#141C22',
  ok: '#3DC48D',
  warn: '#E9A93A',
  stop: '#F06A5B',
  progress: '#6E9BF5',
  chrome: '#141B21',
  onChrome: '#E9EEF1',
  pressed: '#1B242B',
  pressedSignal: 'rgba(245,197,24,0.18)',
  errorBg: 'rgba(240,106,91,0.14)',
  errorText: '#F6B3AA',
  backdrop: 'rgba(0,0,0,0.6)',
};

export const radius = 12;

export type Tone = 'neutral' | 'progress' | 'ok' | 'warn' | 'stop';
export const toneColor = (c: Palette, tone: Tone): string =>
  ({ neutral: c.inkSoft, progress: c.progress, ok: c.ok, warn: c.warn, stop: c.stop })[tone];

/** The palette for the phone's current light/dark setting (re-renders when it changes). */
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

/**
 * Themed StyleSheet factory: `const useSt = themed((c) => StyleSheet.create({...}))`, then `const st = useSt()` in a component.
 * Built once per scheme and cached.
 */
export function themed<T>(build: (c: Palette) => T): () => T {
  const cache = new Map<Palette, T>();
  return () => {
    const c = usePalette();
    let v = cache.get(c);
    if (!v) cache.set(c, (v = build(c)));
    return v;
  };
}
