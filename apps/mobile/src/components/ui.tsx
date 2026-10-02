import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { formatValue, statusTone, type Format } from '@erp/ui-schema';
import { displayValue } from '../lib/dates';
import { radius, themed, toneColor, usePalette } from '../lib/theme';

export function Button({ label, onPress, tone = 'default', disabled, busy, size = 'normal', accessibilityLabel }: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'danger' | 'default';
  disabled?: boolean;
  busy?: boolean;
  /** `large`: the main action at the bottom of a form (gloved thumbs) */
  size?: 'normal' | 'large';
  accessibilityLabel?: string;
}) {
  const c = usePalette();
  const s = useS();
  const textColor = tone === 'primary' ? c.onSignal : tone === 'danger' ? c.stop : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.btn, size === 'large' && s.btnLarge, tone === 'primary' && s.btnPrimary, tone === 'danger' && s.btnDanger, (pressed || disabled) && { opacity: 0.7 }]}
    >
      {busy ? <ActivityIndicator color={textColor} /> : <Text style={[s.btnText, size === 'large' && { fontSize: 18 }, { color: textColor }]}>{label}</Text>}
    </Pressable>
  );
}

/** The current module's own status wording (ModuleUi.statusLabels). */
export const LabelsContext = createContext<Record<string, string> | undefined>(undefined);

export function ValueText({ value, format }: { value: unknown; format?: Format }) {
  const labels = useContext(LabelsContext);
  const c = usePalette();
  const s = useS();
  if (format === 'status' && typeof value === 'string' && value) {
    const color = toneColor(c, statusTone(value));
    return (
      <View style={s.status}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <Text style={[s.value, { color }]}>{formatValue(value, 'status', labels)}</Text>
      </View>
    );
  }
  if (format === 'qr') return null; // payment QR is printed from the web app
  return <Text style={[s.value, (format === 'money' || format === 'qty') && { fontVariant: ['tabular-nums'] }]}>{displayValue(value, format, labels)}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useS();
  return <View style={[s.card, style]}>{children}</View>;
}

export function ErrorText({ text }: { text?: string | null }) {
  const s = useS();
  if (!text) return null;
  return <Text accessibilityRole="alert" style={s.error}>{text}</Text>;
}

/** Centered "nothing here" block with an optional hint (pull to refresh, where to add things). */
export function EmptyState({ title, hint, loading }: { title: string; hint?: string; loading?: boolean }) {
  const c = usePalette();
  const s = useS();
  return (
    <View style={s.empty} accessibilityRole="text">
      {loading ? <ActivityIndicator color={c.inkSoft} /> : <View style={s.emptyMark} />}
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={[s.muted, { textAlign: 'center' }]}>{hint}</Text> : null}
    </View>
  );
}

/** Safety-yellow/ink hatching used as the brand mark (floor tape). */
export function Tape({ height = 10 }: { height?: number }) {
  const c = usePalette();
  return (
    <View style={{ height, flexDirection: 'row', overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 60 }).map((_, i) => (
        <View key={i} style={{ width: 12, height: height * 3, backgroundColor: i % 2 ? c.onSignal : c.signal, transform: [{ skewX: '-45deg' }], marginTop: -height }} />
      ))}
    </View>
  );
}

/** Shared styles for the current light/dark scheme: `const s = useS()`. */
export const useS = themed((c) => StyleSheet.create({
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: radius, borderWidth: 1, borderColor: c.rule, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center' },
  btnLarge: { minHeight: 58, borderRadius: radius + 2 },
  btnPrimary: { backgroundColor: c.signal, borderColor: c.signalDeep },
  btnDanger: { borderColor: c.stop },
  btnText: { fontSize: 16, fontWeight: '600', color: c.ink },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  value: { fontSize: 16, color: c.ink },
  card: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius + 4, overflow: 'hidden' },
  error: { color: c.errorText, backgroundColor: c.errorBg, borderLeftWidth: 4, borderLeftColor: c.stop, borderRadius: 8, padding: 12, fontSize: 15, marginVertical: 8 },
  label: { fontSize: 14, fontWeight: '600', color: c.ink, marginBottom: 4 },
  muted: { fontSize: 13, color: c.inkSoft },
  input: { minHeight: 48, borderWidth: 1, borderColor: c.rule, borderRadius: radius, paddingHorizontal: 12, fontSize: 16, color: c.ink, backgroundColor: c.paper },
  h1: { fontSize: 22, fontWeight: '700', color: c.ink },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyMark: { width: 40, height: 6, borderRadius: 3, backgroundColor: c.ruleStrong, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: c.inkSoft, textAlign: 'center' },
  /** sticky footer holding a form's main button */
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.rule, backgroundColor: c.concrete, gap: 10 },
}));
