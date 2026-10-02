import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ATTACHMENT_MAX_BYTES, attachmentRef, fileKind, formatBytes, hasPerm, type AttachmentInfo, type AttachmentsPanel,
} from '@erp/ui-schema';
import { api } from '../lib/api';
import { thaiDate } from '../lib/dates';
import { getSession } from '../lib/session';
import { radius, themed, usePalette } from '../lib/theme';
import { base64Bytes, documentFileName, DOCUMENT_TYPES, photoFileName, precheckUpload } from '../lib/upload';
import { Button, Card, ErrorText, useS } from './ui';

const KIND_TH: Record<string, string> = { image: 'รูป', pdf: 'PDF', sheet: 'ตาราง', doc: 'เอกสาร', text: 'ข้อความ', file: 'ไฟล์' };
/** JPEG quality for camera/library photos: a 12 MP shot lands around 1–2.5 MB, well under the 5 MB limit. */
const PHOTO_QUALITY = 0.6;

interface Pending { uri: string; name: string; size?: number | null }

/**
 * Files attached to a record (`DetailScreen.attachments`) — mirrors the web AttachmentsPanel:
 * list with thumbnails; tap a photo = full-screen preview, tap any other file = the phone's viewer through a short-lived
 * signed link (`GET /_attachments/:id/link`, since the system browser cannot send our token);
 * "ถ่ายรูป" / "เลือกรูป" / "แนบไฟล์" → base64 → `POST /_attachments` (5 MB, checked before sending and again by the server);
 * delete when the server says `can_delete`.
 */
