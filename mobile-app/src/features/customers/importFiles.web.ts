import * as DocumentPicker from 'expo-document-picker';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { IMPORT_MAX_BYTES } from './importModel';
export type PickedSpreadsheet = { name: string; size: number; uri: string; mime: string; file: File };
export async function pickSpreadsheet(): Promise<PickedSpreadsheet | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '.xlsx,.csv', multiple: false, base64: false });
  if (result.canceled) return null;
  const asset = result.assets[0], file = asset?.file;
  if (!file || !/\.(xlsx|csv)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > IMPORT_MAX_BYTES) {
    if (asset?.uri?.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
    throw Error('8 MB gacha bo‘lgan .xlsx yoki .csv faylni tanlang.');
  }
  return { name: file.name, size: file.size, uri: asset.uri, mime: file.type, file };
}
export function spreadsheetBody(value: PickedSpreadsheet) { const body = new FormData(); body.append('file', value.file, value.name); return body; }
export async function releasePickedSpreadsheet(file: PickedSpreadsheet) { if (file.uri.startsWith('blob:')) URL.revokeObjectURL(file.uri); }
export async function downloadCustomerTemplate(userId: number, tenantId: number) {
  const scope = captureAuthScope(userId, tenantId); assertAuthScope(scope);
  const blob = await request<Blob>('/sales/counterparties/import/template/', { responseType: 'blob' }); assertAuthScope(scope);
  if (blob.size < 1 || blob.size > IMPORT_MAX_BYTES) throw Error('Server shablon faylini tasdiqlamadi.');
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'ilbi-mijozlar-shablon.xlsx'; document.body.appendChild(anchor);
  try { assertAuthScope(scope); anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  return 'Shablonni yuklash boshlandi. Saqlanganini brauzer yuklamalaridan tekshiring.';
}
