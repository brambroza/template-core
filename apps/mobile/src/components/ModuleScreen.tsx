import { Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { hasPerm } from '@erp/ui-schema';
import { DetailView, FormView, ListView } from './Screens';
import { LabelsContext, s } from './ui';
import { useRegistry } from '../lib/registry';
import { getSession } from '../lib/session';

/** Renders any module screen from its definition. Shared by the index and [id] routes. */
export function ModuleScreen({ module, screen, id }: { module: string; screen: string; id?: string }) {
  const { ui, loading } = useRegistry();
  if (loading) return <Text style={[s.muted, { padding: 16 }]}>กำลังโหลด…</Text>;
  const mod = ui(module);
  const def = mod?.screens[screen];
  const notice = !mod ? 'ยังไม่ได้ติดตั้งโมดูลนี้' : !def ? 'ไม่พบหน้านี้' : !hasPerm(getSession()?.permissions ?? [], def.perm) ? 'ไม่มีสิทธิ์เข้าหน้านี้' : null;
  if (notice || !mod || !def) return <View style={{ padding: 16 }}><Text style={s.h1}>{notice}</Text></View>;
  return (
    <LabelsContext.Provider value={mod.statusLabels}>
      <Stack.Screen options={{ title: def.title }} />
      {def.kind === 'list' && <ListView ui={mod} screen={def} id={id} />}
      {def.kind === 'form' && <FormView ui={mod} screen={def} id={id} />}
      {def.kind === 'detail' && <DetailView ui={mod} screen={def} id={id} />}
    </LabelsContext.Provider>
  );
}

