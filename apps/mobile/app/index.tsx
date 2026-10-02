import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatValue, get, hasPerm, type FeedWidget, type KpiWidget, type ModuleUi } from '@erp/ui-schema';
import { screenPath } from '../src/components/Screens';
import { Button, ErrorText, s } from '../src/components/ui';
import { api } from '../src/lib/api';
import { useRegistry } from '../src/lib/registry';
import { clearSession, getSession } from '../src/lib/session';
import { c, radius, toneColor } from '../src/lib/theme';

type Data = Record<string, unknown>;

/**
 * Home: today's numbers (every module's KPI widgets), what the bots just reported (feed widgets),
 * then the shop-floor screens (mobile: true) this user may open.
 */
export default function Home() {
  const { modules, loading, error, reload } = useRegistry();
  const session = getSession();
  const perms = session?.permissions ?? [];
  const [data, setData] = useState<Record<string, Data>>({});

  const widgets = modules.flatMap((m) => (m.widgets ?? []).filter((w) => (w.kind === 'kpi' || w.kind === 'feed') && hasPerm(perms, w.perm)).map((w) => ({ m, w })));
  const key = widgets.map(({ m, w }) => `${m.module}${w.endpoint}`).join(',');
  const load = useCallback(() => {
    const srcs = [...new Set(widgets.map(({ m, w }) => `${m.module}|${w.endpoint}`))];
    Promise.all(srcs.map(async (src) => {
      const [mod, path] = src.split('|');
      try { return [src, await api<Data>(mod, path)] as const; } catch { return [src, null] as const; }
    })).then((entries) => setData(Object.fromEntries(entries.filter(([, d]) => d)) as Record<string, Data>));
  }, [key]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const kpis = widgets.filter((x): x is { m: ModuleUi; w: KpiWidget } => x.w.kind === 'kpi');
  const feeds = widgets.filter((x): x is { m: ModuleUi; w: FeedWidget } => x.w.kind === 'feed');

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 18 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { reload(); load(); }} />}>
      <Stack.Screen options={{ title: session?.tenant.name ?? 'ERP' }} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={st.hello}>สวัสดี {session?.user.name?.split(' ')[0] ?? ''}</Text>
        <Text style={s.muted}>ภาพรวมโรงงานวันนี้ — ดึงลงเพื่ออัปเดต</Text>
        <ErrorText text={error} />
      </View>

      {kpis.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {kpis.flatMap(({ m, w }) => w.items.map((it) => {
            const d = data[`${m.module}|${w.endpoint}`];
            const v = Number(get(d, it.key) ?? 0);
            const color = v > 0 && it.tone && it.tone !== 'neutral' ? toneColor[it.tone] : c.ink;
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

      {modules.map((m) => {
        const items = m.menu.filter((i) => m.screens[i.screen]?.mobile && hasPerm(perms, m.screens[i.screen].perm));
        if (!items.length) return null;
        return (
          <View key={m.module} style={[st.card, { marginHorizontal: 16 }]}>
            <View style={st.cardHead}>
              <View style={st.glyph}><Text style={st.glyphText}>{m.glyph}</Text></View>
              <Text style={[st.cardTitle, { flex: 1 }]}>{m.label}</Text>
            </View>
            <View style={st.tiles}>
              {items.map((i) => (
                <Pressable key={i.screen} accessibilityRole="button" onPress={() => router.push(screenPath(m.module, i.screen))} style={({ pressed }) => [st.tile, pressed && { backgroundColor: 'rgba(245,197,24,0.22)' }]}>
                  <Text style={st.tileText}>{i.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {!loading && !error && modules.every((m) => !m.menu.some((i) => m.screens[i.screen]?.mobile)) && (
        <Text style={[s.muted, { paddingHorizontal: 16 }]}>โมดูลที่ติดตั้งยังไม่มีหน้าจอสำหรับมือถือ ใช้งานผ่านหน้าเว็บได้</Text>
      )}
      <View style={{ marginTop: 8, paddingHorizontal: 16 }}>
        <Text style={s.muted}>{session?.user.name} · {session?.user.email}</Text>
        <View style={{ marginTop: 8 }}><Button label="ออกจากระบบ" onPress={async () => { await clearSession(); router.replace('/login'); }} /></View>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  hello: { fontSize: 24, fontWeight: '700', color: c.ink },
  kpi: { width: 132, padding: 14, borderRadius: radius + 4, backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, gap: 2 },
  kpiModule: { fontSize: 11, fontWeight: '600', color: c.inkSoft, textTransform: 'uppercase' },
  kpiValue: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: radius + 4, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.ink, flex: 1 },
  link: { color: c.signalDeep, fontWeight: '600' },
  glyph: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.signal, alignItems: 'center', justifyContent: 'center' },
  glyphText: { color: c.ink, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, paddingTop: 4 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 52, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius, backgroundColor: c.ruleSoft },
  tileText: { fontSize: 15, fontWeight: '500', color: c.ink },
  feedRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.ruleSoft },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
  feedTitle: { fontSize: 15, fontWeight: '600', color: c.ink },
});
