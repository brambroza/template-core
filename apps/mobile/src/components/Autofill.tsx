import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { autofillReady, autofillValues, get, type FormAutofill } from '@erp/ui-schema';
import { api } from '../lib/api';
import { usePalette } from '../lib/theme';
import { Card, ErrorText, useS } from './ui';

type Row = Record<string, unknown>;

/** Phone version of the web AutofillBox (`FormScreen.autofill`): type a tax ID or a name, tap a match, the form fills itself. */
export function AutofillBox({ module, spec, onPick }: { module: string; spec: FormAutofill; onPick: (values: Record<string, unknown>) => void }) {
  const s = useS();
  const c = usePalette();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const kind = autofillReady(text, spec.minLength);
    if (!kind) { setRows(null); setError(''); return; }
    const t = setTimeout(async () => {
      const mine = ++seq.current;
      setBusy(true);
      setError('');
      try {
        const r = await api<{ results?: Row[] } | Row[]>(module, spec.endpoint, { query: { q: text.trim() } });
        if (mine === seq.current) setRows(Array.isArray(r) ? r : r.results ?? []);
      } catch (e) {
        if (mine === seq.current) { setRows(null); setError((e as Error).message); }
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, kind === 'tin' ? 0 : 700);
    return () => clearTimeout(t);
  }, [text]);

  const line = (r: Row, keys?: string[]) => (keys ?? []).map((k) => get(r, k)).filter((v) => v !== undefined && v !== null && v !== '').join(' · ');
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{spec.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput accessibilityLabel={spec.label} style={[s.input, { flex: 1 }]} value={text} onChangeText={(v) => { setText(v); setPicked(''); }}
          placeholder={spec.placeholder ?? 'เลขผู้เสียภาษี 13 หลัก หรือชื่อบริษัท'} placeholderTextColor={c.inkSoft} autoCorrect={false} />
        {busy && <ActivityIndicator color={c.inkSoft} />}
      </View>
      {!!picked && <Text style={s.muted} accessibilityLiveRegion="polite">กรอกข้อมูลจาก {picked} แล้ว — ตรวจแล้วกดบันทึก</Text>}
      <ErrorText text={error} />
      {rows && rows.length === 0 && <Text style={s.muted}>ไม่พบ “{text.trim()}” — กรอกเองได้ด้านล่าง</Text>}
      {!!rows?.length && (
        <Card>
          {rows.map((r, i) => (
            <Pressable key={i} accessibilityRole="button" onPress={() => { onPick(autofillValues(spec, r)); setPicked(line(r, spec.title)); setRows(null); setText(''); }}
              style={({ pressed }) => [{ padding: 12, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.ruleSoft }, pressed && { backgroundColor: c.pressed }]}>
              <Text style={s.value}>{line(r, spec.title)}</Text>
              {spec.subtitle && <Text style={s.muted}>{line(r, spec.subtitle)}</Text>}
              {spec.existing && !!get(r, spec.existing) && <Text style={[s.muted, { color: c.warn }]}>มีในระบบแล้ว: {String(get(r, spec.existing))}</Text>}
            </Pressable>
          ))}
        </Card>
      )}
    </View>
  );
}
