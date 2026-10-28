import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

/** The approved 3D artwork has alpha: no rectangular image background on either theme. */
export function LoginHero({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const [artwork] = useState(() => new Animated.Value(0));
  const [copy] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    const reveal = (reduced: boolean) => {
      if (!active) return;
      animation?.stop();
      if (reduced) { artwork.setValue(1); copy.setValue(1); return; }
      animation = Animated.stagger(70, [
        Animated.timing(artwork, { toValue: 1, duration: 440, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(copy, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
      ]);
      animation.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(reveal, () => reveal(true));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reveal);
    return () => { active = false; animation?.stop(); subscription.remove(); };
  }, [artwork, copy]);
  return <View style={[styles.header, compact && styles.compact]}>
    <Animated.View style={[styles.artwork, compact && styles.compactArtwork, { opacity: artwork, transform: [{ translateY: artwork.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <Image source={require('../../../assets/login-hero-3d.png')} resizeMode="contain" style={styles.image} accessibilityLabel="ILBI: uch o‘lchamli savdo va do‘kon sahnasi" />
    </Animated.View>
    {!compact ? <Animated.View style={{ width: '100%', opacity: copy, transform: [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }}>
      <Text style={[styles.title, { color: colors.text }]}>Tizimga kirish</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>ILBI — do‘kon va savdoni boshqarish platformasi</Text>
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: { width: '100%', alignItems: 'center', marginBottom: 28 },
  compact: { marginBottom: 16 },
  artwork: { width: '100%', maxWidth: 380, aspectRatio: 1456 / 1080, marginBottom: 14 },
  compactArtwork: { maxWidth: 210, marginBottom: 0 },
  image: { width: '100%', height: '100%' },
  title: { fontSize: 32, lineHeight: 39, fontWeight: '700', letterSpacing: -0.8, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, paddingHorizontal: 4 },
});
