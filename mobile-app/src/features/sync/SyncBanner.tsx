import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { outboxManager } from './outbox';

interface SyncBannerProps {
  isOffline?: boolean;
  onSyncComplete?: () => void;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({ isOffline = false, onSyncComplete }) => {
  const { colors, isDark } = useTheme();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [readError, setReadError] = useState(false);

  const checkPending = async () => {
    try {
      const queue = await outboxManager.getQueue();
      setPendingCount(queue.filter(i => i.status !== 'completed').length);
      setReadError(false);
    } catch { setReadError(true); }
  };

  useEffect(() => {
    void Promise.resolve().then(checkPending);
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await outboxManager.processQueue();
      await checkPending();
      onSyncComplete?.();
    } finally {
      setSyncing(false);
    }
  };

  // Only render if explicitly offline or there are pending items queued
  if (!isOffline && pendingCount === 0 && !readError) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#1C1917' : '#F5F4F0',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        },
      ]}
    >
      <View style={styles.leftRow}>
        <View style={styles.iconCircle}>
          <CloudOff size={16} color={isDark ? '#F5F5F4' : '#1C1917'} />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]}>
            {isOffline
              ? "Internet yo'q • Qurilmada saqlanmoqda"
              : (readError ? 'Saqlangan navbatni tekshirish kerak' : `${pendingCount} ta eski amal tekshirishni kutmoqda`)}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Offline yuborish o‘chirilgan. Qoralama va eski amallar saqlanadi.
          </Text>
        </View>
      </View>

      {false && pendingCount > 0 && !isOffline && (
        <TouchableOpacity accessibilityRole="button"
          onPress={handleManualSync}
          disabled={syncing}
          style={[styles.syncButton, { backgroundColor: colors.surface }]}
        >
          <RefreshCw
            size={14}
            color={colors.text}
            style={syncing ? { transform: [{ rotate: '45deg' }] } : undefined}
          />
          <Text style={[styles.syncButtonText, { color: colors.text }]}>
            {syncing ? 'Yuborilmoqda...' : 'Sinxron'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.caption.fontFamily,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: typography.micro.fontSize,
    fontFamily: typography.micro.fontFamily,
    marginTop: 1,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.xs,
  },
  syncButtonText: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.caption.fontFamily,
    fontWeight: '500',
  },
});
