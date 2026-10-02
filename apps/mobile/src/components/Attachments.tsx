import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentRef, fileKind, formatBytes, formatDate, hasPerm, type AttachmentInfo, type AttachmentsPanel } from '@erp/ui-schema';
import { api } from '../lib/api';
import { getSession } from '../lib/session';
import { c } from '../lib/theme';
import { Card, ErrorText, s } from './ui';

const KIND_TH: Record<string, string> = { image: 'รูป', pdf: 'PDF', sheet: 'ตาราง', doc: 'เอกสาร', text: 'ข้อความ', file: 'ไฟล์' };

/**
 * Files attached to a record (`DetailScreen.attachments`): list with thumbnails; tap opens the file in the phone's viewer
 * through a short-lived signed link (`GET /_attachments/:id/link`), since the system browser cannot send our token.
 *
 * Taking a photo / picking a file needs `expo-image-picker` and `expo-document-picker`, which this app does not ship yet —
 * until they are added, upload from the web app (see docs/ui.md "ไฟล์แนบ").
 */
export function AttachmentsList({ module, spec, recordId }: { module: string; spec: AttachmentsPanel; recordId: string }) {
  const session = getSession();
  const allowed = hasPerm(session?.permissions ?? [], spec.perm);
  const [files, setFiles] = useState<AttachmentInfo[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const base = (session?.gatewayUrl ?? '').replace(/\/$/, '');

  const load = useCallback(() => {
    api<AttachmentInfo[]>(module, '/_attachments', { query: { ref: attachmentRef(spec.entity, recordId) } })
      .then((r) => { setFiles(r); setError(''); })
      .catch((e) => { setFiles([]); if (e.status === 403) setDenied(true); else setError(e.message); });
  }, [module, spec.entity, recordId]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed || denied) return null;

  const open = async (f: AttachmentInfo) => {
    try {
      const link = await api<{ url: string }>(module, `/_attachments/${f.id}/link`);
      await Linking.openURL(`${base}/api/${module}${link.url}`);
    } catch (e) {
      setError((e as Error).message || 'เปิดไฟล์ไม่ได้');
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.label, { fontSize: 16 }]}>{spec.label ?? 'ไฟล์แนบ'}{files?.length ? ` (${files.length})` : ''}</Text>
      <ErrorText text={error} />
      {!files && <Text style={s.muted}>กำลังโหลด…</Text>}
      {files?.length === 0 && <Text style={s.muted}>ยังไม่มีไฟล์ — แนบไฟล์ได้จากหน้าเว็บ</Text>}
      {!!files?.length && (
        <Card>
          {files.map((f, i) => {
            const kind = fileKind(f.content_type);
            return (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                accessibilityLabel={`เปิด ${f.file_name}`}
                onPress={() => open(f)}
                style={({ pressed }) => [st.row, i > 0 && st.rule, pressed && { backgroundColor: '#F7F8F5' }]}
              >
                {kind === 'image' && session ? (
                  <Image
                    source={{ uri: `${base}/api/${module}/_attachments/${f.id}/content`, headers: { Authorization: `Bearer ${session.token}` } }}
                    style={st.thumb}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[st.thumb, st.icon]}><Text style={st.iconText}>{KIND_TH[kind]}</Text></View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.value} numberOfLines={1}>{f.file_name}</Text>
                  <Text style={s.muted} numberOfLines={1}>{formatBytes(f.size)} · {f.uploaded_by_name ?? 'ไม่ระบุชื่อ'} · {formatDate(f.created_at, true)}</Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, minHeight: 64 },
  rule: { borderTopWidth: 1, borderTopColor: c.ruleSoft },
  thumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: c.concrete },
  icon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.rule },
  iconText: { fontSize: 11, fontWeight: '700', color: c.inkSoft },
});
