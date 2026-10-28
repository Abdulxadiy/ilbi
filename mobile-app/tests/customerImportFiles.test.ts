import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { assertAuthScope, request } from '../src/api/client';
import { downloadCustomerTemplate, pickSpreadsheet, releasePickedSpreadsheet, spreadsheetBody } from '../src/features/customers/importFiles';
const mockDelete = jest.fn(), mockWrite = jest.fn(), mockCreate = jest.fn();
const originalReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
let mockSize = 512;
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Paths: { cache: { uri: 'file:///cache/' } }, File: jest.fn(function (...parts: any[]) { return { uri: parts.length === 1 ? parts[0] : 'file:///cache/' + parts[1], exists: true, size: mockSize, delete: mockDelete, write: mockWrite, create: mockCreate }; }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
const picked = (uri = 'file:///cache/DocumentPicker/example.csv', name = 'example.csv') => ({ canceled: false, assets: [{ uri, name, lastModified: 0 }] }) as DocumentPicker.DocumentPickerResult;
beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockSize = 512;
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked());
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(assertAuthScope).mockImplementation(() => {});
  // Deliberately resembles RN Blob: no browser-only arrayBuffer method.
  jest.mocked(request).mockResolvedValue({ size: 3 });
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: jest.fn(function () {
    const reader: { result: ArrayBufferLike; onload: null | (() => void); readAsArrayBuffer: () => void } = { result: new Uint8Array([80, 75, 3]).buffer, onload: null, readAsArrayBuffer: jest.fn(() => { reader.onload?.(); }) };
    return reader as unknown as FileReader;
  }) });
});
afterEach(() => { jest.restoreAllMocks(); if (originalReader) Object.defineProperty(globalThis, 'FileReader', originalReader); else Reflect.deleteProperty(globalThis, 'FileReader'); });
test('uses a single copied system document with actual cache-file size and native multipart URI', async () => {
  const NativeFormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
  jest.spyOn(globalThis, 'FormData').mockImplementation(() => new NativeFormData());
  const file = (await pickSpreadsheet())!;
  expect(file.size).toBe(512); expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: true, multiple: false, base64: false }));
  const body = spreadsheetBody(file);
  expect((body as any).getParts()[0]).toMatchObject({ fieldName: 'file', name: file.name, type: 'text/csv', bytes: expect.any(Function) });
});
test('cancelled selection and outside-cache URIs never delete a user-owned document', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: true, assets: null }).mockResolvedValueOnce(picked('file:///documents/private.csv'));
  expect(await pickSpreadsheet()).toBeNull();
  await expect(pickSpreadsheet()).rejects.toThrow('vaqtinchalik nusxasi');
  await releasePickedSpreadsheet({ uri: 'file:///documents/private.csv', name: 'private.csv', size: 10, mime: 'text/csv' });
  expect(File).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled();
});
test.each([0, 8 * 1024 * 1024 + 1, NaN])('invalid actual file size %s rejects and removes only the copied cache file', async size => {
  mockSize = size; await expect(pickSpreadsheet()).rejects.toThrow('8 MB'); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('unknown extension is rejected; valid copied file can be explicitly released', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce(picked('file:///cache/bad.exe', 'bad.exe')).mockResolvedValueOnce(picked());
  await expect(pickSpreadsheet()).rejects.toThrow('8 MB');
  await releasePickedSpreadsheet((await pickSpreadsheet())!); expect(mockDelete).toHaveBeenCalledTimes(2);
});
test('template uses RN-compatible reader, shares an authenticated local file and keeps it for Android handoff', async () => {
  const message = await downloadCustomerTemplate(1, 2);
  expect(request).toHaveBeenCalledWith('/sales/counterparties/import/template/', { responseType: 'blob' });
  expect(mockWrite).toHaveBeenCalledWith(new Uint8Array([80, 75, 3]));
  expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/ilbi-mijozlar-shablon-.+\.xlsx$/), expect.objectContaining({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  expect(mockDelete).not.toHaveBeenCalled(); expect(message).toContain('Saqlanganini');
});
test('session change while reading blocks file creation/share, and unavailable sharing makes no request', async () => {
  let checks = 0; jest.mocked(assertAuthScope).mockImplementation(() => { if (++checks === 3) throw Error('Session changed'); });
  await expect(downloadCustomerTemplate(1, 2)).rejects.toThrow('Session changed');
  expect(Sharing.shareAsync).not.toHaveBeenCalled(); expect(File).not.toHaveBeenCalled();
  jest.mocked(assertAuthScope).mockImplementation(() => {}); jest.clearAllMocks();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(downloadCustomerTemplate(1, 2)).rejects.toThrow('mavjud emas'); expect(request).not.toHaveBeenCalled();
});
