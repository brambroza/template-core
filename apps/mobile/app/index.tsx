import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatValue, get, groupByArea, hasPerm, type FeedWidget, type KpiWidget, type ModuleUi } from '@erp/ui-schema';
import { DecisionInbox, type DecisionInboxHandle } from '../src/components/DecisionInbox';
import { screenPath } from '../src/components/Screens';
import { Button, EmptyState, ErrorText, useS } from '../src/components/ui';
import { api } from '../src/lib/api';
import { useRegistry } from '../src/lib/registry';
import { clearSession, getSession } from '../src/lib/session';
import { radius, themed, toneColor, usePalette } from '../src/lib/theme';

type Data = Record<string, unknown>;

/**
 * Home: what waits on my decision (todo), today's numbers (every module's KPI widgets), what the bots just reported
 * (feed widgets), then the shop-floor screens (mobile: true) this user may open.
 */
export default function Home() {
  const { modules, loading, error, reload } = useRegistry();
  const session = getSession();
  const perms = session?.permissions ?? [];
  const [data, setData] = useState<Record<string, Data>>({});
  const [refreshing, setRefreshing] = useState(false);
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const inbox = useRef<DecisionInboxHandle>(null);

  const widgets = modules.flatMap((m) => (m.widgets ?? []).filter((w) => (w.kind === 'kpi' || w.kind === 'feed') && hasPerm(perms, w.perm)).map((w) => ({ m, w })));
  const key = widgets.map(({ m, w }) => `${m.module}${w.endpoint}`).join(',');
  const load = useCallback(() => {
    const srcs = [...new Set(widgets.map(({ m, w }) => `${m.module}|${w.endpoint}`))];
    return Promise.all(srcs.map(async (src) => {
      const [mod, path] = src.split('|');
      try { return [src, await api<Data>(mod, path)] as const; } catch { return [src, null] as const; }
    })).then((entries) => setData(Object.fromEntries(entries.filter(([, d]) => d)) as Record<string, Data>));
  }, [key]);
  useFocusEffect(useCallback(() => { load(); inbox.current?.reload(); }, [load]));

  const kpis = widgets.filter((x): x is { m: ModuleUi; w: KpiWidget } => x.w.kind === 'kpi');
  const feeds = widgets.filter((x): x is { m: ModuleUi; w: FeedWidget } => x.w.kind === 'feed');

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 18 }} refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); reload(); try { await Promise.all([load(), inbox.current?.reload()]); } finally { setRefreshing(false); } }}
          tintColor={c.inkSoft}
          colors={[c.signalDeep]}
          progressBackgroundColor={c.paper}
        />
      }>
      <Stack.Screen options={{ title: session?.tenant.name ?? 'ERP' }} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={st.hello}>สวัสดี {session?.user.name?.split(' ')[0] ?? ''}</Text>
        <Text style={s.muted}>ภาพรวมวันนี้ — ดึงลงเพื่ออัปเดต</Text>
        <ErrorText text={error} />
      </View>

      <DecisionInbox ref={inbox} modules={modules} perms={perms} />

      {kpis.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {kpis.flatMap(({ m, w }) => w.items.map((it) => {
            const d = data[`${m.module}|${w.endpoint}`];
            const v = Number(get(d, it.key) ?? 0);
            const color = v > 0 && it.tone && it.tone !== 'neutral' ? toneColor(c, it.tone) : c.ink;
            return (
              <Pressable key={`${m.module}.${w.id}.${it.key}`} accessibilityRole="button" onPress={() => w.href && router.push(screenPath(m.module, w.href))} style={st.kpi}>
                <Text style={st.kpiModule}>{m.label}</Text>
                <Text style={[st.kpiValue, { color }]} numberOfLines={1}>{d ? (it.format === 'money' ? `฿${formatValue(Math.round(v), 'qty')}` : formatValue(v, 'qty')) : '–'}</Text>
                <Text style={s.muted} numberOfLines={2}>{it.label}</Text>
              </Pressable>
            );
          }))}
        </ScrollView>
      )}

      {feeds.map(({ m, w }) => {
        const rows = ((get(data[`${m.module}|${w.endpoint}`], w.rows) ?? []) as Data[]).slice(0, 4);
        if (!rows.length) return null;
        return (
          <View key={`${m.module}.${w.id}`} style={[st.card, { marginHorizontal: 16 }]}>
            <View style={st.cardHead}><Text style={st.cardTitle}>{w.title}</Text>{w.href && <Text style={st.link} onPress={() => router.push(screenPath(m.module, w.href!))}>ดูทั้งหมด</Text>}</View>
            {rows.map((r, i) => {
              const level = w.level ? String(get(r, w.level)) : 'info';
              const dot = level === 'stop' ? c.stop : level === 'warn' ? c.warn : level === 'ok' ? c.ok : c.progress;
              return (
                <View key={String(get(r, 'id') ?? i)} style={st.feedRow}>
                  <View style={[st.dot, { backgroundColor: dot }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.feedTitle}>{String(get(r, w.title2) ?? '')}</Text>
                    {w.body && <Text style={s.muted} numberOfLines={2}>{String(get(r, w.body) ?? '')}</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}

      {groupByArea(
        modules.map((m) => ({ m, items: m.menu.filter((i) => m.screens[i.screen]?.mobile && hasPerm(perms, m.screens[i.screen].perm)) })).filter((x) => x.items.length),
        (x) => x.m,
      ).map((g) => (
        <View key={g.area} style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={st.area}>{g.label}</Text>
          {g.items.map(({ m, items }) => (
            <View key={m.module} style={[st.card, { marginHorizontal: 16 }]}>
              <View style={st.cardHead}>
                <View style={st.glyph}><Text style={st.glyphText}>{m.glyph}</Text></View>
                <Text style={[st.cardTitle, { flex: 1 }]}>{m.label}</Text>
              </View>
              <View style={st.tiles}>
                {items.map((i) => (
                  <Pressable key={i.screen} accessibilityRole="button" onPress={() => router.push(screenPath(m.module, i.screen))} style={({ pressed }) => [st.tile, pressed && { backgroundColor: c.pressedSignal }]}>
                    <Text style={st.tileText}>{i.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      ))}
      {loading && !modules.length && <EmptyState loading title="กำลังโหลด…" />}
      {!loading && !error && modules.every((m) => !m.menu.some((i) => m.screens[i.screen]?.mobile && hasPerm(perms, m.screens[i.screen].perm))) && (
        <EmptyState title="ยังไม่มีหน้าจอสำหรับมือถือ" hint="โมดูลที่ติดตั้งหรือสิทธิ์ของบัญชีนี้ยังไม่มีงานบนมือถือ ใช้งานผ่านหน้าเว็บได้" />
      )}
      <View style={{ marginTop: 8, paddingHorizontal: 16 }}>
        <Text style={s.muted}>{session?.user.name} · {session?.user.email}</Text>
        <View style={{ marginTop: 8 }}><Button label="ออกจากระบบ" onPress={async () => { await clearSession(); router.replace('/login'); }} /></View>
      </View>
    </ScrollView>
  );
}

const useSt = themed((c) => StyleSheet.create({
  hello: { fontSize: 24, fontWeight: '700', color: c.ink },
  area: { paddingHorizontal: 16, marginTop: 6, fontSize: 13, fontWeight: '700', color: c.inkSoft, letterSpacing: 0.2 },
  kpi: { width: 132, padding: 14, borderRadius: radius + 4, backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, gap: 2 },
  kpiModule: { fontSize: 11, fontWeight: '600', color: c.inkSoft, textTransform: 'uppercase' },
  kpiValue: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius + 4, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.ink, flex: 1 },
  link: { color: c.signalDeep, fontWeight: '600' },
  glyph: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.signal, alignItems: 'center', justifyContent: 'center' },
  glyphText: { color: c.onSignal, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, paddingTop: 4 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 52, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius, backgroundColor: c.ruleSoft },
  tileText: { fontSize: 15, fontWeight: '500', color: c.ink },
  feedRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.ruleSoft },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
  feedTitle: { fontSize: 15, fontWeight: '600', color: c.ink },
}));
