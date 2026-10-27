import * as ImagePicker from 'expo-image-picker';
import { pickImageUpload } from '../src/api/imageUpload';

const asset = { uri: 'file:///selected.jpg', fileName: 'selected.jpg', mimeType: 'image/jpeg', width: 64, height: 64 };
describe('Image selection before authenticated uploads', () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as any);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [asset] });
  });
  test.each(['avatar', 'image'] as const)('sends the selected native file under the real %s field', async field => {
    const assertCurrent = jest.fn(), append = jest.spyOn(FormData.prototype, 'append');
    const body = await pickImageUpload(field, assertCurrent);
    expect(body).toBeInstanceOf(FormData);
    expect(append.mock.calls).toEqual([[field, expect.objectContaining({ uri: asset.uri, name: 'selected.jpg', type: 'image/jpeg' })]]);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true }));
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  });
  test('denied access never opens the selector or creates a request body', async () => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: false } as any);
    await expect(pickImageUpload('avatar', () => {})).rejects.toThrow(/ruxsati/);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
  test('cancellation does not upload', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImageUpload('image', () => {})).resolves.toBeNull();
  });
  test('a malformed selection is rejected', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [] });
    await expect(pickImageUpload('image', () => {})).rejects.toThrow(/ochib/);
  });
  test('a session changed during permission approval cannot open the selector', async () => {
    await expect(pickImageUpload('avatar', () => { throw Error('Session changed'); })).rejects.toThrow('Session changed');
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
  test('a session changed while choosing the image cannot create an upload', async () => {
    let current = true;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockImplementation(async () => {
      current = false;
      return { canceled: false, assets: [asset] };
    });
    await expect(pickImageUpload('image', () => { if (!current) throw Error('Store changed'); })).rejects.toThrow('Store changed');
  });
});
