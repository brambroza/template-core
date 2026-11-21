/**
 * Home "ต้องตัดสินใจวันนี้" on the phone: what waits on me across the installed modules (same `todo` declarations and
 * ordering as the web home), with the approve / reject / accept buttons on each card. Buttons that need a reason or a
 * confirmation open the same ActionModal as the list screens.
 */
import { router } from 'expo-router';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildTodo, fillPath, formatValue, listRows, todoActions, todoSources, type Action, type ModuleUi, type TodoItem } from '@erp/ui-schema';
import { api } from '../lib/api';
import { radius, themed, usePalette } from '../lib/theme';
import { ActionModal, screenPath } from './Screens';
import { Button, ErrorText, useS } from './ui';

/** shown before "ดูเพิ่ม" */
const FIRST = 4;

export interface DecisionInboxHandle { reload(): Promise<void> }

export const DecisionInbox = forwardRef<DecisionInboxHandle, { modules: ModuleUi[]; perms: string[] }>(function DecisionInbox({ modules, perms }, ref) {
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const sources = useMemo(() => todoSources(modules, perms), [modules, perms.join()]);
  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<{ a: Action; item: TodoItem } | null>(null);

  const load = useCallback(async () => {
    const groups = await Promise.all(sources.map(async ({ module, spec, screen }) => {
      const qs = new URLSearchParams(spec.query ?? {}).toString();
      try { return { module: module.module, spec, rows: listRows(screen, await api<unknown>(module.module, `${screen.endpoint}${qs ? `?${qs}` : ''}`)) }; }
      catch { return { module: module.module, spec, rows: [] }; } // one module down must not hide the others
    }));
    setItems(buildTodo(groups));
  }, [sources]);
  useImperativeHandle(ref, () => ({ reload: load }), [load]);
  useEffect(() => { if (sources.length) load(); }, [load, sources.length]);

  if (!sources.length) return null;
  const open = (items ?? []).filter((i) => !done.has(i.key));
  const shown = all ? open : open.slice(0, FIRST);
  const pressing = open.filter((i) => i.overdue || i.urgent).length;

  const decided = (key: string) => { setDone((d) => new Set(d).add(key)); setTimeout(load, 900); };
  const press = async (a: Action, item: TodoItem) => {
    if (a.fields?.length || a.lines || a.confirm || a.impact) return setActive({ a, item });
    setBusy(`${item.key}:${a.id}`);
    setError('');
    try { await api(item.module, fillPath(a.endpoint, item.row), { method: a.method }); decided(item.key); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <View style={[st.box, { marginHorizontal: 16 }]}>
      <View style={st.head}>
        <Text accessibilityRole="header" style={st.title}>ต้องตัดสินใจวันนี้</Text>
        {items && open.length > 0 && <View style={st.count}><Text style={st.countText}>{open.length}</Text></View>}
      </View>
      {pressing > 0 && <Text style={[st.alert, { color: c.stop }]}>{pressing} เรื่องเร่งด่วน/เกินกำหนด</Text>}
      {!items && <Text style={s.muted}>กำลังดูว่ามีอะไรรอคุณอยู่…</Text>}
      {items && !open.length && <Text style={[s.muted, { color: c.ok, fontWeight: '600' }]}>ไม่มีเรื่องรอคุณตัดสินใจ — เคลียร์หมดแล้ว</Text>}
      <ErrorText text={error} />
      {shown.map((item) => {
        const m = modules.find((x) => x.module === item.module)!;
        const screen = m.screens[item.spec.screen];
        if (screen?.kind !== 'list') return null;
        const actions = todoActions(item, screen, perms).filter((a) => a.mobile !== false);
        const link = screen.rowLink;
        const bar = item.overdue ? c.stop : item.urgent ? c.warn : c.ruleStrong;
        return (
          <View key={item.key} style={[st.card, { borderLeftColor: bar }]}>
            <Pressable accessibilityRole={link ? 'button' : undefined} disabled={!link}
              onPress={() => link && router.push(screenPath(item.module, link.screen, item.row[link.idFrom ?? 'id']))}>
              <Text style={st.kind}>{item.spec.label}</Text>
              <Text style={st.itemTitle} numberOfLines={2}>{item.title || '—'}</Text>
              {!!item.subtitle && <Text style={s.muted} numberOfLines={1}>{item.subtitle}</Text>}
              <View style={st.meta}>
                {item.amount !== undefined && <Text style={st.amount}>{formatValue(item.amount, 'money')} ฿</Text>}
                {!!item.dueText && <Text style={[st.metaText, item.overdue && { color: c.stop, fontWeight: '700' }]}>{item.dueText}</Text>}
                {!!item.waiting && <Text style={st.metaText}>{item.waiting}</Text>}
              </View>
            </Pressable>
            {actions.length > 0 && (
              <View style={st.actions}>
                {actions.map((a) => (
                  <View key={a.id} style={{ flex: 1 }}>
                    <Button label={a.label} tone={a.tone === 'danger' ? 'danger' : a.tone === 'primary' ? 'primary' : 'default'}
                      busy={busy === `${item.key}:${a.id}`} onPress={() => press(a, item)} />
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
      {open.length > FIRST && (
        <Pressable accessibilityRole="button" onPress={() => setAll(!all)} style={{ paddingVertical: 8 }}>
          <Text style={st.more}>{all ? 'ย่อ' : `ดูอีก ${open.length - FIRST} เรื่อง`}</Text>
        </Pressable>
      )}
      {active && (
        <ActionModal action={active.a} module={active.item.module} params={active.item.row}
          onClose={() => setActive(null)} onDone={() => { const k = active.item.key; setActive(null); decided(k); }} />
      )}
    </View>
  );
});

const useSt = themed((c) => StyleSheet.create({
  box: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius + 4, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: c.ink },
  count: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, backgroundColor: c.signal, alignItems: 'center', justifyContent: 'center' },
  countText: { color: c.onSignal, fontWeight: '700', fontSize: 13 },
  alert: { fontSize: 13, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: c.rule, borderLeftWidth: 4, borderRadius: radius, padding: 12, gap: 10, backgroundColor: c.concrete },
  kind: { fontSize: 12, color: c.inkSoft },
  itemTitle: { fontSize: 16, fontWeight: '700', color: c.ink, marginTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6, alignItems: 'baseline' },
  metaText: { fontSize: 13, color: c.inkSoft },
  amount: { fontSize: 15, fontWeight: '700', color: c.ink, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8 },
  more: { color: c.signalDeep, fontWeight: '600' },
}));
