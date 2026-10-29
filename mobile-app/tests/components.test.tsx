import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { Input } from '../src/components/ui/Input';
import { Toast } from '../src/components/ui/Toast';
import { ScreenHeader } from '../src/components/ui/ScreenHeader';
import { Page } from '../src/components/ui/Page';
import { ThemeProvider } from '../src/theme/ThemeContext';

jest.mock('lucide-react-native', () => { const React = jest.requireActual('react'); const { Text } = jest.requireActual('react-native'); return { ...jest.requireActual('lucide-react-native'), Check: () => React.createElement(Text, {}, 'icon:check'), CircleAlert: () => React.createElement(Text, {}, 'icon:alert'), Info: () => React.createElement(Text, {}, 'icon:info') }; });

describe('Base UI Components', () => {

  test('loading buttons retain their accessible name and prevent duplicate actions', async () => {
    const press = jest.fn();
    const screen = await render(<ThemeProvider><Button title="Saqlash" loading onPress={press} /></ThemeProvider>);
    const button = screen.getByRole('button', { name: 'Saqlash' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(button); expect(press).not.toHaveBeenCalled();
  });
  test('error feedback has an alert and never presents a success icon', async () => {
    const screen = await render(<ThemeProvider><Toast message="Yozish xatosi" type="error" onDismiss={() => {}} /></ThemeProvider>);
    expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.queryByText('icon:check')).toBeNull();
    expect(screen.getByText('icon:alert')).toBeTruthy();
  });
  test('neutral cancellation is informational instead of success', async () => {
    const screen = await render(<ThemeProvider><Toast message="Bekor qilindi" onDismiss={() => {}} /></ThemeProvider>);
    expect(screen.getByText('icon:info')).toBeTruthy(); expect(screen.queryByText('icon:check')).toBeNull();
  });
  test('Button renders title correctly and respects disabled state', async () => {
    const screen = await render(
      <ThemeProvider>
        <Button title="To'lovga o'tish" />
      </ThemeProvider>
    );
    expect(screen.getByText("To'lovga o'tish")).toBeTruthy();
  });

  test('Badge renders label and handles variants', async () => {
    const screen = await render(
      <ThemeProvider>
        <Badge label="Imzolangan" variant="success" />
      </ThemeProvider>
    );
    expect(screen.getByText('Imzolangan')).toBeTruthy();
  });

  test('Input renders with placeholder and label', async () => {
    const screen = await render(
      <ThemeProvider>
        <Input label="Dona narxi" placeholder="0 so'm" />
      </ThemeProvider>
    );
    expect(screen.getByText('Dona narxi')).toBeTruthy();
    expect(screen.getByPlaceholderText("0 so'm")).toBeTruthy();
    expect(screen.getByLabelText('Dona narxi')).toBeTruthy();
  });

  test('Toast displays message when visible', async () => {
    const screen = await render(
      <ThemeProvider>
        <Toast visible={true} message="Narx yangilandi" onDismiss={() => {}} />
      </ThemeProvider>
    );
    expect(screen.getByText('Narx yangilandi')).toBeTruthy();
  });

  test('ScreenHeader renders back arrow with Orqaga accessibility label when onGoBack is provided', async () => {
    const onGoBack = jest.fn();
    const screen = await render(
      <ThemeProvider>
        <ScreenHeader title="Kassa va smena" onGoBack={onGoBack} />
      </ThemeProvider>
    );
    const backBtn = screen.getByLabelText('Orqaga');
    expect(backBtn).toBeTruthy();
    await fireEvent.press(backBtn);
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  test('Page passes onBack to ScreenHeader and renders back arrow', async () => {
    const onBack = jest.fn();
    const screen = await render(
      <ThemeProvider>
        <Page title="Ombor" onBack={onBack}>
          <></>
        </Page>
      </ThemeProvider>
    );
    const backBtn = screen.getByLabelText('Orqaga');
    expect(backBtn).toBeTruthy();
    await fireEvent.press(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
