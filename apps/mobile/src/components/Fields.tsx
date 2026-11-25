import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dateInputText, get, initialValues, monthInputText, numberSpec, parseDateInput, parseMonthInput, plainNumber, showNumber, typeNumber, type Field, type LinesSpec } from '@erp/ui-schema';
import { api } from '../lib/api';
import { thaiDate } from '../lib/dates';
import { useNumberFormat } from '../lib/number-format';
import { commaAsPoint } from '../lib/numbers';
import { radius, themed, useIsDark, usePalette } from '../lib/theme';
import { Scanner } from './Scanner';
import { Button, EmptyState, ErrorText, useS } from './ui';

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

/** Status bar for a full-screen modal on the light/dark page background. */
function ModalStatusBar() {
  return <StatusBar style={useIsDark() ? 'light' : 'dark'} />;
}

/** Search-and-pick list, with an optional scan button when the lookup declares `scanField`. */
function LookupInput({ field, module, values, onChange, error }: Props) {
  const lk = field.lookup!;
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
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
  const shown = needle ? (rows ?? []).filter((r) => lk.label.some((k) => String(get(r, k) ?? '').toLowerCase().includes(needle))) : rows ?? [];

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`เลือก${field.label}`} onPress={() => setOpen(true)} style={[s.input, st.picker, error ? { borderColor: c.stop } : null]}>
          <Text style={[s.value, !chosen && { color: c.inkFaint }]} numberOfLines={1}>{chosen || `เลือก${field.label}`}</Text>
        </Pressable>
        {lk.scanField && <Button label="สแกน" tone="primary" onPress={() => setScan(true)} />}
      </View>
      <ErrorText text={scanError} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <ModalStatusBar />
        <View style={[st.sheet, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 12 }]}>
          <Text style={s.h1}>เลือก{field.label}</Text>
          <TextInput
            style={[s.input, { marginVertical: 12 }]}
            placeholder="พิมพ์เพื่อค้นหา"
            placeholderTextColor={c.inkFaint}
            value={text}
            onChangeText={setText}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={`ค้นหา${field.label}`}
          />
          <FlatList
            data={shown}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(r, i) => String(r.id ?? i)}
            ListEmptyComponent={<EmptyState loading={rows === null} title={rows === null ? 'กำลังโหลด…' : needle ? `ไม่พบ${field.label}ที่ตรงกับ “${text.trim()}”` : `ไม่พบ${field.label}`} />}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => pick(item)} style={({ pressed }) => [st.option, pressed && { backgroundColor: c.pressed }]}>
                <Text style={st.optionMain}>{String(get(item, lk.label[0]) ?? '')}</Text>
                {lk.label.slice(1).map((k) => <Text key={k} style={s.muted}>{String(get(item, k) ?? '')}</Text>)}
              </Pressable>
            )}
          />
          <Button label="ปิด" size="large" onPress={() => setOpen(false)} />
        </View>
      </Modal>
      {lk.scanField && <Scanner visible={scan} title={`สแกน${field.label}`} onScan={onScanned} onClose={() => setScan(false)} />}
    </View>
  );
}

