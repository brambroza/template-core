import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { get, initialValues, type Field, type LinesSpec } from '@erp/ui-schema';
import { api } from '../lib/api';
import { c } from '../lib/theme';
import { Scanner } from './Scanner';
import { Button, ErrorText, s } from './ui';

export type Values = Record<string, unknown>;

interface Props {
  field: Field;
  module: string;
  values: Values;
  onChange: (patch: Values) => void;
  error?: string;
}

function assignFrom(field: Field, record: Record<string, unknown>): Values {
  const patch: Values = {};
  for (const [target, source] of Object.entries(field.lookup!.assign)) patch[target] = get(record, source) ?? undefined;
  return patch;
}

/** Search-and-pick list, with an optional scan button when the lookup declares `scanField`. */
function LookupInput({ field, module, values, onChange, error }: Props) {
  const lk = field.lookup!;
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [chosen, setChosen] = useState('');
  const [scanError, setScanError] = useState('');

  const load = (q: string) => api<Record<string, unknown>[]>(lk.module ?? module, lk.path, { query: { ...lk.query, q: q || undefined, limit: 50 } });

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(text).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [open, text]);

  useEffect(() => { if (!values[field.name]) setChosen(''); }, [values[field.name]]);

  const pick = (r: Record<string, unknown>) => {
    onChange(assignFrom(field, r));
    setChosen(lk.label.map((k) => String(get(r, k) ?? '')).join('  '));
    setOpen(false);
    setText('');
  };

  const onScanned = async (code: string) => {
    setScan(false);
    setScanError('');
    try {
      const found = (await load(code)).find((r) => String(get(r, lk.scanField!)) === code);
      if (found) pick(found);
      else setScanError(`ไม่พบรหัส ${code}`);
    } catch (e) {
      setScanError((e as Error).message);
    }
  };

  const needle = text.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => lk.label.some((k) => String(get(r, k) ?? '').toLowerCase().includes(needle))) : rows;

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`เลือก${field.label}`} onPress={() => setOpen(true)} style={[s.input, st.picker, error ? { borderColor: c.stop } : null]}>
          <Text style={[s.value, !chosen && { color: c.inkSoft }]} numberOfLines={1}>{chosen || `เลือก${field.label}`}</Text>
        </Pressable>
        {lk.scanField && <Button label="สแกน" tone="primary" onPress={() => setScan(true)} />}
      </View>
      <ErrorText text={scanError} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={st.sheet}>
          <Text style={s.h1}>เลือก{field.label}</Text>
          <TextInput style={[s.input, { marginVertical: 12 }]} placeholder="พิมพ์เพื่อค้นหา" value={text} onChangeText={setText} autoFocus />
          <FlatList
            data={shown}
            keyExtractor={(r, i) => String(r.id ?? i)}
            ListEmptyComponent={<Text style={s.muted}>ไม่พบ{field.label}</Text>}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => pick(item)} style={st.option}>
                <Text style={st.optionMain}>{String(get(item, lk.label[0]) ?? '')}</Text>
                {lk.label.slice(1).map((k) => <Text key={k} style={s.muted}>{String(get(item, k) ?? '')}</Text>)}
              </Pressable>
            )}
          />
          <Button label="ปิด" onPress={() => setOpen(false)} />
        </View>
      </Modal>
      {lk.scanField && <Scanner visible={scan} title={`สแกน${field.label}`} onScan={onScanned} onClose={() => setScan(false)} />}
    </View>
  );
}

function SelectInput({ field, values, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const current = field.options?.find((o) => o.value === values[field.name]);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={field.label} onPress={() => setOpen(true)} style={[s.input, st.picker, error ? { borderColor: c.stop } : null]}>
        <Text style={[s.value, !current && { color: c.inkSoft }]}>{current?.label ?? 'ไม่ระบุ'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => setOpen(false)}>
          <View style={st.menu}>
            {[{ value: '', label: 'ไม่ระบุ' }, ...(field.options ?? [])].map((o) => (
              <Pressable key={o.value} style={st.option} onPress={() => { onChange({ [field.name]: o.value }); setOpen(false); }}>
                <Text style={st.optionMain}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function FieldInput(props: Props) {
  const { field, values, onChange, error } = props;
  const v = values[field.name];
  switch (field.type) {
    case 'lookup': return <LookupInput {...props} />;
    case 'select': return <SelectInput {...props} />;
    case 'boolean': return <Switch value={!!v} onValueChange={(x) => onChange({ [field.name]: x })} accessibilityLabel={field.label} />;
    case 'multilookup':
    case 'permissions': return <Text style={s.muted}>ตั้งค่ารายการนี้ได้จากหน้าเว็บ</Text>;
    default:
      return (
        <TextInput
          accessibilityLabel={field.label}
          style={[s.input, field.type === 'textarea' && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }, error ? { borderColor: c.stop } : null]}
          value={String(v ?? '')}
          onChangeText={(t) => onChange({ [field.name]: t })}
          multiline={field.type === 'textarea'}
          secureTextEntry={field.type === 'password'}
          keyboardType={field.type === 'number' ? 'decimal-pad' : field.type === 'email' ? 'email-address' : 'default'}
          autoCapitalize="none"
          placeholder={field.type === 'date' ? 'ปปปป-ดด-วว (ค.ศ.)' : undefined}
        />
      );
  }
}

export function FieldRow(props: Props) {
  const { field, error } = props;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{field.label}{field.required ? ' *' : ''}</Text>
      <FieldInput {...props} />
      {field.help && !error ? <Text style={s.muted}>{field.help}</Text> : null}
      {error ? <Text style={st.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Lines as stacked cards (a table is too wide for a phone). */
export function LinesEditor({ spec, module, lines, onChange }: { spec: LinesSpec; module: string; lines: Values[]; onChange: (l: Values[]) => void }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.label, { fontSize: 16 }]}>{spec.label}</Text>
      {lines.map((line, i) => (
        <View key={i} style={st.lineCard}>
          <View style={st.lineHead}>
            <Text style={s.muted}>รายการที่ {i + 1}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`ลบรายการที่ ${i + 1}`} onPress={() => onChange(lines.filter((_, j) => j !== i))}><Text style={{ color: c.stop }}>ลบ</Text></Pressable>
          </View>
          {spec.fields.map((f) => (
            <FieldRow key={f.name} field={f} module={module} values={line} onChange={(p) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)))} />
          ))}
        </View>
      ))}
      <Button label="เพิ่มรายการ" onPress={() => onChange([...lines, initialValues(spec.fields)])} />
    </View>
  );
}

const st = StyleSheet.create({
  picker: { flex: 1, justifyContent: 'center' },
  sheet: { flex: 1, padding: 20, paddingTop: 56, backgroundColor: c.concrete, gap: 8 },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.ruleSoft, backgroundColor: c.paper },
  optionMain: { fontSize: 16, fontWeight: '600', color: c.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(31,42,51,0.45)', justifyContent: 'center', padding: 24 },
  menu: { backgroundColor: c.paper, borderRadius: 12, overflow: 'hidden' },
  lineCard: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: 12, padding: 12, marginBottom: 10 },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  fieldError: { color: c.stop, fontSize: 13, marginTop: 4 },
});
