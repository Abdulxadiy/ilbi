import { pickImageUpload } from '../src/api/imageUpload';
import { spreadsheetBody } from '../src/features/customers/importFiles';
import { File } from 'expo-file-system';
const mockBytes = jest.fn(async () => new Uint8Array([65, 66, 67]));
jest.mock('expo-file-system', () => ({ File: jest.fn(function () { return { bytes: mockBytes }; }), Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const originalForm = Object.getOwnPropertyDescriptor(globalThis, 'FormData')!;
const originalFlag = process.env.EXPO_PUBLIC_USE_RN_FETCH;
const NativeFormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
const { installFormDataPatch } = jest.requireActual('../node_modules/expo/src/winter/FormData');
const { convertFormDataAsync } = jest.requireActual('../node_modules/expo/src/winter/fetch/convertFormData');
installFormDataPatch(NativeFormData);
beforeEach(() => {
  jest.clearAllMocks(); delete process.env.EXPO_PUBLIC_USE_RN_FETCH;
  Object.defineProperty(globalThis, 'FormData', { configurable: true, writable: true, value: NativeFormData });
  const imagePicker = jest.requireMock('expo-image-picker');
  imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  imagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/selected.jpg', fileName: 'selected.jpg', mimeType: 'image/jpeg' }] });
});
afterEach(() => {
  Object.defineProperty(globalThis, 'FormData', originalForm);
  if (originalFlag == null) delete process.env.EXPO_PUBLIC_USE_RN_FETCH; else process.env.EXPO_PUBLIC_USE_RN_FETCH = originalFlag;
});
test.each(['avatar', 'image'] as const)('SDK58 default fetch can actually encode the picked %s bytes', async field => {
  const body = await pickImageUpload(field, () => {});
  const encoded = await convertFormDataAsync(body, 'bounded-test-boundary');
  const text = new TextDecoder().decode(encoded.body);
  expect(text).toContain('name="' + field + '"'); expect(text).toContain('filename="selected.jpg"');
  expect(text).toContain('image/jpeg'); expect(text).toContain('\r\nABC\r\n'); expect(mockBytes).toHaveBeenCalledTimes(1);
  expect(File).toHaveBeenCalledWith('file:///cache/selected.jpg');
});
test('SDK58 default fetch can actually encode the selected spreadsheet bytes', async () => {
  const body = spreadsheetBody({ uri: 'file:///cache/selected.csv', name: 'mijozlar.csv', mime: 'text/csv', size: 3 });
  const encoded = await convertFormDataAsync(body, 'bounded-test-boundary');
  const text = new TextDecoder().decode(encoded.body);
  expect(text).toContain('name="file"'); expect(text).toContain('filename="mijozlar.csv"');
  expect(text).toContain('text/csv'); expect(text).toContain('\r\nABC\r\n'); expect(mockBytes).toHaveBeenCalledTimes(1);
  expect(File).toHaveBeenCalledWith('file:///cache/selected.csv');
});
test.each(['1', 'true'])('documented RN fetch opt-in %s retains the native URI descriptor', async flag => {
  process.env.EXPO_PUBLIC_USE_RN_FETCH = flag;
  const body = spreadsheetBody({ uri: 'file:///cache/selected.csv', name: 'mijozlar.csv', mime: 'text/csv', size: 3 });
  expect((body as any).getParts()[0]).toMatchObject({ fieldName: 'file', uri: 'file:///cache/selected.csv', name: 'mijozlar.csv', type: 'text/csv' });
  expect((body as any).getParts()[0].bytes).toBeUndefined(); expect(mockBytes).not.toHaveBeenCalled();
});
