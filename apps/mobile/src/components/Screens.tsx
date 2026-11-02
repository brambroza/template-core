import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useContext, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  boardLanes, boardMoves, fillPath, filterRows, get, hasPerm, initialValues, listRows, matches, missingRequired, pickMove, routeParams, toBody,
  type Action, type DetailScreen, type FormScreen, type ListScreen, type ModuleUi,
} from '@erp/ui-schema';
import { api, ApiError } from '../lib/api';
import { getSession } from '../lib/session';
import { themed, useIsDark, usePalette } from '../lib/theme';
import { AttachmentsList } from './Attachments';
import { FieldRow, LinesEditor, type Values } from './Fields';
import { Button, Card, EmptyState, ErrorText, LabelsContext, useS, ValueText } from './ui';

export const screenPath = (module: string, screen: string, id?: unknown) =>
  `/m/${module}/${screen}${id !== undefined && id !== null && id !== '' ? `/${encodeURIComponent(String(id))}` : ''}`;

const perms = () => getSession()?.permissions ?? [];
const isMobile = (ui: ModuleUi, id?: string) => !!id && !!ui.screens[id]?.mobile;
/** native-stack header height under the status bar (iOS); keeps the keyboard from covering the bottom button */
const HEADER = 44;

/** Themed pull-to-refresh spinner. */
function Refresh({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const c = usePalette();
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.inkSoft} colors={[c.signalDeep]} progressBackgroundColor={c.paper} />;
}

/** A refresh wrapper that shows the spinner while `load` runs. */
function useRefresh(load: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);
  return { refreshing, onRefresh };
}

/**
 * Form layout for phones: scrolling fields, then the main button pinned at the bottom (large, above the keyboard and the
 * home indicator) so it is always one thumb away.
 */
function FormFrame({ children, footer, modal }: { children: ReactNode; footer: ReactNode; modal?: boolean }) {
  const insets = useSafeAreaInsets();
  const s = useS();
  const c = usePalette();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.concrete }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' && !modal ? insets.top + HEADER : 0}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: modal ? insets.top + 16 : 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        {children}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

