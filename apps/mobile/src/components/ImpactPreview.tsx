/**
 * "ผลกระทบเมื่อกดยืนยัน" in a mobile action dialog (same as the web): the action runs as a dry run (`?_dryRun=1`, nothing saved),
 * then every installed module that would react says what it would do (`POST /api/_impact`). Re-runs 0.6 s after the inputs change;
 * a refusal (e.g. receiving more than ordered) shows before the button is pressed.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { fillPath, toBody, type Action } from '@erp/ui-schema';
import { api, ApiError } from '../lib/api';
import { radius, themed, usePalette } from '../lib/theme';
import type { Values } from './Fields';

interface Impact { module: string; nameTh: string; event: string; lines: { text: string; tone?: 'info' | 'ok' | 'warn' | 'stop' }[] }
type Preview = { state: 'loading' } | { state: 'blocked'; message: string } | { state: 'ready'; impacts: Impact[] } | { state: 'unavailable' };

/** physical effects first (stock, cost, QC), then the books */
const ORDER = ['inventory', 'costing', 'quality', 'production', 'sales', 'purchasing', 'accounting'];
const rank = (m: string) => (ORDER.includes(m) ? ORDER.indexOf(m) : ORDER.length);

/** `onStops` gets the number of red lines (e.g. stock below zero), which the dialog asks the user to acknowledge. */
export function ImpactPreview({ action, module, params, values, lines, onStops }: {
  action: Action; module: string; params: Record<string, unknown>; values: Values; lines: Values[]; onStops?: (n: number) => void;
}) {
  const c = usePalette();
  const st = useSt();
  const [p, setP] = useState<Preview>({ state: 'loading' });
  useEffect(() => { onStops?.(p.state === 'ready' ? p.impacts.flatMap((g) => g.lines).filter((l) => l.tone === 'stop').length : 0); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify([values, lines]);
  useEffect(() => {
    let stop = false;
    const t = setTimeout(async () => {
      try {
        const used = lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined));
        const body = action.fields?.length || action.lines ? toBody(action.fields ?? [], values, action.lines, used) : undefined;
        const dry = await api<{ dryRun?: boolean; events?: unknown[] }>(module, fillPath(action.endpoint, values, params), { method: action.method, body, query: { _dryRun: 1 } });
        if (!dry?.dryRun) { if (!stop) setP({ state: 'unavailable' }); return; }
        const r = dry.events?.length ? await api<{ impacts: Impact[] }>('_impact', '', { method: 'POST', body: { events: dry.events } }) : { impacts: [] };
        if (!stop) setP({ state: 'ready', impacts: [...r.impacts].sort((a, b) => rank(a.module) - rank(b.module)) });
      } catch (e) {
        if (!stop) setP(e instanceof ApiError && e.status >= 400 && e.status < 500 ? { state: 'blocked', message: e.message } : { state: 'unavailable' });
      }
    }, 600);
    return () => { stop = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p.state === 'unavailable') return null;
  const dot = (tone?: string) => (tone === 'stop' ? c.stop : tone === 'warn' ? c.warn : tone === 'ok' ? c.ok : tone === 'info' ? c.signal : c.ruleStrong);
  return (
    <View style={st.box} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={st.title}>ผลกระทบเมื่อกดยืนยัน</Text>
        {p.state === 'loading' && <ActivityIndicator size="small" color={c.inkSoft} />}
      </View>
      {p.state === 'blocked' && <Text style={[st.line, { color: c.stop, fontWeight: '600' }]}>ยังทำรายการนี้ไม่ได้: {p.message}</Text>}
      {p.state === 'ready' && !p.impacts.length && <Text style={st.note}>ไม่มีผลต่อส่วนอื่นของระบบ (หรือบัญชีนี้ไม่มีสิทธิ์ดู)</Text>}
      {p.state === 'ready' && p.impacts.map((g) => (
        <View key={`${g.module}.${g.event}`} style={{ gap: 4 }}>
          <Text style={st.group}>{g.nameTh}</Text>
          {g.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <View style={[st.dot, { backgroundColor: dot(l.tone) }]} />
              <Text style={[st.line, l.tone === 'stop' && { color: c.stop }]}>{l.text}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={st.note}>ตัวอย่างนี้ยังไม่บันทึกอะไร — คำนวณจากข้อมูล ณ ตอนนี้</Text>
    </View>
  );
}

const useSt = themed((c) => StyleSheet.create({
  box: { marginTop: 8, marginBottom: 16, padding: 12, gap: 10, borderRadius: radius, borderWidth: 1, borderColor: c.rule, backgroundColor: c.ruleSoft },
  title: { fontSize: 15, fontWeight: '700', color: c.ink },
  group: { fontSize: 12, fontWeight: '700', color: c.inkSoft },
  line: { flex: 1, fontSize: 14, color: c.ink, fontVariant: ['tabular-nums'] },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  note: { fontSize: 12, color: c.inkSoft },
}));