export function AttachmentsList({ module, spec, recordId, reloadKey }: { module: string; spec: AttachmentsPanel; recordId: string; reloadKey?: number }) {
  const session = getSession();
  const c = usePalette();
  const s = useS();
  const st = useSt();
  const allowed = hasPerm(session?.permissions ?? [], spec.perm);
  const ref = attachmentRef(spec.entity, recordId);
  const [files, setFiles] = useState<AttachmentInfo[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentInfo | null>(null);
  const base = (session?.gatewayUrl ?? '').replace(/\/$/, '');

  const load = useCallback(() => {
    api<AttachmentInfo[]>(module, '/_attachments', { query: { ref } })
      .then((r) => { setFiles(r); setError(''); })
      .catch((e) => { setFiles((f) => f ?? []); if (e.status === 403) setDenied(true); else setError(e.message); });
  }, [module, ref]);
  useEffect(() => { if (allowed) load(); }, [allowed, load, reloadKey]);

  if (!allowed || denied) return null;

  const contentUrl = (f: AttachmentInfo) => `${base}/api/${module}/_attachments/${f.id}/content`;

  const openExternal = async (f: AttachmentInfo) => {
    try {
      const link = await api<{ url: string }>(module, `/_attachments/${f.id}/link`);
      await Linking.openURL(`${base}/api/${module}${link.url}`);
    } catch (e) {
      setError((e as Error).message || 'เปิดไฟล์ไม่ได้');
    }
  };

  const open = (f: AttachmentInfo) => (fileKind(f.content_type) === 'image' ? setPreview(f) : openExternal(f));

  const remove = (f: AttachmentInfo) =>
    Alert.alert('ลบไฟล์', `ลบไฟล์ "${f.file_name}"?`, [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          setBusy(`กำลังลบ ${f.file_name}…`);
          try {
            await api(module, `/_attachments/${f.id}`, { method: 'DELETE' });
            setNotice('ลบไฟล์แล้ว');
            setPreview(null);
            load();
          } catch (e) {
            setError(`ลบไฟล์ไม่ได้: ${(e as Error).message}`);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const upload = async (list: Pending[]) => {
    setError('');
    setNotice('');
    const problems: string[] = [];
    let sent = 0;
    for (const [i, p] of list.entries()) {
      const label = list.length > 1 ? `${p.name} (${i + 1}/${list.length})` : p.name;
      let size = p.size;
      if (size === null || size === undefined) {
        try { size = new File(p.uri).size; } catch { size = undefined; }
      }
      const pre = precheckUpload(p.name, size);
      if (pre) { problems.push(pre); continue; }
      setBusy(`กำลังแนบ ${label}…`);
      try {
        const dataBase64 = await new File(p.uri).base64();
        const real = base64Bytes(dataBase64);
        const after = precheckUpload(p.name, real);
        if (after) { problems.push(after); continue; }
        await api(module, '/_attachments', { method: 'POST', body: { ref, fileName: p.name, dataBase64 } });
        sent++;
      } catch (e) {
        problems.push(`${p.name}: ${(e as Error).message || 'อ่านไฟล์ไม่ได้'}`);
      }
    }
    setBusy(null);
    if (problems.length) setError(`แนบไฟล์ไม่ได้\n${problems.join('\n')}`);
    if (sent) {
      setNotice(`แนบไฟล์แล้ว ${sent} ไฟล์`);
      load();
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError('ต้องอนุญาตให้แอปใช้กล้องก่อน จึงจะถ่ายรูปแนบได้');
        if (!perm.canAskAgain) Alert.alert('ยังไม่ได้อนุญาตใช้กล้อง', 'เปิดสิทธิ์กล้องให้แอปนี้ในการตั้งค่าของเครื่อง', [{ text: 'ปิด', style: 'cancel' }, { text: 'ไปที่การตั้งค่า', onPress: () => Linking.openSettings() }]);
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY, exif: false });
      if (r.canceled) return;
      const now = new Date();
      await upload(r.assets.map((a) => ({ uri: a.uri, name: photoFileName({ uri: a.uri, mimeType: a.mimeType }, now), size: a.fileSize })));
    } catch (e) {
      setError(`เปิดกล้องไม่ได้: ${(e as Error).message}`);
    }
  };

  const pickPhotos = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY, allowsMultipleSelection: true, selectionLimit: 10, exif: false });
      if (r.canceled) return;
      const now = new Date();
      await upload(r.assets.map((a) => ({ uri: a.uri, name: photoFileName(a, now), size: a.fileSize })));
    } catch (e) {
      setError(`เปิดคลังรูปไม่ได้: ${(e as Error).message}`);
    }
  };

  const pickDocuments = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      await upload(r.assets.map((a) => ({ uri: a.uri, name: documentFileName(a), size: a.size })));
    } catch (e) {
      setError(`เลือกไฟล์ไม่ได้: ${(e as Error).message}`);
    }
  };

  return (
    <View style={{ gap: 10 }} accessibilityLabel={spec.label ?? 'ไฟล์แนบ'}>
      <Text accessibilityRole="header" style={[s.label, { fontSize: 16 }]}>{spec.label ?? 'ไฟล์แนบ'}{files?.length ? ` (${files.length})` : ''}</Text>
      <View style={st.pickers}>
        <PickerButton label="ถ่ายรูป" mark="◉" onPress={takePhoto} disabled={!!busy} />
        <PickerButton label="เลือกรูป" mark="▦" onPress={pickPhotos} disabled={!!busy} />
        <PickerButton label="แนบไฟล์" mark="⎙" onPress={pickDocuments} disabled={!!busy} />
      </View>
      {busy && (
        <View style={st.busy} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
          <ActivityIndicator color={c.inkSoft} />
          <Text style={[s.muted, { flex: 1 }]}>{busy}</Text>
        </View>
      )}
      <ErrorText text={error} />
      {!!notice && !busy && <Text style={st.notice} accessibilityLiveRegion="polite">{notice}</Text>}
      {!files && <Text style={s.muted}>กำลังโหลด…</Text>}
      {files?.length === 0 && !busy && (
        <Text style={s.muted}>ยังไม่มีไฟล์ — ถ่ายรูป เลือกรูป หรือแนบ PDF, Excel, Word, CSV ได้ ไฟล์ละไม่เกิน {formatBytes(ATTACHMENT_MAX_BYTES)}</Text>
      )}
      {!!files?.length && (
        <Card>
          {files.map((f, i) => {
            const kind = fileKind(f.content_type);
            return (
              <View key={f.id} style={[st.row, i > 0 && st.rule]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`เปิด ${f.file_name}`}
                  onPress={() => open(f)}
                  style={({ pressed }) => [st.open, pressed && { backgroundColor: c.pressed }]}
                >
                  {kind === 'image' && session ? (
                    <Image source={{ uri: contentUrl(f), headers: { Authorization: `Bearer ${session.token}` } }} style={st.thumb} accessibilityIgnoresInvertColors />
                  ) : (
                    <View style={[st.thumb, st.icon]}><Text style={st.iconText}>{KIND_TH[kind]}</Text></View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.value} numberOfLines={2}>{f.file_name}</Text>
                    <Text style={s.muted} numberOfLines={2}>{formatBytes(f.size)} · {f.uploaded_by_name ?? 'ไม่ระบุชื่อ'} · {thaiDate(f.created_at, true)}</Text>
                  </View>
                </Pressable>
                {f.can_delete && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`ลบ ${f.file_name}`}
                    onPress={() => remove(f)}
                    disabled={!!busy}
                    hitSlop={6}
                    style={({ pressed }) => [st.del, pressed && { backgroundColor: c.errorBg }]}
                  >
                    <Text style={st.delText}>ลบ</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </Card>
      )}
      {preview && session && (
        <PhotoViewer
          file={preview}
          uri={contentUrl(preview)}
          token={session.token}
          onClose={() => setPreview(null)}
          onOpenExternal={() => openExternal(preview)}
          onDelete={preview.can_delete ? () => remove(preview) : undefined}
        />
      )}
    </View>
  );
}

function PickerButton({ label, mark, onPress, disabled }: { label: string; mark: string; onPress: () => void; disabled?: boolean }) {
  const c = usePalette();
  const st = useSt();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [st.pick, pressed && { backgroundColor: c.pressedSignal }, disabled && { opacity: 0.5 }]}
    >
      <Text style={st.pickMark} importantForAccessibility="no" accessibilityElementsHidden>{mark}</Text>
      <Text style={st.pickText}>{label}</Text>
    </Pressable>
  );
}

/** Full-screen photo with the user's token (no signed link needed: React Native's Image can send headers). */
function PhotoViewer({ file, uri, token, onClose, onOpenExternal, onDelete }: {
  file: AttachmentInfo; uri: string; token: string; onClose: () => void; onOpenExternal: () => void; onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const st = useSt();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar style="light" />
      <View style={[st.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={st.viewerTitle} numberOfLines={1}>{file.file_name}</Text>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Image
            source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
            style={{ flex: 1 }}
            resizeMode="contain"
            onLoadEnd={() => setLoading(false)}
            onError={() => { setFailed(true); setLoading(false); }}
            accessibilityLabel={file.file_name}
            accessibilityIgnoresInvertColors
          />
          {loading && <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />}
          {failed && <Text style={st.viewerError}>เปิดรูปไม่ได้ — ลอง “เปิดด้วยแอปอื่น”</Text>}
        </View>
        <View style={st.viewerBar}>
          <View style={{ flex: 1 }}><Button label="ปิด" tone="primary" size="large" onPress={onClose} /></View>
          <View style={{ flex: 1 }}><Button label="เปิดด้วยแอปอื่น" size="large" onPress={onOpenExternal} /></View>
          {onDelete && <Button label="ลบ" tone="danger" size="large" onPress={onDelete} accessibilityLabel={`ลบ ${file.file_name}`} />}
        </View>
      </View>
    </Modal>
  );
}

const useSt = themed((c) => StyleSheet.create({
  pickers: { flexDirection: 'row', gap: 8 },
  pick: {
    flex: 1, minHeight: 72, borderRadius: radius, borderWidth: 1, borderColor: c.rule, backgroundColor: c.paper,
    alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 8,
  },
  pickMark: { fontSize: 22, color: c.signalDeep, lineHeight: 26 },
  pickText: { fontSize: 15, fontWeight: '600', color: c.ink },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius, backgroundColor: c.ruleSoft },
  notice: { color: c.ok, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, minHeight: 72 },
  rule: { borderTopWidth: 1, borderTopColor: c.ruleSoft },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: c.ruleSoft },
  icon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.rule },
  iconText: { fontSize: 12, fontWeight: '700', color: c.inkSoft },
  del: { minWidth: 56, minHeight: 56, marginRight: 8, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  delText: { color: c.stop, fontSize: 15, fontWeight: '600' },
  viewer: { flex: 1, backgroundColor: '#000', paddingHorizontal: 12, gap: 10 },
  viewerTitle: { color: '#fff', fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  viewerError: { color: '#fff', fontSize: 16, textAlign: 'center', position: 'absolute', left: 0, right: 0 },
  viewerBar: { flexDirection: 'row', gap: 8 },
}));
