import { router, Stack } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { hasPerm } from '@erp/ui-schema';
import { screenPath } from '../src/components/Screens';
import { Button, ErrorText, s } from '../src/components/ui';
import { useRegistry } from '../src/lib/registry';
import { clearSession, getSession } from '../src/lib/session';
import { c } from '../src/lib/theme';

/** Home: only the screens each module marks for the shop floor (mobile: true) that this user may open. */
export default function Home() {
  const { modules, loading, error, reload } = useRegistry();
  const session = getSession();
  const perms = session?.permissions ?? [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <Stack.Screen options={{ title: session?.tenant.name ?? 'ERP' }} />
      <ErrorText text={error} />
      {modules.map((m) => {
        const items = m.menu.filter((i) => m.screens[i.screen]?.mobile && hasPerm(perms, m.screens[i.screen].perm));
        if (!items.length) return null;
        return (
          <View key={m.module} style={st.group}>
            <View style={st.groupHead}>
              <View style={st.glyph}><Text style={st.glyphText}>{m.glyph}</Text></View>
              <Text style={st.groupTitle}>{m.label}</Text>
            </View>
            {items.map((i) => (
              <Pressable key={i.screen} accessibilityRole="button" onPress={() => router.push(screenPath(m.module, i.screen))} style={({ pressed }) => [st.item, pressed && { backgroundColor: 'rgba(242,194,48,0.18)' }]}>
                <Text style={st.itemText}>{i.label}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
      {!loading && !error && modules.every((m) => !m.menu.some((i) => m.screens[i.screen]?.mobile)) && (
        <Text style={s.muted}>โมดูลที่ติดตั้งยังไม่มีหน้าจอสำหรับมือถือ ใช้งานผ่านหน้าเว็บได้</Text>
      )}
      <View style={{ marginTop: 8 }}>
        <Text style={s.muted}>{session?.user.name} · {session?.user.email}</Text>
        <View style={{ marginTop: 8 }}><Button label="ออกจากระบบ" onPress={async () => { await clearSession(); router.replace('/login'); }} /></View>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  group: { backgroundColor: c.paper, borderWidth: 1, borderColor: c.rule, borderRadius: 4, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 2, borderBottomColor: c.ink },
  glyph: { width: 26, height: 26, borderRadius: 3, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  glyphText: { color: '#fff', fontWeight: '700' },
  groupTitle: { fontSize: 17, fontWeight: '700', color: c.ink },
  item: { paddingVertical: 16, paddingHorizontal: 50, borderBottomWidth: 1, borderBottomColor: c.ruleSoft },
  itemText: { fontSize: 16, color: c.ink },
});
