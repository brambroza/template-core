import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { formatValue, statusTone, type Format } from '@erp/ui-schema';
import { c, radius, toneColor } from '../lib/theme';

export function Button({ label, onPress, tone = 'default', disabled, busy }: { label: string; onPress: () => void; tone?: 'primary' | 'danger' | 'default'; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.btn, tone === 'primary' && s.btnPrimary, tone === 'danger' && s.btnDanger, (pressed || disabled) && { opacity: 0.7 }]}
    >
      {busy ? <ActivityIndicator color={c.ink} /> : <Text style={[s.btnText, tone === 'danger' && { color: c.stop }]}>{label}</Text>}
    </Pressable>
  );
}

/** The current module's own status wording (ModuleUi.statusLabels). */
export const LabelsContext = createContext<Record<string, string> | undefined>(undefined);

export function ValueText({ value, format }: { value: unknown; format?: Format }) {
  const labels = useContext(LabelsContext);
  if (format === 'status' && typeof value === 'string' && value) {
    const color = toneColor[statusTone(value)];
    return (
      <View style={s.status}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <Text style={[s.value, { color }]}>{formatValue(value, 'status', labels)}</Text>
      </View>
    );
  }
  if (format === 'qr') return null; // payment QR is printed from the web app
  return <Text style={s.value}>{formatValue(value, format, labels)}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function ErrorText({ text }: { text?: string | null }) {
  if (!text) return null;
  return <Text accessibilityRole="alert" style={s.error}>{text}</Text>;
}

/** Safety-yellow/ink hatching used as the brand mark (floor tape). */
export function Tape({ height = 10 }: { height?: number }) {
  return (
    <View style={{ height, flexDirection: 'row', overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 60 }).map((_, i) => (
        <View key={i} style={{ width: 12, height: height * 3, backgroundColor: i % 2 ? c.ink : c.signal, transform: [{ skewX: '-45deg' }], marginTop: -height }} />
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: radius, borderWidth: 1, borderColor: c.rule, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: c.signal, borderColor: c.signalDeep },
  btnDanger: { borderColor: c.stop },
  btnText: { fontSize: 16, fontWeight: '600', color: c.ink },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  value: { fontSize: 16, color: c.ink },
  card: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius + 4, overflow: 'hidden' },
  error: { color: '#7D241C', backgroundColor: '#FBEDEB', borderLeftWidth: 4, borderLeftColor: c.stop, borderRadius: 8, padding: 12, fontSize: 15, marginVertical: 8 },
  label: { fontSize: 14, fontWeight: '600', color: c.ink, marginBottom: 4 },
  muted: { fontSize: 13, color: c.inkSoft },
  input: { minHeight: 48, borderWidth: 1, borderColor: c.rule, borderRadius: radius, paddingHorizontal: 12, fontSize: 16, color: c.ink, backgroundColor: c.paper },
  h1: { fontSize: 22, fontWeight: '700', color: c.ink },
});
