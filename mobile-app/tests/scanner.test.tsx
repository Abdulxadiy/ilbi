import React from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { BarcodeScanner } from '../src/features/scanner/BarcodeScanner';
import { ThemeProvider } from '../src/theme/ThemeContext';
import * as Linking from 'expo-linking';
const mockAsk = jest.fn(), mockGet = jest.fn();
let mockPermission = { granted: true, canAskAgain: true };
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react'), { View } = jest.requireActual('react-native');
  return { CameraView: (props: any) => React.createElement(View, { ...props, testID: 'scan-camera' }), useCameraPermissions: () => [mockPermission, mockAsk, mockGet] };
});
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]) }));
jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));
let notify: (state: AppStateStatus) => void;
const remove = jest.fn();
const show = (onCode = jest.fn(), onClose = jest.fn()) => render(<ThemeProvider><BarcodeScanner onCode={onCode} onClose={onClose} /></ThemeProvider>);
describe('Camera barcode boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockPermission = { granted: true, canAskAgain: true };
    mockAsk.mockResolvedValue(mockPermission); mockGet.mockResolvedValue(mockPermission);
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { notify = callback; return { remove }; });
  });
  afterEach(() => jest.restoreAllMocks());
  test('one scan frame is accepted once and preserves the complete code, including zeroes', async () => {
    const code = jest.fn(), close = jest.fn(), screen = await show(code, close), camera = screen.getByTestId('scan-camera');
    await fireEvent(camera, 'barcodeScanned', { data: '0000123456789', type: 'ean13' });
    await fireEvent(camera, 'barcodeScanned', { data: '0000123456789', type: 'ean13' });
    expect(code).toHaveBeenCalledTimes(1); expect(code).toHaveBeenCalledWith('0000123456789'); expect(close).toHaveBeenCalledTimes(1);
  });
  test('denied permission retains manual lookup without mounting a camera', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    const close = jest.fn(), screen = await show(jest.fn(), close);
    expect(screen.queryByTestId('scan-camera')).toBeNull();
    await fireEvent.press(screen.getByText('Kameraga ruxsat berish')); expect(mockAsk).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Kodni qo‘lda kiritish')); expect(close).toHaveBeenCalledTimes(1);
  });
  test('permanently denied permission opens settings and exposes a failed settings launch', async () => {
    mockPermission = { granted: false, canAskAgain: false };
    jest.mocked(Linking.openSettings).mockRejectedValueOnce(Error('Unavailable'));
    const screen = await show();
    await fireEvent.press(screen.getByText('Kamera ruxsatini sozlamalarda ochish'));
    expect(await screen.findByText(/Sozlamalar ochilmadi/)).toBeTruthy(); expect(mockAsk).not.toHaveBeenCalled();
  });
  test('backgrounding unmounts the camera and foreground return checks permission before use', async () => {
    const screen = await show(); expect(screen.getByTestId('scan-camera')).toBeTruthy();
    await act(async () => notify('background')); expect(screen.queryByTestId('scan-camera')).toBeNull();
    await act(async () => notify('active')); expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('scan-camera')).toBeTruthy();
    await screen.unmount(); expect(remove).toHaveBeenCalledTimes(1);
  });
  test('a queued frame arriving in the same background event cannot resolve a code', async () => {
    const code = jest.fn(), screen = await show(code), previousFrame = screen.getByTestId('scan-camera').props.onBarcodeScanned;
    await act(async () => { notify('background'); previousFrame({ data: '4780000000123' }); });
    expect(code).not.toHaveBeenCalled();
  });
  test('camera startup failure is visible and supports retry instead of pretending a code was read', async () => {
    const code = jest.fn(), screen = await show(code);
    await fireEvent(screen.getByTestId('scan-camera'), 'mountError', { message: 'Device camera unavailable' });
    expect(screen.queryByTestId('scan-camera')).toBeNull(); expect(screen.getByText('Device camera unavailable')).toBeTruthy(); expect(code).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Kamerani qayta tekshirish')); expect(screen.getByTestId('scan-camera')).toBeTruthy();
  });
  test('an invalid code is not accepted', async () => {
    const code = jest.fn(), screen = await show(code);
    await fireEvent(screen.getByTestId('scan-camera'), 'barcodeScanned', { data: 'bad\ncode' });
    expect(code).not.toHaveBeenCalled(); expect(screen.getByText(/Kod o‘qilmadi/)).toBeTruthy();
  });
});