export function ListView({ ui, screen, id }: { ui: ModuleUi; screen: ListScreen; id?: string }) {
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const labels = useContext(LabelsContext);
  const params = routeParams(screen.endpoint, id);

  const load = useCallback(async () => {
    try {
      setError('');
      const query = screen.board ? { limit: String(screen.board.limit ?? 200) } : undefined;
      setRows(listRows(screen, await api(ui.module, fillPath(screen.endpoint, params), query ? { query } : {})));
    } catch (e) {
      setError((e as Error).message);
      setRows((r) => r ?? []);
    }
  }, [ui.module, screen.endpoint, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshing, onRefresh } = useRefresh(load);

  // kanban (display 'board'): lanes become tabs, and each card offers "ย้ายไป …" for the lanes it may move to
  const board = screen.display === 'board' ? screen.board : undefined;
  const [lane, setLane] = useState<string | null>(null);
  const moves = board ? boardMoves(ui, screen) : {};
  const searched = filterRows(rows ?? [], screen.columns, query, labels);
  const lanes = board ? boardLanes(board, searched) : [];
  const shown = board && lane ? searched.filter((r) => String(get(r, board.field) ?? '') === lane) : searched;
  const moveTargets = (row: Record<string, unknown>) => (board ? board.lanes.flatMap((l) => {
    const a = pickMove(moves, row, l.value, perms(), board.field);
    return a ? [{ lane: l, action: a }] : [];
  }) : []);
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

  const empty = !rows
    ? <EmptyState loading title="กำลังโหลด…" />
    : query.trim() && rows.length
      ? <EmptyState title={`ไม่พบรายการที่ตรงกับ “${query.trim()}”`} hint="ลองคำอื่น หรือล้างช่องค้นหา" />
      : error
        ? <EmptyState title="โหลดรายการไม่ได้" hint="ดึงลงเพื่อลองใหม่" />
        : <EmptyState title={screen.empty ?? 'ไม่มีรายการ'} hint={canCreate ? `กด “${screen.createLabel ?? 'สร้างใหม่'}” เพื่อเพิ่ม หรือดึงลงเพื่ออัปเดต` : 'ดึงลงเพื่ออัปเดต'} />;

  return (
    <View style={{ flex: 1 }}>
      {(!!rows?.length || !!query) && (
        <View style={st.search}>
          <TextInput
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="ค้นหาในรายการ"
            placeholderTextColor={c.inkFaint}
            accessibilityLabel={`ค้นหาใน${screen.title}`}
            clearButtonMode="while-editing"
            autoCorrect={false}
            returnKeyType="search"
          />
          {!!query && <Text style={s.muted}>พบ {shown.length} จาก {rows?.length ?? 0} รายการ</Text>}
        </View>
      )}
      {!!error && <View style={{ paddingHorizontal: 16 }}><ErrorText text={error} /></View>}
      {board && !!rows?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.lanes} accessibilityRole="tablist">
          {[{ value: null as string | null, label: 'ทั้งหมด', count: searched.length }, ...lanes.map((l) => ({ value: l.value as string | null, label: l.label, count: l.rows.length }))].map((t) => {
            const on = lane === t.value;
            return (
              <Pressable key={t.value ?? '*'} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setLane(t.value)}
                style={[st.laneChip, on && { backgroundColor: c.signal, borderColor: c.signal }]}>
                <Text style={[st.laneText, on && { color: c.onSignal }]}>{t.label} {t.count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <FlatList
        data={shown}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        keyExtractor={(r, i) => String(r.id ?? i)}
        refreshControl={<Refresh refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole={link ? 'button' : undefined}
            disabled={!link}
            onPress={() => link && router.push(screenPath(ui.module, link.screen, get(item, link.idFrom ?? 'id')))}
            style={({ pressed }) => [s.card, st.row, pressed && { backgroundColor: c.pressed }]}
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
            {moveTargets(item).length > 0 && (
              <View style={st.rowActions}>
                {moveTargets(item).map((m) => (
                  <Button key={m.lane.value} label={`ย้ายไป ${m.lane.label}`} busy={busy === `${m.action.id}:${String(item.id)}`} onPress={() => press(m.action, item)} />
                ))}
              </View>
            )}
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
      {canCreate && (
        <CreateBar label={screen.createLabel ?? 'สร้างใหม่'} onPress={() => router.push(screenPath(ui.module, screen.create!))} />
      )}
      {active && <ActionModal action={active.a} module={ui.module} params={active.row} onClose={() => setActive(null)} onDone={(res) => done(active.a, res)} />}
    </View>
  );
}

/** "สร้างใหม่" pinned at the bottom of a list (thumb reach), above the home indicator. */
function CreateBar({ label, onPress }: { label: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  const s = useS();
  return (
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Button label={label} tone="primary" size="large" onPress={onPress} />
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
    <FormFrame
      footer={<>
        <ErrorText text={error} />
        <Button label={screen.submitLabel} tone="primary" size="large" busy={busy} onPress={submit} />
      </>}
    >
      {screen.fields.map((f) => <FieldRow key={f.name} field={f} module={ui.module} values={values} error={errors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />)}
      {screen.lines && <LinesEditor spec={screen.lines} module={ui.module} lines={lines} onChange={setLines} />}
    </FormFrame>
  );
}

function ActionModal({ action, module, params, onClose, onDone }: { action: Action; module: string; params: Record<string, unknown>; onClose: () => void; onDone: (res: any) => void }) {
  const s = useS();
  const dark = useIsDark();
  const [values, setValues] = useState<Values>(() => initialValues(action.fields ?? []));
  const [lines, setLines] = useState<Values[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const fe = missingRequired(action.fields ?? [], values);
    setErrors(fe);
    if (Object.keys(fe).length) return setError('กรอกข้อมูลที่จำเป็นให้ครบ');
    setBusy(true);
    setError('');
    try {
      const used = lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined));
      const body = action.fields?.length || action.lines ? toBody(action.fields ?? [], values, action.lines, used) : undefined;
      onDone(await api(module, fillPath(action.endpoint, values, params), { method: action.method, body }));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]])));
      setBusy(false);
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <FormFrame
        modal
        footer={<>
          <ErrorText text={error} />
          <Button label={action.label} tone={action.tone === 'danger' ? 'danger' : 'primary'} size="large" busy={busy} onPress={run} />
          <Button label="ยกเลิก" onPress={onClose} disabled={busy} />
        </>}
      >
        <Text accessibilityRole="header" style={[s.h1, { marginBottom: 12 }]}>{action.label}</Text>
        {action.confirm && <Text style={[s.value, { marginBottom: 16 }]}>{action.confirm}</Text>}
        {(action.fields ?? []).map((f) => <FieldRow key={f.name} field={f} module={module} values={values} error={errors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />)}
        {action.lines && <LinesEditor spec={action.lines} module={module} lines={lines} onChange={setLines} />}
      </FormFrame>
    </Modal>
  );
}

export function DetailView({ ui, screen, id }: { ui: ModuleUi; screen: DetailScreen; id?: string }) {
  const s = useS();
  const st = useSt();
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const params = routeParams(screen.endpoint, id);

  const load = useCallback(async () => {
    try {
      const r = await api<Record<string, unknown>>(ui.module, fillPath(screen.endpoint, params));
      setRecord(r);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ui.module, screen.endpoint, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshing, onRefresh } = useRefresh(useCallback(async () => { setReloadKey((k) => k + 1); await load(); }, [load]));
  const refresh = <Refresh refreshing={refreshing} onRefresh={onRefresh} />;

  if (!record) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1 }} refreshControl={refresh}>
        {error ? <><ErrorText text={error} /><EmptyState title="โหลดข้อมูลไม่ได้" hint="ดึงลงเพื่อลองใหม่" /></> : <EmptyState loading title="กำลังโหลด…" />}
      </ScrollView>
    );
  }

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
    setError('');
    try { done(a, await api(ui.module, fillPath(a.endpoint, params, record), { method: a.method })); } catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const facts = screen.fields.filter((f) => {
    const v = get(record, f.key);
    return !(v === null || v === undefined || v === '' || f.format === 'qr');
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} refreshControl={refresh}>
      <View>
        <Text style={s.muted}>{screen.title}</Text>
        <Text accessibilityRole="header" style={s.h1}>{String(get(record, screen.heading) ?? '')}</Text>
      </View>
      <ErrorText text={error} />
      {actions.length > 0 && <View style={{ gap: 8 }}>{actions.map((a, i) => <Button key={a.id} label={a.label} tone={a.tone ?? (i === 0 ? 'primary' : 'default')} size="large" busy={busy === a.id} onPress={() => press(a)} />)}</View>}
      {facts.length > 0 && (
        <Card>
          {facts.map((f, i) => (
            <View key={f.key} style={[st.fact, i === facts.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={s.muted}>{f.label}</Text>
              <ValueText value={get(record, f.key)} format={f.format} />
            </View>
          ))}
        </Card>
      )}
      {screen.lines?.map((ls) => {
        const rows = (get(record, ls.path) as Record<string, unknown>[] | undefined) ?? [];
        return (
          <View key={ls.path} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={[s.label, { fontSize: 16 }]}>{ls.label}{rows.length ? ` (${rows.length})` : ''}</Text>
            {rows.length === 0 && <Card><EmptyState title={`ไม่มี${ls.label}`} /></Card>}
            {rows.map((r, i) => (
              // tree lines (multi-level BOM): each level sits further in, rows arrive depth first
              <Card key={String(r.id ?? i)} style={{ padding: 12, gap: 4, marginLeft: ls.tree ? Math.min((Number(get(r, ls.tree.level)) || 1) - 1, 4) * 14 : 0 }}>
                {ls.columns.map((col) => (
                  <View key={col.key} style={st.rowLine}><Text style={s.muted}>{col.label}</Text><ValueText value={get(r, col.key)} format={col.format} /></View>
                ))}
              </Card>
            ))}
          </View>
        );
      })}
      {screen.attachments && id && <AttachmentsList module={ui.module} spec={screen.attachments} recordId={id} reloadKey={reloadKey} />}
      {active && <ActionModal action={active} module={ui.module} params={{ ...params, ...record }} onClose={() => setActive(null)} onDone={(res) => done(active, res)} />}
    </ScrollView>
  );
}

const useSt = themed((c) => StyleSheet.create({
  search: { paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  row: { padding: 14, gap: 4 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: c.ink },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  lanes: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  laneChip: { paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: c.rule, backgroundColor: c.paper },
  laneText: { fontSize: 14, fontWeight: '600', color: c.ink },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  fact: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.ruleSoft, gap: 2 },
}));
