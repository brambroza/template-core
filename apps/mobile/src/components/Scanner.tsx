import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { c } from '../lib/theme';
import { Button } from './ui';

/** Full-screen QR / barcode scanner. Calls onScan once with the decoded text. */
export function Scanner({ visible, title, onScan, onClose }: { visible: boolean; title: string; onScan: (text: string) => void; onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [done, setDone] = useState(false);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setDone(false)}>
      <View style={st.wrap}>
        <Text style={st.title}>{title}</Text>
        {!permission?.granted ? (
          <View style={st.center}>
            <Text style={st.text}>ต้องอนุญาตให้ใช้กล้องเพื่อสแกน</Text>
            <Button label="อนุญาตใช้กล้อง" tone="primary" onPress={requestPermission} />
          </View>
        ) : (
          <CameraView
            style={st.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
            onBarcodeScanned={done ? undefined : ({ data }) => { setDone(true); onScan(data); }}
          />
        )}
        <View style={st.foot}><Button label="ปิด" onPress={onClose} /></View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.ink, paddingTop: 56 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', paddingHorizontal: 20, paddingBottom: 12 },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center' },
  foot: { padding: 20 },
});
