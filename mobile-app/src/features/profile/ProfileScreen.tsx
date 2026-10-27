import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Camera, Trash2 } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ListState } from '../../components/ui/ListState';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useApiAction } from '../../hooks/useApiAction';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { pickImageUpload } from '../../api/imageUpload';
import { formError } from '../../api/validation';
import { getServerScope } from '../../api/environment';
import { positiveId } from '../reports/model';

function parseAccount(value: any) {
  if (!value || typeof value !== 'object') throw Error('Profil ma’lumotlari tasdiqlanmadi.');
  return { ...value, id: positiveId(value.id) };
}
export const ProfileScreen: React.FC = () => {
  const navigation = useAppNavigation(), { user } = useAuth();
  const profile = useScopedQuery(user ? '/auth/profile/' : null, parseAccount);
  return <Page title="Profil" onBack={navigation.goBack} insetBottom={false}>
    <ListState loading={profile.loading} error={profile.error} onRetry={profile.reload} />
    {profile.data && profile.data.id === user?.id && <ProfileForm key={[getServerScope(), user?.id].join(':')} profile={profile.data} reload={profile.reload} />}
    {profile.data && profile.data.id !== user?.id && <Notice error>Server boshqa hisob ma’lumotini qaytardi. Qayta kiring.</Notice>}
  </Page>;
};
function ProfileForm({ profile, reload }: { profile: any; reload: () => Promise<void> }) {
  const { colors } = useTheme(), { refreshProfile, logout } = useAuth();
  const save = useApiAction(), password = useApiAction();
  const [firstName, setFirstName] = useState(String(profile.first_name || ''));
  const [lastName, setLastName] = useState(String(profile.last_name || ''));
  const [email, setEmail] = useState(String(profile.email || ''));
  const [birth, setBirth] = useState(String(profile.date_of_birth || ''));
  const [phone, setPhone] = useState(String(profile.contact_phone || ''));
  const [oldPassword, setOldPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarLock = useRef(false);
  const busy = save.busy || password.busy || avatarUploading;

  const initials = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .map((s: string) => s[0]?.toUpperCase())
    .join('') || (profile.username ? profile.username.slice(0, 2).toUpperCase() : 'U');

  const pickAvatar = async () => {
    if (busy || avatarLock.current) return;
    avatarLock.current = true;
    setAvatarUploading(true);
    setAvatarError(null);
    const scope = captureAuthScope(profile.id);
    try {
      assertAuthScope(scope);
      const formData = await pickImageUpload('avatar', () => assertAuthScope(scope));
      if (!formData) return;
      assertAuthScope(scope);
      await request('/auth/profile/avatar/', {
        method: 'POST',
        body: formData,
      });
      assertAuthScope(scope);
      await refreshProfile();
    } catch (err: any) {
      setAvatarError(err?.message || 'Profil rasmini yuklashda xatolik yuz berdi.');
    } finally {
      avatarLock.current = false;
      setAvatarUploading(false);
    }
  };

  const deleteAvatar = async () => {
    if (busy || avatarLock.current) return;
    avatarLock.current = true;
    setAvatarError(null);
    const scope = captureAuthScope(profile.id);
    try {
      setAvatarUploading(true);
      assertAuthScope(scope);
      await request('/auth/profile/avatar/', { method: 'DELETE' });
      assertAuthScope(scope);
      await refreshProfile();
    } catch (err: any) {
      setAvatarError(err?.message || 'Rasmni o‘chirishda xatolik yuz berdi.');
    } finally {
      avatarLock.current = false;
      setAvatarUploading(false);
    }
  };

  const saveProfile = async () => {
    setSaved(false);
    const result = await save.run(async () => {
      const fields: Record<string, string> = {};
      if (firstName.trim().length > 50) fields.first_name = 'Ism 50 ta belgidan oshmasin.';
      if (lastName.trim().length > 50) fields.last_name = 'Familiya 50 ta belgidan oshmasin.';
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fields.email = 'Email manzilini to‘g‘ri kiriting.';
      if (birth && (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(Date.parse(birth)) || new Date(birth).toISOString().slice(0, 10) !== birth)) fields.date_of_birth = 'Sana YYYY-MM-DD formatida va haqiqiy bo‘lsin.';
      if (phone.trim() && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) fields.contact_phone = 'Telefon raqamini tekshiring.';
      if (Object.keys(fields).length) throw formError(fields);
      const result = parseAccount(await request('/auth/profile/', { method: 'PATCH', body: { first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim(), date_of_birth: birth || null, contact_phone: phone.trim() || null } }));
      if (result.id !== profile.id) throw Error('Server ushbu profilni tasdiqlamadi.');
      await refreshProfile();
      return result;
    });
    if (result) setSaved(true);
  };
  const changePassword = async () => {
    const result = await password.run(async () => {
      const fields: Record<string, string> = {};
      if (!oldPassword) fields.old_password = 'Joriy parolni kiriting.';
      if (newPassword.length < 8) fields.new_password = 'Yangi parol kamida 8 ta belgidan iborat bo‘lsin.';
      if (newPassword !== confirmPassword) fields.confirm_password = 'Yangi parollar mos kelmadi.';
      if (Object.keys(fields).length) throw formError(fields);
      try { return await request('/auth/change-password/', { method: 'POST', body: { old_password: oldPassword, new_password: newPassword } }); }
      catch (failure: any) {
        if (failure.status === 400 && /joriy parol/i.test(failure.message || '')) throw formError({ old_password: failure.message });
        throw failure;
      }
    });
    if (result) {
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      // The backend revokes the old session on password change; never retain its tokens.
      await logout();
    }
  };
  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: 16, borderRadius: 16, gap: 10 };
  return <>
    <View style={[card, profileStyles.avatarCard]}>
      <View style={profileStyles.avatarWrapper}>
        <View style={[profileStyles.avatarCircle, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          {profile.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              accessibilityLabel="Profil rasmi"
              style={profileStyles.avatarImage}
            />
          ) : (
            <Text style={[profileStyles.avatarInitials, { color: colors.text }]}>{initials}</Text>
          )}
          {avatarUploading && (
            <View style={profileStyles.uploadingOverlay}>
              <ActivityIndicator size="small" color="#ffffff" />
            </View>
          )}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Profil rasmini tanlash"
          disabled={busy}
          onPress={pickAvatar}
          style={[profileStyles.cameraButton, { backgroundColor: colors.primaryActionBg, borderColor: colors.surface }]}
        >
          <Camera size={14} color={colors.primaryActionText} />
        </TouchableOpacity>
      </View>

      {profile.avatar_url ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Rasmni o‘chirish"
          disabled={busy}
          onPress={deleteAvatar}
          style={[profileStyles.removeAvatarBtn, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Trash2 size={12} color={colors.danger} />
          <Text style={[profileStyles.removeAvatarText, { color: colors.danger }]}>Rasmni olib tashlash</Text>
        </TouchableOpacity>
      ) : null}

      {avatarError ? <Notice error>{avatarError}</Notice> : null}

      <Text style={[profileStyles.profileName, { color: colors.text }]}>
        {[profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || profile.phone_number}
      </Text>

      <View style={[profileStyles.roleBadge, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[profileStyles.roleBadgeText, { color: colors.textSecondary }]}>
          {profile.role_display || profile.role}
        </Text>
      </View>

      <Notice>{profile.role_display || profile.role} · {profile.phone_number || '—'}</Notice>
      <Notice>Login: {profile.username || '—'}</Notice>
    </View>

    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Shaxsiy ma’lumotlar</Text>
      <Input label="Ism" value={firstName} maxLength={50} editable={!busy} error={save.fields.first_name} onChangeText={value => { setFirstName(value); save.clearField('first_name'); setSaved(false); }} />
      <Input label="Familiya" value={lastName} maxLength={50} editable={!busy} error={save.fields.last_name} onChangeText={value => { setLastName(value); save.clearField('last_name'); setSaved(false); }} />
      <Input label="Email" value={email} keyboardType="email-address" autoCapitalize="none" editable={!busy} error={save.fields.email} onChangeText={value => { setEmail(value); save.clearField('email'); setSaved(false); }} />
      <Input label="Tug‘ilgan sana" placeholder="YYYY-MM-DD" value={birth} maxLength={10} editable={!busy} error={save.fields.date_of_birth} onChangeText={value => { setBirth(value); save.clearField('date_of_birth'); setSaved(false); }} />
      <Input label="Aloqa telefoni" value={phone} keyboardType="phone-pad" editable={!busy} error={save.fields.contact_phone} onChangeText={value => { setPhone(value); save.clearField('contact_phone'); setSaved(false); }} />
      {save.error ? <Notice error>{save.error}</Notice> : null}
      {saved ? <Notice>Profil saqlandi.</Notice> : null}
      <Button title="Profilni saqlash" loading={save.busy} disabled={password.busy || avatarUploading} onPress={saveProfile} />
      <Button title="Profilni qayta yuklash" variant="secondary" disabled={busy} onPress={reload} />
    </View>

    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Parolni o‘zgartirish</Text>
      <Notice>Parol yangilangach eski sessiyalar bekor qilinadi. Yangi parol bilan qayta kiring.</Notice>
      <Input label="Joriy parol" value={oldPassword} secureTextEntry editable={!busy} error={password.fields.old_password} onChangeText={value => { setOldPassword(value); password.clearField('old_password'); }} />
      <Input label="Yangi parol" value={newPassword} secureTextEntry editable={!busy} error={password.fields.new_password} onChangeText={value => { setNewPassword(value); password.clearField('new_password'); }} />
      <Input label="Yangi parolni takrorlang" value={confirmPassword} secureTextEntry editable={!busy} error={password.fields.confirm_password} onChangeText={value => { setConfirmPassword(value); password.clearField('confirm_password'); }} />
      {password.error ? <Notice error>{password.error}</Notice> : null}
      <Button title="Parolni yangilash" loading={password.busy} disabled={save.busy || avatarUploading} onPress={changePassword} />
    </View>
  </>;
}

const profileStyles = StyleSheet.create({
  avatarCard: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 6,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAvatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 2,
  },
  removeAvatarText: {
    fontSize: 12,
    fontWeight: '500',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
