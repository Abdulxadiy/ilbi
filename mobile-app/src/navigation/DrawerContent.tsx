import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePermissions } from '../features/auth/usePermissions';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DrawerContentComponentProps } from 'expo-router/drawer';
import { Archive, BarChart3, Clock, Download, FileText, Home, LifeBuoy, LogOut, Moon, Package, Search, Settings, ShoppingCart, Store, Sun, Tv, User as UserIcon, Users, X } from 'lucide-react-native';
import { useAppNavigation } from './useAppNavigation';
import { IlbiLogo } from '../components/brand/IlbiLogo';
import { useAuth } from '../features/auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/tokens';


export const DrawerContent: React.FC<DrawerContentComponentProps> = ({ navigation }) => {
  const { colors, isDark, mode, setMode } = useTheme();
  const appNavigation = useAppNavigation();
  const { user, activeTenant, logout } = useAuth();

  const [sectionSearch, setSectionSearch] = useState('');
  const { canOpen } = usePermissions();
  const insets = useSafeAreaInsets();

  const menuItems = [
    ...(user?.role === 'platform_admin' ? [{ id: 'admin', label: 'Platforma boshqaruvi', icon: Home, route: 'Admin' }] : []),
    { id: 'bosh', label: 'Bosh sahifa', icon: Home, route: 'Bosh' },
    { id: 'kassa', label: 'Kassa', icon: ShoppingCart, route: 'Savdo' },
    { id: 'tovarlar', label: 'Tovarlar', icon: Package, route: 'Tovar' },
    { id: 'ombor', label: 'Ombor', icon: Archive, drawerRoute: 'Inventory' },
    { id: 'mijozlar', label: 'Mijozlar', icon: Users, drawerRoute: 'Customers' },
    { id: 'qarzlar', label: 'Qarzlar', icon: Clock, route: 'Qarz' },
    { id: 'hujjatlar', label: 'Hujjatlar', icon: FileText, drawerRoute: 'Documents' },
    { id: 'hisobotlar', label: 'Hisobotlar', icon: BarChart3, drawerRoute: 'Reports' },
    { id: 'sync', label: 'Amallar va sinxronlash', icon: Archive, route: 'Sync' },
    { id: 'sozlamalar', label: 'Sozlamalar', icon: Settings, drawerRoute: 'Settings' },
  ];

  const filteredItems = menuItems.filter((item) =>
    canOpen(item.route || item.drawerRoute || '') && item.label.toLowerCase().includes(sectionSearch.toLowerCase())
  );

  const handleNavigate = (item: (typeof menuItems)[0]) => {
    navigation.closeDrawer();
    if (item.route) {
      appNavigation.navigate(item.route);
    } else if (item.drawerRoute) {
      appNavigation.navigate(item.drawerRoute);
    }
  };

  const displayName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username : 'Foydalanuvchi';
  const roleName = user?.role === 'owner' ? "Do'kon egasi" : user?.role === 'staff' ? 'Xodim' : 'Administrator';

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <IlbiLogo height={24} />
        <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Menyuni yopish"
          onPress={() => navigation.closeDrawer()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.closeBtn}
        >
          <X size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        {/* User Card */}
        <View style={styles.userSection}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.surfaceSecondary }]}>
            <UserIcon size={20} color={colors.text} />
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.userRole, { color: colors.textSecondary }]}>{roleName}</Text>
          </View>
        </View>

        {/* Store Selector Button */}
        <TouchableOpacity accessibilityRole="button"
          activeOpacity={0.7}
          onPress={() => { navigation.closeDrawer(); appNavigation.navigate('Stores'); }}
          style={[styles.storeButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        >
          <Store size={18} color={colors.text} />
          <Text style={[styles.storeName, { color: colors.text }]} numberOfLines={1}>
            {activeTenant?.name || "Do'kon tanlanmagan"}
          </Text>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </TouchableOpacity>

        {/* Section Search */}
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Search size={16} color={colors.textMuted} />
          <TextInput accessibilityLabel="Bo'lim qidirish..."
            placeholder="Bo'lim qidirish..."
            placeholderTextColor={colors.textMuted}
            value={sectionSearch}
            onChangeText={setSectionSearch}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {sectionSearch ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Qidiruvni tozalash" onPress={() => setSectionSearch('')}>
              <X size={14} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Navigation Items */}
        <View style={styles.menuList}>
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity accessibilityRole="button"
                key={item.id}
                onPress={() => handleNavigate(item)}
                style={styles.menuItem}
              >
                <View style={styles.menuIconContainer}>
                  <Icon size={19} color={colors.text} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Logout Action */}
        <TouchableOpacity accessibilityRole="button" onPress={logout} style={styles.logoutButton}>
          <LogOut size={18} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>Chiqish</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom Theme Selector (Ko'rinish: Tizim, Kunduz, Tun) */}
      <View style={[styles.themeFooter, { borderTopColor: colors.borderSubtle, paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Yuklab olish" onPress={() => { navigation.closeDrawer(); appNavigation.navigate('Downloads'); }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          <Download size={19} color={colors.text} /><Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>Yuklab olish</Text>
        </TouchableOpacity>
        {canOpen('Support') ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Qo‘llab-quvvatlash" onPress={() => { navigation.closeDrawer(); appNavigation.navigate('Support'); }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 8 }}>
          <LifeBuoy size={19} color={colors.text} /><Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>Qo‘llab-quvvatlash</Text>
        </TouchableOpacity> : null}
        <Text style={[styles.themeLabel, { color: colors.textSecondary }]}>Ko&#39;rinish</Text>
        <View style={[styles.themeSegments, { backgroundColor: colors.surfaceSecondary }]}>
          <TouchableOpacity accessibilityRole="button"
            onPress={() => setMode('system')}
            style={[
              styles.themeSegmentBtn,
              mode === 'system' && { backgroundColor: isDark ? '#262626' : '#FFFFFF' },
            ]}
          >
            <Tv size={14} color={mode === 'system' ? colors.text : colors.textMuted} />
            <Text
              style={[
                styles.themeSegmentText,
                { color: mode === 'system' ? colors.text : colors.textMuted },
              ]}
            >
              Tizim
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
            onPress={() => setMode('light')}
            style={[
              styles.themeSegmentBtn,
              mode === 'light' && { backgroundColor: '#FFFFFF' },
            ]}
          >
            <Sun size={14} color={mode === 'light' ? colors.text : colors.textMuted} />
            <Text
              style={[
                styles.themeSegmentText,
                { color: mode === 'light' ? colors.text : colors.textMuted },
              ]}
            >
              Kunduz
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
            onPress={() => setMode('dark')}
            style={[
              styles.themeSegmentBtn,
              mode === 'dark' && { backgroundColor: '#262626' },
            ]}
          >
            <Moon size={14} color={mode === 'dark' ? colors.text : colors.textMuted} />
            <Text
              style={[
                styles.themeSegmentText,
                { color: mode === 'dark' ? colors.text : colors.textMuted },
              ]}
            >
              Tun
            </Text>
          </TouchableOpacity>
        </View>
      </View>


    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  scrollBody: {
    padding: spacing.lg,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  userRole: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  storeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  storeName: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  chevron: {
    fontSize: typography.size.lg,
    marginLeft: spacing.xs,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 38,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.size.sm,
    paddingVertical: 0,
  },
  menuList: {
    marginBottom: spacing.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  menuIconContainer: {
    width: 28,
    alignItems: 'center',
    marginRight: spacing.md,
  },
  menuItemText: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  logoutText: {
    marginLeft: spacing.md,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  themeFooter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
  },
  themeLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginBottom: spacing.xs,
  },
  themeSegments: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
  },
  themeSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  themeSegmentText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginLeft: 4,
  },
  storePickerList: {
    paddingVertical: spacing.md,
  },
  storePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  storePickerItemText: {
    flex: 1,
    marginLeft: spacing.md,
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  activeCheck: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  emptyStores: {
    textAlign: 'center',
    padding: spacing.lg,
  },
});
