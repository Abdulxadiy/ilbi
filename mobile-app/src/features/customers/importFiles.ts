import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { appendLocalUpload } from '../../api/localMultipart';
import { IMPORT_MAX_BYTES } from './importModel';
export type PickedSpreadsheet = { name: string; size: number; uri: string; mime: string };
const cacheFile = (uri: string) => uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/') && !uri.includes('/../') && !/%2e|%2f|%5c/i.test(uri);
export async function pickSpreadsheet(): Promise<PickedSpreadsheet | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/comma-separated-values', 'application/csv'], copyToCacheDirectory: true, multiple: false, base64: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || !cacheFile(asset.uri)) throw Error('Faylning vaqtinchalik nusxasi olinmadi. Uni qayta tanlang.');
  const file = new File(asset.uri), size = file.size;
  if (!file.exists || !Number.isSafeInteger(size) || size < 1 || size > IMPORT_MAX_BYTES || !/\.(xlsx|csv)$/i.test(asset.name)) {
    if (file.exists) await file.delete();
    throw Error('8 MB gacha bo‘lgan .xlsx yoki .csv faylni tanlang.');
  }
  return { name: asset.name, size, uri: asset.uri, mime: /\.xlsx$/i.test(asset.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' };
}
export function spreadsheetBody(file: PickedSpreadsheet) {
  if (!cacheFile(file.uri) || !/\.(xlsx|csv)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > IMPORT_MAX_BYTES) throw Error('Tanlangan fayl tasdiqlanmadi.');
  const body = new FormData(); appendLocalUpload(body, 'file', { uri: file.uri, name: file.name, type: file.mime }); return body;
}
export async function releasePickedSpreadsheet(file: PickedSpreadsheet) {
  if (!cacheFile(file.uri)) return;
  try { const cached = new File(file.uri); if (cached.exists) await cached.delete(); } catch { /* OS may already have evicted this private cache copy. */ }
}
export async function downloadCustomerTemplate(userId: number, tenantId: number) {
  const scope = captureAuthScope(userId, tenantId); assertAuthScope(scope);
  if (!await Sharing.isAvailableAsync()) throw Error('Bu qurilmada faylni saqlash/ulashish oynasi mavjud emas.');
  const blob = await request<Blob>('/sales/counterparties/import/template/', { responseType: 'blob' }); assertAuthScope(scope);
  if (blob.size < 1 || blob.size > IMPORT_MAX_BYTES) throw Error('Server shablon faylini tasdiqlamadi.');
  // RN's installed Blob implementation lacks browser Blob.arrayBuffer().
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(Error('Shablon fayli o‘qilmadi.'));
    reader.onerror = () => reject(Error('Shablon fayli o‘qilmadi.'));
    reader.onabort = () => reject(Error('Shablonni o‘qish to‘xtatildi.'));
    reader.readAsArrayBuffer(blob);
  }); assertAuthScope(scope);
  const file = new File(Paths.cache, 'ilbi-mijozlar-shablon-' + Crypto.randomUUID() + '.xlsx');
  let handedOff = false;
  try {
    file.create(); await file.write(bytes); assertAuthScope(scope);
    // Android can resolve the chooser before the receiving app reads its URI.
    // Preserve the private OS-managed cache file after handoff, like receipt PDFs.
    handedOff = true;
    await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Mijozlar shablonini saqlash', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
    assertAuthScope(scope);
  } finally { if (!handedOff && file.exists) await file.delete(); }
  return 'Faylni saqlash/ulashish oynasi yopildi. Saqlanganini tanlangan ilovadan tekshiring.';
}
