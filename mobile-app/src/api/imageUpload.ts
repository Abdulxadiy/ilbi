import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/** Keep the system picker and its eventual upload bound to the initiating account/store. */
export async function pickImageUpload(field: 'avatar' | 'image', assertCurrent: () => void): Promise<FormData | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  assertCurrent();
  if (!permission.granted) throw Error('Galereyaga kirish ruxsati berilmadi.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8,
  });
  assertCurrent();
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw Error('Tanlangan rasmni ochib bo‘lmadi. Qayta tanlang.');
  const body = new FormData();
  if (Platform.OS === 'web') {
    if (!asset.file) throw Error('Tanlangan rasm faylini ochib bo‘lmadi. Qayta tanlang.');
    body.append(field, asset.file, asset.fileName || 'image.jpg');
  } else {
    body.append(field, { uri: asset.uri, name: asset.fileName || 'image.jpg', type: asset.mimeType || 'image/jpeg' } as any);
  }
  return body;
}
