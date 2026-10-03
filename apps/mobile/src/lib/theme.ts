import { useColorScheme } from 'react-native';

/**
 * Same palette as the web app (apps/web/src/app/globals.css), brand v2: navy ink on calm cool neutrals,
 * one confident trust blue (`signal`) for primary actions. `light` = :root, `dark` = the `prefers-color-scheme: dark`
 * values. The app follows the phone's setting. (Field names are kept from v1 so screens did not change.)
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
  /** primary actions, "you are here" (web --accent / --btn-primary) */
  signal: string;
  signalDeep: string;
  /** text/icons on the blue accent (white in both modes) */
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
  /** blue tint on a pressed tile */
  pressedSignal: string;
  errorBg: string;
  errorText: string;
  backdrop: string;
}

export const light: Palette = {
  ink: '#0B1324',
  inkSoft: '#4A5568',
  inkFaint: '#8892A6',
  concrete: '#F6F7FB',
  paper: '#FFFFFF',
  rule: '#E3E7EF',
  ruleSoft: '#EEF1F7',
  ruleStrong: '#CBD2DE',
  signal: '#2F5BFF',
  signalDeep: '#1E40D8',
  onSignal: '#FFFFFF',
  ok: '#12A16B',
  warn: '#D9860B',
  stop: '#E0443A',
  progress: '#2F5BFF',
  chrome: '#0B1324',
  onChrome: '#FFFFFF',
  pressed: '#F1F4FA',
  pressedSignal: 'rgba(47,91,255,0.12)',
  errorBg: '#FDEDEC',
  errorText: '#9B241D',
  backdrop: 'rgba(7,11,22,0.45)',
};

export const dark: Palette = {
  ink: '#E8EDF7',
  inkSoft: '#A3AEC4',
  inkFaint: '#6B7690',
  concrete: '#070B16',
  paper: '#0E1526',
  rule: '#1C2740',
  ruleSoft: '#141D33',
  ruleStrong: '#2A3757',
  signal: '#3D5EF5',
  signalDeep: '#8EA4FF',
  onSignal: '#FFFFFF',
  ok: '#2FC488',
  warn: '#EFA53A',
  stop: '#F2675C',
  progress: '#5B7CFF',
  chrome: '#0E1526',
  onChrome: '#E8EDF7',
  pressed: '#141D33',
  pressedSignal: 'rgba(91,124,255,0.18)',
  errorBg: 'rgba(242,103,92,0.14)',
  errorText: '#FFB4AD',
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
