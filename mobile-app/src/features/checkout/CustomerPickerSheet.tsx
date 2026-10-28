import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { ListState } from '../../components/ui/ListState';
import { usePermissions } from '../auth/usePermissions';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, ChevronRight, Plus, Search } from 'lucide-react-native';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { SelectedCustomer } from '../cart/CartContext';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { useApiAction } from '../../hooks/useApiAction';
import { Input } from '../../components/ui/Input';
import { customerBody } from '../customers/model';
import { customerSelection } from '../customers/selection';



interface CustomerPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  selectedCustomerId?: number;
  onSelectCustomer: (customer: SelectedCustomer) => void;
}

const parseCustomer = customerSelection;

export const CustomerPickerSheet: React.FC<CustomerPickerSheetProps> = props => {
  const { user, activeTenant } = useAuth();
  return <CustomerPickerBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} {...props} />;
};
const CustomerPickerBody: React.FC<CustomerPickerSheetProps> = ({
  visible,
  onClose,
  selectedCustomerId,
  onSelectCustomer,
}) => {
  const { colors } = useTheme();
  const { can } = usePermissions(), { user, activeTenant } = useAuth();
  const create = useApiAction('sales.manage_counterparty');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const resource = usePagedResource<SelectedCustomer>(visible ? '/sales/counterparties/?search=' + encodeURIComponent(query) : null, parseCustomer);
  const customers = resource.rows;
  const [selectedId, setSelectedId] = useState<number | undefined>(selectedCustomerId);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const createLoading = create.busy, createError = create.error;

  useEffect(() => {
    // Reset the draft selection when its externally controlled value changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(selectedCustomerId);
  }, [selectedCustomerId]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase() || '')
      .join('');
  };

  const handleCreateCustomer = async () => {
    const newCust = await create.run(async () => {
      const body = customerBody({ name: newName, phone_number: newPhone, note: '', target_tenant_code: '', debt_due_date: '' }, false);
      const scope = captureAuthScope(user?.id, activeTenant?.id); assertAuthScope(scope);
      const selected = customerSelection(await request('/sales/counterparties/', { method: 'POST', body }));
      assertAuthScope(scope); return selected;
    });
    if (newCust) {
      void resource.reload();
      onSelectCustomer(newCust);
      setIsCreating(false);
      setNewName('');
      setNewPhone('');
    }
  };

  const handleConfirmSelection = () => {
    const found = customers.find((c) => c.id === selectedId);
    if (found) {
      onSelectCustomer(found);
    }
  };

  return (
    <BottomSheet scrollable={isCreating} visible={visible} onClose={() => { if (!createLoading) onClose(); }} title="Mijoz tanlash">
      <View style={styles.content}>
        {createError ? <Text style={{ color: colors.danger }}>{createError}</Text> : null}
        {/* Search input */}
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            accessibilityLabel="Mijoz qidirish"
            placeholder="Ism yoki telefon"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>

        {/* Create Customer Toggle Button */}
        {!isCreating ? (
          <TouchableOpacity accessibilityRole="button"
            disabled={!can('sales.manage_counterparty')}
            onPress={() => setIsCreating(true)}
            style={[styles.createBtn, { borderColor: colors.border }]}
          >
            <Plus size={16} color={colors.text} />
            <Text style={[styles.createBtnText, { color: colors.text }]}>Yangi mijoz</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.createForm, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Input accessibilityLabel="Mijoz ismi"
              placeholder="Mijoz ismi"
              placeholderTextColor={colors.textMuted}
              value={newName}
              onChangeText={value => { setNewName(value); create.clearField('name'); }}
              error={create.fields.name} editable={!createLoading}
            />
            <Input accessibilityLabel="+998 90 123 45 67"
              placeholder="+998 90 123 45 67"
              placeholderTextColor={colors.textMuted}
              value={newPhone}
              onChangeText={value => { setNewPhone(value); create.clearField('phone_number'); }}
              keyboardType="phone-pad"
              error={create.fields.phone_number} editable={!createLoading}
            />
            <View style={styles.formActionRow}>
              <Button
                title="Bekor qilish"
                disabled={createLoading}
                variant="secondary"
                size="sm"
                onPress={() => setIsCreating(false)}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                title="Saqlash"
                size="sm"
                loading={createLoading}
                onPress={handleCreateCustomer}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        {/* Customer List */}
        {!isCreating && <FlatList
          data={customers}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          onEndReached={() => { void resource.loadMore(); }}
          ListEmptyComponent={<ListState loading={resource.loading} error={resource.error} empty onRetry={resource.retry} />}
          ListFooterComponent={customers.length ? <><ListState loading={resource.loadingMore} error={resource.error} onRetry={resource.retry} />{resource.hasMore && <Button title="Yana mijozlar" variant="secondary" onPress={() => { void resource.loadMore(); }} />}</> : undefined}
          renderItem={({ item }) => {
            const isSelected = selectedId === item.id;
            return (
              <TouchableOpacity accessibilityRole="button"
                onPress={() => setSelectedId(item.id)}
                style={[
                  styles.customerRow,
                  { borderBottomColor: colors.borderSubtle },
                ]}
              >
                <View
                  style={[
                    styles.initialsCircle,
                    {
                      backgroundColor: isSelected ? colors.primaryAction : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.initialsText,
                      {
                        color: isSelected ? colors.primaryActionText : colors.text,
                      },
                    ]}
                  >
                    {getInitials(item.name)}
                  </Text>
                </View>

                <View style={styles.infoCol}>
                  <Text style={[styles.custName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.custPhone, { color: colors.textSecondary }]}>
                    {item.phoneNumber}
                  </Text>
                  {item.targetTenantId ? <Text style={{ color: colors.textSecondary, fontSize: 12 }}>B2B: {item.targetTenantName || 'Bog‘langan do‘kon'}</Text> : null}
                </View>

                {isSelected ? (
                  <Check size={18} color={colors.text} strokeWidth={2.5} />
                ) : (
                  <ChevronRight size={18} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          }}
        />}

        {/* Confirm Selection Button */}
        <Button
          title="Tanlash"
          size="lg"
          fullWidth
          onPress={handleConfirmSelection}
          style={styles.selectBtn}
        />
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingVertical: spacing.sm,
    maxHeight: 480,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 40,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.size.sm,
    paddingVertical: 0,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  createBtnText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginLeft: spacing.xs,
  },
  createForm: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  createInput: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 38,
    marginBottom: spacing.sm,
    fontSize: typography.size.sm,
  },
  formActionRow: {
    flexDirection: 'row',
  },
  list: {
    maxHeight: 280,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  initialsCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  initialsText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
  },
  infoCol: {
    flex: 1,
  },
  custName: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  custPhone: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  selectBtn: {
    marginTop: spacing.md,
  },
});