function SelectInput({ field, values, onChange, error }: Props) {
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const [open, setOpen] = useState(false);
  const current = field.options?.find((o) => o.value === values[field.name]);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={field.label} accessibilityValue={{ text: current?.label ?? 'ไม่ระบุ' }} onPress={() => setOpen(true)} style={[s.input, st.picker, error ? { borderColor: c.stop } : null]}>
        <Text style={[s.value, !current && { color: c.inkFaint }]}>{current?.label ?? 'ไม่ระบุ'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => setOpen(false)}>
          <View style={st.menu}>
            <ScrollView>
            {[{ value: '', label: 'ไม่ระบุ' }, ...(field.options ?? [])].map((o) => (
              <Pressable
                key={o.value}
                accessibilityRole="button"
                accessibilityState={{ selected: o.value === (values[field.name] ?? '') }}
                style={({ pressed }) => [st.option, pressed && { backgroundColor: c.pressed }]}
                onPress={() => { onChange({ [field.name]: o.value }); setOpen(false); }}
              >
                <Text style={[st.optionMain, o.value === (values[field.name] ?? '') && { color: c.signalDeep }]}>{o.label}</Text>
              </Pressable>
            ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Keyboard for a text field. Numbers have their own input (`NumberField`). */
function keyboardFor(field: Field): KeyboardTypeOptions {
  if (field.type === 'email') return 'email-address';
  if (field.type === 'date') return 'numbers-and-punctuation';
  return 'default';
}

/**
 * A number typed the way the company writes it (ข้อมูลบริษัท → รูปแบบตัวเลข, set on the web): thousands are grouped while the
 * digits are typed, decimals stop at what the field allows (money / quantity = the company's setting) and are padded when the
 * field is left ("1250.5" -> "1,250.50"). The form still holds the plain number. Whole numbers get the digit pad.
 */
function NumberField({ field, values, onChange, error }: Props) {
  const c = usePalette();
  const s = useS();
  const spec = numberSpec(field, useNumberFormat());
  /** the text while the field has focus; null = show the stored value */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? showNumber(values[field.name], spec);
  return (
    <TextInput
      accessibilityLabel={field.label}
      style={[s.input, { fontSize: 18, fontVariant: ['tabular-nums'] }, error ? { borderColor: c.stop } : null]}
      value={shown}
      onFocus={() => setDraft(shown)}
      onBlur={() => setDraft(null)}
      onChangeText={(t) => {
        const next = typeNumber(commaAsPoint(t, shown), spec);
        setDraft(next);
        onChange({ [field.name]: plainNumber(next) });
      }}
      keyboardType={spec.decimals > 0 ? 'decimal-pad' : 'number-pad'}
      inputMode={spec.decimals > 0 ? 'decimal' : 'numeric'}
      returnKeyType="done"
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={c.inkFaint}
      selectTextOnFocus
    />
  );
}

export function FieldInput(props: Props) {
  const { field, values, onChange, error } = props;
  const c = usePalette();
  const s = useS();
  const v = values[field.name];
  switch (field.type) {
    case 'lookup': return <LookupInput {...props} />;
    case 'select': return <SelectInput {...props} />;
    case 'date':
    case 'month': return <DateInput {...props} />;
    case 'boolean':
      return (
        <Switch
          value={!!v}
          onValueChange={(x) => onChange({ [field.name]: x })}
          accessibilityLabel={field.label}
          trackColor={{ false: c.ruleStrong, true: c.signalDeep }}
          thumbColor={v ? c.signal : c.paper}
          style={{ alignSelf: 'flex-start' }}
        />
      );
    case 'multilookup':
    case 'permissions':
    case 'image': return <Text style={s.muted}>ตั้งค่ารายการนี้ได้จากหน้าเว็บ</Text>;
    case 'number': return <NumberField {...props} />;
    default:
      return (
        <TextInput
          accessibilityLabel={field.label}
          style={[
            s.input,
            field.type === 'textarea' && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
            error ? { borderColor: c.stop } : null,
          ]}
          value={String(v ?? '')}
          onChangeText={(t) => onChange({ [field.name]: t })}
          multiline={field.type === 'textarea'}
          secureTextEntry={field.type === 'password'}
          keyboardType={keyboardFor(field)}
          returnKeyType={field.type === 'textarea' ? 'default' : 'done'}
          autoCapitalize="none"
          autoCorrect={field.type === 'textarea' || field.type === 'text'}
          placeholderTextColor={c.inkFaint}
        />
      );
  }
}

/** Bangkok month ± n as "YYYY-MM". */
function bangkokMonth(offset = 0): string {
  const [y, m] = bangkokIso(0).split('-').map(Number);
  const t = y * 12 + (m - 1) + offset;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Bangkok "today" ± days as ISO. */
function bangkokIso(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

/**
 * Date / month box in พ.ศ.: type 03/10/2569, 3/10/69, 3 ต.ค. 69 (months: 10/2569, ต.ค. 2569); ค.ศ. and ISO also work.
 * One tap: เมื่อวาน / วันนี้ / พรุ่งนี้ (months: เดือนก่อน / เดือนนี้). The value handed on stays ISO (what the server expects).
 */
function DateInput({ field, values, onChange, error }: Props) {
  const c = usePalette();
  const s = useS();
  const month = field.type === 'month';
  const show = month ? monthInputText : dateInputText;
  const parse = month ? parseMonthInput : parseDateInput;
  const v = String(values[field.name] ?? '');
  const [text, setText] = useState(show(v));
  const [bad, setBad] = useState(false);
  useEffect(() => { if (parse(text) !== v) { setText(show(v)); setBad(false); } }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = (t: string) => {
    setText(t);
    const iso = parse(t);
    setBad(!!t.trim() && !iso);
    onChange({ [field.name]: t.trim() ? iso ?? v : '' });
  };
  // dates: yesterday / today / tomorrow · months: last month / this month
  const quick: [string, string][] = month
    ? [['เดือนก่อน', bangkokMonth(-1)], ['เดือนนี้', bangkokMonth(0)]]
    : [['เมื่อวาน', bangkokIso(-1)], ['วันนี้', bangkokIso(0)], ['พรุ่งนี้', bangkokIso(1)]];
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        accessibilityLabel={field.label}
        style={[s.input, { fontVariant: ['tabular-nums'] }, error || bad ? { borderColor: c.stop } : null]}
        value={text}
        onChangeText={type}
        onBlur={() => { if (bad) { setText(show(v)); setBad(false); } }}
        keyboardType={month ? 'default' : 'numbers-and-punctuation'}
        returnKeyType="done"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={month ? 'ดด/ปปปป เช่น 10/2569 หรือ ต.ค. 2569' : 'วว/ดด/ปปปป เช่น 03/10/2569'}
        placeholderTextColor={c.inkFaint}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {quick.map(([label, iso]) => {
          const on = iso === v;
          return (
            <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }}
              onPress={() => { setText(show(iso)); setBad(false); onChange({ [field.name]: iso }); }}
              style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, borderWidth: 1,
                borderColor: on ? c.signal : c.ruleStrong, backgroundColor: on ? c.signal : 'transparent' }}>
              <Text style={{ color: on ? c.paper : c.ink, fontSize: 14 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FieldRow(props: Props) {
  const { field, error, values } = props;
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const v = values[field.name];
  // typed in พ.ศ. (or ค.ศ.), stored ISO; the long Thai form below confirms which day was understood
  const dateHint = field.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? thaiDate(v) : '';
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{field.label}{field.required ? <Text style={{ color: c.stop }}> *</Text> : ''}</Text>
      <FieldInput {...props} />
      {dateHint && !error ? <Text style={[s.muted, { marginTop: 4 }]}>= {dateHint}</Text> : null}
      {field.help && !error ? <Text style={[s.muted, { marginTop: 4 }]}>{field.help}</Text> : null}
      {error ? <Text style={st.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Lines as stacked cards (a table is too wide for a phone). */
export function LinesEditor({ spec, module, lines, onChange }: { spec: LinesSpec; module: string; lines: Values[]; onChange: (l: Values[]) => void }) {
  const s = useS();
  const st = useSt();
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.label, { fontSize: 16 }]}>{spec.label}</Text>
      {lines.length === 0 && <Text style={[s.muted, { marginBottom: 10 }]}>ยังไม่มีรายการ — กด “เพิ่มรายการ”</Text>}
      {lines.map((line, i) => (
        <View key={i} style={st.lineCard}>
          <View style={st.lineHead}>
            <Text style={s.muted}>รายการที่ {i + 1}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`ลบรายการที่ ${i + 1}`} hitSlop={12} onPress={() => onChange(lines.filter((_, j) => j !== i))} style={st.lineDel}>
              <Text style={st.lineDelText}>ลบ</Text>
            </Pressable>
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

const useSt = themed((c) => StyleSheet.create({
  picker: { flex: 1, justifyContent: 'center' },
  sheet: { flex: 1, paddingHorizontal: 20, backgroundColor: c.concrete, gap: 8 },
  option: { minHeight: 56, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.ruleSoft, backgroundColor: c.paper },
  optionMain: { fontSize: 16, fontWeight: '600', color: c.ink },
  backdrop: { flex: 1, backgroundColor: c.backdrop, justifyContent: 'center', padding: 24 },
  menu: { backgroundColor: c.paper, borderRadius: radius, overflow: 'hidden', maxHeight: '80%' },
  lineCard: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius, padding: 12, marginBottom: 10 },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  lineDel: { minHeight: 40, minWidth: 48, alignItems: 'flex-end', justifyContent: 'center' },
  lineDelText: { color: c.stop, fontSize: 15, fontWeight: '600' },
  fieldError: { color: c.stop, fontSize: 13, marginTop: 4 },
}));
