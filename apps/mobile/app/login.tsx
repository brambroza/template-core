import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, ErrorText, s, Tape } from '../src/components/ui';
import { api } from '../src/lib/api';
import { defaultGatewayUrl, saveSession } from '../src/lib/session';
import { c } from '../src/lib/theme';

export default function Login() {
  const [server, setServer] = useState(defaultGatewayUrl());
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('identity', '/auth/login', { method: 'POST', body: { tenant: tenant.trim().toLowerCase(), email: email.trim(), password }, baseUrl: server });
      await saveSession({ token: r.token, gatewayUrl: server.replace(/\/$/, ''), tenant: r.tenant, user: r.user, permissions: r.permissions });
      router.replace('/');
    } catch (e) {
      setError((e as Error).message === 'Invalid credentials' ? 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง' : (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.ink }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: c.paper, borderRadius: 12, overflow: 'hidden' }}>
          <Tape height={12} />
          <View style={{ padding: 20, gap: 14 }}>
            <Text style={s.h1}>เข้าสู่ระบบ</Text>
            <View><Text style={s.label}>รหัสบริษัท</Text><TextInput style={s.input} value={tenant} onChangeText={setTenant} autoCapitalize="none" accessibilityLabel="รหัสบริษัท" /></View>
            <View><Text style={s.label}>อีเมล</Text><TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="อีเมล" /></View>
            <View><Text style={s.label}>รหัสผ่าน</Text><TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="รหัสผ่าน" /></View>
            <View><Text style={s.label}>ที่อยู่เซิร์ฟเวอร์</Text><TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" accessibilityLabel="ที่อยู่เซิร์ฟเวอร์" /></View>
            <ErrorText text={error} />
            <Button label="เข้าสู่ระบบ" tone="primary" busy={busy} onPress={submit} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
