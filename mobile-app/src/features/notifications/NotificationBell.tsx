import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useNotifications } from './NotificationsContext';

export function NotificationBell() {
  const { unreadCount } = useNotifications(), { colors } = useTheme(), navigation = useAppNavigation();
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={unreadCount ? `Bildirishnomalar: ${unreadCount} ta o‘qilmagan` : 'Bildirishnomalar'} onPress={() => navigation.navigate('Notifications')} style={styles.button}>
    <Bell size={21} color={colors.text} />
    {unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.danger }]}><Text style={styles.count}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View>}
  </TouchableOpacity>;
}
const styles = StyleSheet.create({ button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', top: 1, right: 0, minWidth: 17, borderRadius: 10, paddingHorizontal: 3, alignItems: 'center' }, count: { color: '#fff', fontSize: 10, lineHeight: 17, fontWeight: '700' } });
