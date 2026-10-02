import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fillPath, get, hasPerm, initialValues, listRows, matches, missingRequired, routeParams, toBody,
  type Action, type DetailScreen, type FormScreen, type ListScreen, type ModuleUi,
} from '@erp/ui-schema';
import { api, ApiError } from '../lib/api';
import { getSession } from '../lib/session';
import { c } from '../lib/theme';
import { FieldRow, LinesEditor, type Values } from './Fields';
import { Button, Card, ErrorText, s, ValueText } from './ui';

export const screenPath = (module: string, screen: string, id?: unknown) =>
  `/m/${module}/${screen}${id !== undefined && id !== null && id !== '' ? `/${encodeURIComponent(String(id))}` : ''}`;

const perms = () => getSession()?.permissions ?? [];
const isMobile = (ui: ModuleUi, id?: string) => !!id && !!ui.screens[id]?.mobile;

export function ListView({ ui, screen, id }: { ui: ModuleUi; screen: ListScreen; id?: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const params = routeParams(screen.endpoint, id);

  const load = useCallback(async () => {
    try {
      setError('');
      setRows(listRows(screen, await api(ui.module, fillPath(screen.endpoint, params))));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [ui.module, screen.endpoint, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const titleCol = screen.columns[0];
  const detailCols = screen.columns.slice(1);
  const link = screen.rowLink && isMobile(ui, screen.rowLink.screen) ? screen.rowLink : undefined;
  const canCreate = screen.create && isMobile(ui, screen.create) && hasPerm(perms(), ui.screens[screen.create].perm);
  const rowActions = (screen.rowActions ?? []).filter((a) => a.mobile && hasPerm(perms(), a.perm));
  const [active, setActive] = useState<{ a: Action; row: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const done = (a: Action, res: any) => {
    setActive(null);
    setBusy(null);
    if (a.then && isMobile(ui, a.then.screen)) router.push(screenPath(ui.module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined));
    else load();
  };
  const press = async (a: Action, row: Record<string, unknown>) => {
    if (a.fields?.length || a.lines || a.confirm) return setActive({ a, row });
    setBusy(`${a.id}:${String(row.id)}`);
    try { done(a, await api(ui.module, fillPath(a.endpoint, row), { method: a.method })); } catch (e) { setError((e as Error).message); setBusy(null); }
  };

  return (
    <View style={{ flex: 1 }}>
      {canCreate && <View style={st.bar}><Button label={screen.createLabel ?? 'สร้างใหม่'} tone="primary" onPress={() => router.push(screenPath(ui.module, screen.create!))} /></View>}
      <ErrorText text={error} />
      <FlatList
        data={rows ?? []}
        keyExtractor={(r, i) => String(r.id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={rows ? <Text style={s.muted}>{screen.empty ?? 'ไม่มีรายการ'}</Text> : <Text style={s.muted}>กำลังโหลด…</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole={link ? 'button' : undefined}
            disabled={!link}
            onPress={() => link && router.push(screenPath(ui.module, link.screen, get(item, link.idFrom ?? 'id')))}
            style={({ pressed }) => [s.card, st.row, pressed && { backgroundColor: '#F7F8F5' }]}
          >
            <Text style={st.rowTitle}>{String(get(item, titleCol.key) ?? '')}</Text>
            {detailCols.map((col) => {
              const v = get(item, col.key);
              if (v === null || v === undefined || v === '') return null;
              return (
                <View key={col.key} style={st.rowLine}>
                  <Text style={s.muted}>{col.label}</Text>
                  <ValueText value={v} format={col.format} />
                </View>
              );
            })}
            {rowActions.some((a) => matches(item, a.when)) && (
              <View style={st.rowActions}>
                {rowActions.filter((a) => matches(item, a.when)).map((a) => (
                  <Button key={a.id} label={a.label} tone={a.tone} busy={busy === `${a.id}:${String(item.id)}`} onPress={() => press(a, item)} />
                ))}
              </View>
            )}
          </Pressable>
        )}
      />
      {active && <ActionModal action={active.a} module={ui.module} params={active.row} onClose={() => setActive(null)} onDone={(res) => done(active.a, res)} />}
    </View>
  );
}

export function FormView({ ui, screen, id }: { ui: ModuleUi; screen: FormScreen; id?: string }) {
  const [values, setValues] = useState<Values>(() => initialValues(screen.fields));
  const [lines, setLines] = useState<Values[]>(() => (screen.lines ? [initialValues(screen.lines.fields)] : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const params = routeParams(screen.endpoint, id);

  const submit = async () => {
    const fe = missingRequired(screen.fields, values);
    setErrors(fe);
    const used = lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined && v !== null));
    if (Object.keys(fe).length) return setError('กรอกข้อมูลที่จำเป็นให้ครบ');
    if (screen.lines?.min && used.length < screen.lines.min) return setError(`เพิ่ม${screen.lines.label}อย่างน้อย ${screen.lines.min} รายการ`);
    if (screen.lines && used.some((l) => Object.keys(missingRequired(screen.lines!.fields, l)).length)) return setError(`กรอก${screen.lines.label}ให้ครบทุกช่องที่มีเครื่องหมาย *`);
    setBusy(true);
    setError('');
    try {
      const res = await api<Record<string, unknown>>(ui.module, fillPath(screen.endpoint, values, params), { method: screen.method, body: toBody(screen.fields, values, screen.lines, used) });
      const after = screen.after;
      if (after && isMobile(ui, after.screen)) router.replace(screenPath(ui.module, after.screen, after.idFrom ? get(res, after.idFrom) : undefined));
      else router.back();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]])));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {screen.fields.map((f) => <FieldRow key={f.name} field={f} module={ui.module} values={values} error={errors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />)}
      {screen.lines && <LinesEditor spec={screen.lines} module={ui.module} lines={lines} onChange={setLines} />}
      <ErrorText text={error} />
      <View style={{ marginTop: 16, gap: 10 }}>
        <Button label={screen.submitLabel} tone="primary" busy={busy} onPress={submit} />
      </View>
    </ScrollView>
  );
}

function ActionModal({ action, module, params, onClose, onDone }: { action: Action; module: string; params: Record<string, unknown>; onClose: () => void; onDone: (res: any) => void }) {
  const [values, setValues] = useState<Values>(() => initialValues(action.fields ?? []));
  const [lines, setLines] = useState<Values[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const fe = missingRequired(action.fields ?? [], values);
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const used = lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined));
      const body = action.fields?.length || action.lines ? toBody(action.fields ?? [], values, action.lines, used) : undefined;
      onDone(await api(module, fillPath(action.endpoint, values, params), { method: action.method, body }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, backgroundColor: c.concrete, minHeight: '100%' }} keyboardShouldPersistTaps="handled">
        <Text style={[s.h1, { marginBottom: 12 }]}>{action.label}</Text>
        {action.confirm && <Text style={[s.value, { marginBottom: 16 }]}>{action.confirm}</Text>}
        {(action.fields ?? []).map((f) => <FieldRow key={f.name} field={f} module={module} values={values} error={errors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />)}
        {action.lines && <LinesEditor spec={action.lines} module={module} lines={lines} onChange={setLines} />}
        <ErrorText text={error} />
        <View style={{ gap: 10, marginTop: 16 }}>
          <Button label={action.label} tone={action.tone === 'danger' ? 'danger' : 'primary'} busy={busy} onPress={run} />
          <Button label="ยกเลิก" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

export function DetailView({ ui, screen, id }: { ui: ModuleUi; screen: DetailScreen; id?: string }) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const params = routeParams(screen.endpoint, id);

  const load = useCallback(() => {
    api<Record<string, unknown>>(ui.module, fillPath(screen.endpoint, params)).then(setRecord).catch((e) => setError(e.message));
  }, [ui.module, screen.endpoint, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error) return <View style={{ padding: 16 }}><ErrorText text={error} /></View>;
  if (!record) return <Text style={[s.muted, { padding: 16 }]}>กำลังโหลด…</Text>;

  const actions = (screen.actions ?? []).filter((a) => a.mobile && hasPerm(perms(), a.perm) && matches(record, a.when));
  const done = (a: Action, res: any) => {
    setActive(null);
    setBusy(null);
    if (a.then && isMobile(ui, a.then.screen)) router.push(screenPath(ui.module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined));
    else load();
  };
  const press = async (a: Action) => {
    if (a.fields?.length || a.lines || a.confirm) return setActive(a);
    setBusy(a.id);
    try { done(a, await api(ui.module, fillPath(a.endpoint, params, record), { method: a.method })); } catch (e) { setError((e as Error).message); setBusy(null); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View>
        <Text style={s.muted}>{screen.title}</Text>
        <Text style={s.h1}>{String(get(record, screen.heading) ?? '')}</Text>
      </View>
      {actions.length > 0 && <View style={{ gap: 8 }}>{actions.map((a) => <Button key={a.id} label={a.label} tone={a.tone} busy={busy === a.id} onPress={() => press(a)} />)}</View>}
      <Card>
        {screen.fields.map((f) => {
          const v = get(record, f.key);
          if (v === null || v === undefined || v === '' || f.format === 'qr') return null;
          return (
            <View key={f.key} style={st.fact}>
              <Text style={s.muted}>{f.label}</Text>
              <ValueText value={v} format={f.format} />
            </View>
          );
        })}
      </Card>
      {screen.lines?.map((ls) => {
        const rows = (get(record, ls.path) as Record<string, unknown>[] | undefined) ?? [];
        return (
          <View key={ls.path} style={{ gap: 8 }}>
            <Text style={[s.label, { fontSize: 16 }]}>{ls.label}</Text>
            {rows.length === 0 && <Text style={s.muted}>ไม่มีรายการ</Text>}
            {rows.map((r, i) => (
              <Card key={String(r.id ?? i)} style={{ padding: 12, gap: 4 }}>
                {ls.columns.map((col) => (
                  <View key={col.key} style={st.rowLine}><Text style={s.muted}>{col.label}</Text><ValueText value={get(r, col.key)} format={col.format} /></View>
                ))}
              </Card>
            ))}
          </View>
        );
      })}
      {active && <ActionModal action={active} module={ui.module} params={{ ...params, ...record }} onClose={() => setActive(null)} onDone={(res) => done(active, res)} />}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingTop: 12 },
  row: { padding: 14, gap: 4 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: c.ink },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  fact: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.ruleSoft, gap: 2 },
});
