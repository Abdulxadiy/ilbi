import { File } from 'expo-file-system';
type LocalUpload = { uri: string; name: string; type: string };
/** SDK58's default expo/fetch encodes bytes-capable files, not RN URI descriptors. */
export function appendLocalUpload(body: FormData, field: string, asset: LocalUpload) {
  const useRnFetch = process.env.EXPO_PUBLIC_USE_RN_FETCH === '1' || process.env.EXPO_PUBLIC_USE_RN_FETCH === 'true';
  if (useRnFetch) { body.append(field, asset as unknown as Blob); return; }
  const file = new File(asset.uri);
  // Retain the provider's filename/MIME without mutating File's readonly metadata.
  body.append(field, { name: asset.name, type: asset.type, bytes: () => file.bytes() } as unknown as Blob);
}
