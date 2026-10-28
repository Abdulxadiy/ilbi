import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

/** Keyboard coordinates are absolute; screens can start below safe areas, headers or status banners. */
export function KeyboardRegion({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const [offset, setOffset] = useState(0);
  const measure = useCallback(() => {
    if (Platform.OS === 'web') return;
    container.current?.measureInWindow((_x, y) => {
      if (container.current && Number.isFinite(y)) setOffset(Math.max(0, y));
    });
  }, []);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', measure);
    return () => shown.remove();
  }, [measure]);
  return <View ref={container} collapsable={false} onLayout={measure} style={style}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={offset} style={{ flex: 1 }}>
      {children}
    </KeyboardAvoidingView>
  </View>;
}
