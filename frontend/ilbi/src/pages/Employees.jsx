import IlbiLoader from '../components/common/IlbiLoader';
import RemoteTenantSelect from '../components/common/RemoteTenantSelect';
import React, { useEffect, useState } from 'react';
import { Search, UserPlus, UserX, Users, Mail, Pencil, Ban, ShieldCheck, Trash2, RotateCcw, KeyRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { tenantApi } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import Modal from '../components/common/Modal';
import CustomSelect from '../components/common/CustomSelect';
import PhoneInput from '../components/common/PhoneInput';
import EmployeePermissionsSelector from '../components/employees/EmployeePermissionsSelector';
import IdentityRecoveryModal from '../components/common/IdentityRecoveryModal';

const PAGE_SIZE = 50;

function employeeName(employee) {
  return [employee.first_name, employee.last_name].filter(Boolean).join(' ')
    || employee.username || employee.phone_number || 'Xodim #' + employee.id;
}

function employeeStatus(employee) {
  if (employee.archived_at) return { label: 'O‘chirilgan', color: 'var(--text-muted)' };
  if (!employee.is_active) return { label: 'Ishdan bo‘shatilgan', color: 'var(--text-muted)' };
  if (!employee.account_active) return { label: 'Bloklangan', color: 'var(--accent-rose)' };
  if (!employee.password_set) return { label: 'Faollashmagan', color: 'var(--accent-amber)' };
  return { label: 'Faol', color: 'var(--accent-emerald)' };
}

export default function Employees() {
  const { isAdmin } = useAuth();
  const { activeTenant } = useTenant();
  const [searchParams] = useSearchParams();
  const requestedTenantId = Number(searchParams.get('tenant_id'));
  const toast = useToast();
  const confirm = useConfirm();

  const [permissionChoices, setPermissionChoices] = useState([]);
  const [adminTenantId, setAdminTenantId] = useState(requestedTenantId > 0 ? requestedTenantId : null);
  const selectedTenantId = isAdmin ? adminTenantId : (activeTenant?.id ?? null);
  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('true');
  const [pageState, setPageState] = useState({ tenantId: null, page: 1 });
  const [reloadVersion, setReloadVersion] = useState(0);
  const page = pageState.tenantId === selectedTenantId ? pageState.page : 1;
  const requestKey = [selectedTenantId, page, statusFilter, search, reloadVersion].join(':');
  const [loadedKey, setLoadedKey] = useState('');
  const setPage = (next) => setPageState((previous) => {
    const currentPage = previous.tenantId === selectedTenantId ? previous.page : 1;
    return {
      tenantId: selectedTenantId,
      page: typeof next === 'function' ? next(currentPage) : next,
    };
  });
  const [hireModalOpen, setHireModalOpen] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', contact_phone: '', position: '' });
  const [editing, setEditing] = useState(false);
  const [identityUser, setIdentityUser] = useState(null);
  const [accountAction, setAccountAction] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [hireForm, setHireForm] = useState({
    phone_number: '', email: '', position: 'Kassir', first_name: '', last_name: '', permission_ids: [],
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPageState({ tenantId: selectedTenantId, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId) {
      return undefined;
    }
    let cancelled = false;
    async function loadEmployees() {
      setLoading(true);
      setListError('');
      setEmployees([]);
      try {
        const response = await tenantApi.getEmployees(selectedTenantId, {
          page, page_size: PAGE_SIZE,
          active: statusFilter === 'archived' ? 'all' : statusFilter,
          archived: statusFilter === 'archived' ? 'true' : 'false',
          ...(search ? { search } : {}),
        });
        if (cancelled) return;
        const rows = Array.isArray(response) ? response : response.results || [];
        setEmployees(rows);
        setTotal(Array.isArray(response) ? rows.length : response.count || 0);
        setLoadedKey(requestKey);
      } catch (error) {
        if (cancelled) return;
        setTotal(0);
        setListError(error.message || 'Xodimlarni yuklab bo‘lmadi.');
        setLoadedKey(requestKey);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadEmployees();
    return () => { cancelled = true; };
  }, [selectedTenantId, page, statusFilter, search, reloadVersion, requestKey]);

  useEffect(() => {
    if (!selectedTenantId) return undefined;
    let cancelled = false;
    tenantApi.getEmployeePermissions(selectedTenantId).then((choices) => {
      if (!cancelled) setPermissionChoices(choices);
    }).catch((error) => { if (!cancelled) toast.error(error.message); });
    return () => { cancelled = true; };
  }, [selectedTenantId, toast]);

  const refreshList = () => setReloadVersion((version) => version + 1);

  const handleInvite = async (employee) => {
    setActionLoadingId(employee.id);
    try {
      const result = await tenantApi.resendEmployeeInvite(selectedTenantId, employee.id);
      toast.success(result.detail || 'Emailga havola yuborildi.');
      refreshList();
    } catch (error) {
      if (error.status === 429) toast.warning(error.message);
      else toast.error(error.message || 'Email yuborilmadi.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const openEdit = (employee) => {
    setEditTarget({ employee, tenantId: selectedTenantId });
    setEditForm({
      first_name: employee.first_name || '', last_name: employee.last_name || '',
      email: employee.email || '', contact_phone: employee.contact_phone || '', position: employee.position || '', permission_ids: employee.permission_ids || [],
    });
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editTarget) return;
    setEditing(true);
    try {
      await tenantApi.updateEmployee(editTarget.tenantId, editTarget.employee.id, editForm);
      toast.success('Hisob ma’lumotlari saqlandi.');
      setEditTarget(null);
      refreshList();
    } catch (error) {
      toast.error(error.message || 'Tahrirni saqlab bo‘lmadi.');
    } finally {
      setEditing(false);
    }
  };

  const openAccountAction = (employee, type) => {
    setAccountAction({ employee, type, tenantId: selectedTenantId });
    setActionReason('');
  };

  const handleAccountAction = async (event) => {
    event.preventDefault();
    if (!accountAction || !actionReason.trim()) return;
    setActionSubmitting(true);
    const { employee, type, tenantId } = accountAction;
    try {
      if (type === 'archive') await tenantApi.archiveEmployee(tenantId, employee.id, actionReason.trim());
      else if (type === 'restore') await tenantApi.restoreEmployee(tenantId, employee.id, actionReason.trim());
      else await tenantApi.setEmployeeBlocked(tenantId, employee.id, type === 'block', actionReason.trim());
      toast.success(type === 'archive' ? 'Xodim o‘chirildi; tarix saqlandi.' : type === 'restore' ? 'Yozuv tiklandi. Ishga qayta olish alohida bajariladi.' : type === 'block' ? 'Hisob bloklandi.' : 'Hisob blokdan chiqarildi.');
      setAccountAction(null);
      if (type === 'restore') { setStatusFilter('false'); setPage(1); }
      refreshList();
    } catch (error) {
      toast.error(error.message || 'Amalni bajarib bo‘lmadi.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleHireSubmit = async (event) => {
    event.preventDefault();
    if (!selectedTenantId) return;
    setHiring(true);
    try {
      const result = await tenantApi.hireEmployee(selectedTenantId, {
        phone_number: hireForm.phone_number.trim(),
        email: hireForm.email.trim(),
        position: hireForm.position.trim(),
        first_name: hireForm.first_name.trim(),
        last_name: hireForm.last_name.trim(),
        permission_ids: hireForm.permission_ids || [],
      });
      if (result.onboarding_invitation?.sent) {
        toast.success('Xodim qo‘shildi va faollashtirish havolasi yuborildi.');
      } else if (result.onboarding_invitation?.reason === 'existing_account') {
        toast.success('Mavjud hisob xodim sifatida qo‘shildi.');
      } else {
        toast.warning('Xodim qo‘shildi, lekin faollashtirish xabari yuborilmadi. Email sozlamasini tekshiring.');
      }
      setHireModalOpen(false);
      setHireForm({ phone_number: '', email: '', position: 'Kassir', first_name: '', last_name: '', permission_ids: [] });
      setStatusFilter('true');
      setSearchInput('');
      setSearch('');
      setPage(1);
      refreshList();
    } catch (error) {
      toast.error(error.message || 'Xodimni ishga olishda xatolik.');
    } finally {
      setHiring(false);
    }
  };

  const handleFireEmployee = async (employee) => {
    const accepted = await confirm({
      title: 'Xodimni ishdan bo‘shatish',
      message: employeeName(employee) + ' ishini tugatmoqchimisiz? Uning tizimga kirish huquqi to‘xtatiladi.',
      confirmText: 'Ishdan bo‘shatish',
      cancelText: 'Bekor qilish',
      type: 'danger',
    });
    if (!accepted) return;
    setActionLoadingId(employee.id);
    try {
      await tenantApi.fireEmployee(selectedTenantId, employee.user);
      toast.success('Xodim ishdan bo‘shatildi.');
      refreshList();
    } catch (error) {
      toast.error(error.message || 'Ishdan bo‘shatishda xatolik.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const isCurrentList = loadedKey === requestKey;
  const visibleEmployees = isCurrentList ? employees : [];
  const visibleTotal = isCurrentList ? total : 0;
  const displayLoading = Boolean(selectedTenantId) && (loading || !isCurrentList);
  const pages = Math.max(1, Math.ceil(visibleTotal / PAGE_SIZE));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Xodimlar va jamoa</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {isAdmin ? 'Tanlangan do‘kon xodimlari va hisoblar holati'
              : (activeTenant?.name || 'Do‘kon') + ' jamoasi va kirish huquqlari'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {isAdmin && (
            <RemoteTenantSelect autoSelect value={adminTenantId || ''}
              onChange={value => { setAdminTenantId(Number(value)); setPage(1); }} />
          )}
          <button className="btn btn-primary" onClick={() => setHireModalOpen(true)} disabled={!selectedTenantId}>
            <UserPlus size={16} /> Xodim qo‘shish
          </button>
        </div>
      </div>


      <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Users size={22} color="var(--primary)" />
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{displayLoading ? 'Yuklanmoqda...' : visibleTotal.toLocaleString('uz-UZ') + ' ta xodim'}</strong>
          {' '}— {statusFilter === 'true' ? 'faol' : statusFilter === 'false' ? 'ishdan bo‘shatilgan' : statusFilter === 'archived' ? 'o‘chirilgan' : 'barcha holatlar'}.
          Yangi xodim email havolasi orqali parol o‘rnatadi, so‘ng Telegram kontaktini ulaydi.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={17} style={{ position: 'absolute', left: 13, top: 13, color: 'var(--text-muted)' }} />
          <input
            aria-label="Xodimlarni qidirish"
            className="input-field"
            placeholder="Ism, telefon, login yoki lavozim bo‘yicha qidiring"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            style={{ paddingLeft: 40, width: '100%' }}
          />
        </div>
        <CustomSelect
          value={statusFilter}
          onChange={(value) => { setStatusFilter(value); setPage(1); }}
          options={[
            { value: 'true', label: 'Faol xodimlar' },
            { value: 'all', label: 'Barcha xodimlar' },
            { value: 'false', label: 'Ishdan bo‘shatilganlar' },
            { value: 'archived', label: 'O‘chirilganlar' },
          ]}
          size="md"
          style={{ minWidth: 205 }}
        />
      </div>

      <div className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
        <div className="table-responsive">
          <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-chip)', color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 20px' }}>Xodim</th>
                <th style={{ padding: '14px 20px' }}>Lavozimi</th>
                <th style={{ padding: '14px 20px' }}>Roli</th>
                <th style={{ padding: '14px 20px' }}>Aloqa</th>
                <th style={{ padding: '14px 20px' }}>Holat</th>
                <th style={{ padding: '14px 20px', textAlign: 'right' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((employee) => {
                const name = employeeName(employee);
                const state = employeeStatus(employee);
                const initials = name.split(' ').slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
                return (
                  <tr key={employee.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary-light)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{initials}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {employee.username || 'Foydalanuvchi'}{isAdmin && ` · User ID: ${employee.user}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13 }}>{employee.position || '—'}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13 }}>{employee.is_owner ? 'Do‘kon egasi' : 'Xodim'}</td>
                    <td style={{ padding: '14px 20px', fontSize: 12 }}>
                      <div>{employee.contact_phone || employee.phone_number || '—'}</div>
                      {employee.email && <div style={{ color: 'var(--text-muted)' }}>{employee.email}</div>}
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 12, fontWeight: 700, color: state.color }}>{state.label}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6, minWidth: 290 }}>
                      {!employee.archived_at && <>
                        <button className="btn btn-secondary" onClick={() => handleInvite(employee)} disabled={actionLoadingId === employee.id || !employee.actions?.invite}
                          title={!employee.email ? 'Avval email kiriting' : !employee.account_active ? 'Avval hisobni blokdan chiqaring' : employee.password_set ? 'Parol/kirish havolasini emailga yuborish' : 'Faollashtirish havolasini emailga yuborish'}>
                          <Mail size={15} /> {actionLoadingId === employee.id ? 'Kutilmoqda...' : 'Emailga yuborish'}
                        </button>
                        <button className="btn btn-secondary" onClick={() => openEdit(employee)} disabled={!employee.actions?.edit || actionLoadingId === employee.id} title="Ma’lumotlarni tahrirlash" aria-label={`${name}: tahrirlash`}><Pencil size={15} /></button>
                        {isAdmin && <button className="btn btn-secondary" title="Login va Telegramni boshqarish" aria-label={`${name}: login va Telegram`} onClick={() => setIdentityUser(employee.user)}><KeyRound size={15} /></button>}
                        <button className="btn btn-secondary" onClick={() => openAccountAction(employee, employee.account_active ? 'block' : 'unblock')} disabled={!employee.actions?.block || actionLoadingId === employee.id}
                          title={employee.account_active ? 'Hisobni bloklash' : 'Hisobni blokdan chiqarish'} aria-label={`${name}: ${employee.account_active ? 'bloklash' : 'blokdan chiqarish'}`}>
                          {employee.account_active ? <Ban size={15} /> : <ShieldCheck size={15} />}
                        </button>
                        <button className="btn btn-secondary" onClick={() => openAccountAction(employee, 'archive')} disabled={!employee.actions?.archive || actionLoadingId === employee.id}
                          style={{ color: 'var(--accent-rose)' }} title={employee.is_owner ? 'Avval Tenants sahifasida egalikni boshqa hisobga o‘tkazing' : 'Xodimni o‘chirish (tarix saqlanadi)'} aria-label={`${name}: o‘chirish`}><Trash2 size={15} /></button>
                      </>}
                      {employee.actions?.restore && <button className="btn btn-secondary" onClick={() => openAccountAction(employee, 'restore')}><RotateCcw size={15} /> Tiklash</button>}
                      {employee.is_active && !employee.is_owner && !employee.archived_at ? (
                        <button className="btn btn-secondary" onClick={() => handleFireEmployee(employee)}
                          disabled={actionLoadingId === employee.id} title="Xodimni ishdan bo‘shatish">
                          <UserX size={15} /> Ishdan bo‘shatish
                        </button>
                      ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!displayLoading && visibleEmployees.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {(isCurrentList && listError) || (selectedTenantId ? 'Bu tanlov bo‘yicha xodim topilmadi.' : 'Avval do‘kon tanlang.')}
                </td></tr>
              )}
              {displayLoading && <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Xodimlar yuklanmoqda..." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || displayLoading}>Oldingi</button>
          <span style={{ fontSize: 13 }}>{page} / {pages}</span>
          <button className="btn btn-secondary" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page >= pages || displayLoading}>Keyingi</button>
        </div>
      )}

      <Modal isOpen={hireModalOpen} onClose={() => setHireModalOpen(false)} title="Xodim ishga olish" maxWidth={680}>
        <form onSubmit={handleHireSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Telefon va email kiriting. Yangi hisobga parol o‘rnatish havolasi email orqali yuboriladi.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Telefon raqami
              <PhoneInput data-api-field="phone_number" className="input-field" name="tel" required value={hireForm.phone_number} onChange={(event) => setHireForm({ ...hireForm, phone_number: event.target.value })} style={{ marginTop: 6, width: '100%' }} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Email
              <input data-api-field="email" className="input-field" type="email" name="email" autoComplete="email" placeholder="xodim@example.com" required value={hireForm.email} onChange={(event) => setHireForm({ ...hireForm, email: event.target.value })} style={{ marginTop: 6, width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Ismi
              <input data-api-field="first_name" className="input-field" type="text" name="given-name" autoComplete="given-name" value={hireForm.first_name} onChange={(event) => setHireForm({ ...hireForm, first_name: event.target.value })} style={{ marginTop: 6, width: '100%' }} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Familiyasi
              <input data-api-field="last_name" className="input-field" type="text" name="family-name" autoComplete="family-name" value={hireForm.last_name} onChange={(event) => setHireForm({ ...hireForm, last_name: event.target.value })} style={{ marginTop: 6, width: '100%' }} />
            </label>
          </div>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Lavozimi
            <input data-api-field="position" className="input-field" type="text" name="organization-title" autoComplete="organization-title" placeholder="Masalan: Kassir" required value={hireForm.position} onChange={(event) => setHireForm({ ...hireForm, position: event.target.value })} style={{ marginTop: 6, width: '100%' }} />
          </label>

          <div style={{ marginTop: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'block', color: 'var(--text-primary)' }}>
              Xodimga beriladigan ruxsatlar va vakolatlar
            </label>
            <EmployeePermissionsSelector
              permissionChoices={permissionChoices}
              selectedIds={hireForm.permission_ids || []}
              currentPosition={hireForm.position}
              onChange={(newIds) => setHireForm((prev) => ({ ...prev, permission_ids: newIds }))}
              onPresetSelect={(preset) => {
                setHireForm((prev) => ({
                  ...prev,
                  position: preset.label,
                  permission_ids: preset.ids,
                }));
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setHireModalOpen(false)}>Bekor qilish</button>
            <button type="submit" className="btn btn-primary" disabled={hiring}>{hiring ? 'Qo‘shilmoqda...' : 'Ishga olish'}</button>
          </div>
        </form>
      </Modal>

      <IdentityRecoveryModal key={identityUser || 'closed'} userId={identityUser} onClose={() => setIdentityUser(null)} onSaved={() => { refreshList(); toast.success('Login va Telegram yangilandi.'); }} />
      <Modal isOpen={Boolean(editTarget)} onClose={() => { if (!editing) setEditTarget(null); }} title="Hisob ma’lumotlarini tahrirlash" maxWidth={680}>
        {editTarget && <form onSubmit={handleEditSubmit} style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {employeeName(editTarget.employee)} · Login raqami: {editTarget.employee.phone_number}
            {editTarget.employee.is_owner && ' · Ism va email egasining barcha do‘konlarida yangilanadi.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Ismi
              <input data-api-field="first_name" className="input-field" maxLength={50} value={editForm.first_name} onChange={(event) => setEditForm({ ...editForm, first_name: event.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Familiyasi
              <input data-api-field="last_name" className="input-field" maxLength={50} value={editForm.last_name} onChange={(event) => setEditForm({ ...editForm, last_name: event.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Email
              <input data-api-field="email" className="input-field" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Aloqa telefon raqami
              <PhoneInput data-api-field="contact_phone" className="input-field" value={editForm.contact_phone} onChange={(event) => setEditForm({ ...editForm, contact_phone: event.target.value })} />
            </label>
          </div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>Email o‘zgarsa, oldingi faollashtirish/parol havolalari bekor qilinadi. Yangi manzilga havolani alohida yuboring.</p>
          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Lavozimi
            <input data-api-field="position" className="input-field" maxLength={100} value={editForm.position} onChange={(event) => setEditForm({ ...editForm, position: event.target.value })} />
          </label>

          {!editTarget.employee.is_owner && (
            <div style={{ marginTop: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'block', color: 'var(--text-primary)' }}>
                Xodim ruxsatlari va vakolatlari
              </label>
              <EmployeePermissionsSelector
                permissionChoices={permissionChoices}
                selectedIds={editForm.permission_ids || []}
                currentPosition={editForm.position}
                onChange={(newIds) => setEditForm((prev) => ({ ...prev, permission_ids: newIds }))}
                onPresetSelect={(preset) => {
                  setEditForm((prev) => ({
                    ...prev,
                    position: preset.label,
                    permission_ids: preset.ids,
                  }));
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" disabled={editing} onClick={() => setEditTarget(null)}>Bekor qilish</button>
            <button type="submit" className="btn btn-primary" disabled={editing}>{editing ? 'Saqlanmoqda...' : 'Saqlash'}</button>
          </div>
        </form>}
      </Modal>

      <Modal isOpen={Boolean(accountAction)} onClose={() => { if (!actionSubmitting) setAccountAction(null); }}
        title={accountAction?.type === 'archive' ? 'Xodimni o‘chirish' : accountAction?.type === 'restore' ? 'Yozuvni tiklash' : accountAction?.type === 'block' ? 'Hisobni bloklash' : 'Hisobni blokdan chiqarish'}>
        {accountAction && <form onSubmit={handleAccountAction} style={{ display: 'grid', gap: 15 }}>
          <strong>{employeeName(accountAction.employee)}</strong>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {accountAction.type === 'archive' ? 'Xodim odatiy ro‘yxatdan olib tashlanadi va shu do‘konga kirish huquqi bekor qilinadi. Savdo hamda audit tarixi saqlanadi.'
              : accountAction.type === 'restore' ? 'Yozuv ishdan bo‘shatilganlar ro‘yxatiga qaytariladi. Kirish huquqi faqat alohida ishga qayta olinganda beriladi.'
              : accountAction.type === 'block' ? `Hisobning tizimga kirishi darhol to‘xtatiladi.${accountAction.employee.is_owner ? ' Bu egaga tegishli barcha do‘konlarga ta’sir qiladi.' : ''}`
              : 'Hisob qayta kirishi mumkin bo‘ladi. Ishdan bo‘shatilgan xodimga bu amal ishga qayta olish huquqini bermaydi.'}
          </p>
          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Sabab
            <textarea className="input-field" rows={3} maxLength={500} value={actionReason} onChange={(event) => setActionReason(event.target.value)} required />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" disabled={actionSubmitting} onClick={() => setAccountAction(null)}>Bekor qilish</button>
            <button type="submit" className="btn btn-primary" disabled={actionSubmitting || !actionReason.trim()}>
              {actionSubmitting ? 'Bajarilmoqda...' : accountAction.type === 'archive' ? 'O‘chirish' : accountAction.type === 'restore' ? 'Tiklash' : accountAction.type === 'block' ? 'Bloklash' : 'Blokdan chiqarish'}
            </button>
          </div>
        </form>}
      </Modal>
    </div>
  );
}
