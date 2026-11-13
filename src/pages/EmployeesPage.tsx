import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Shield, Trash2, UserCheck } from 'lucide-react';
import { dbLocal, ROLE_DEFAULT_PERMISSIONS } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency } from '../services/erpEngine';
import { generateUUID, getOrCreateDeviceId } from '../lib/crypto';
import { PERMISSION_LABELS, ROLE_LABELS } from '../lib/permissions';
import type { Employee, PermissionKey, UserRole } from '../types/erp';

export const EmployeesPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [tab, setTab] = useState<'staff' | 'hr' | 'audit' | 'security'>('staff');

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [baseSalary, setBaseSalary] = useState(6000);
  const [commissionRate, setCommissionRate] = useState(1.5);
  const [pinCode, setPinCode] = useState('1111');
  const [active, setActive] = useState(true);
  const [resetRolePermissions, setResetRolePermissions] = useState(false);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => dbLocal.employees.toArray(),
  });
  const { data: attendance = [] } = useQuery({
    queryKey: ['attendance'],
    queryFn: () => dbLocal.attendance.orderBy('date').reverse().toArray(),
  });
  const { data: payroll = [] } = useQuery({
    queryKey: ['payroll'],
    queryFn: () => dbLocal.payroll.orderBy('createdAt').reverse().toArray(),
  });
  const { data: auditLogs = [] } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => dbLocal.auditLogs.orderBy('createdAt').reverse().limit(30).toArray(),
  });
  const { data: loginAttempts = [] } = useQuery({
    queryKey: ['loginAttempts'],
    queryFn: () => dbLocal.loginAttempts.orderBy('createdAt').reverse().limit(30).toArray(),
  });

  const openAddModal = () => {
    setEditingEmp(null);
    setName('');
    setEmail('');
    setPhone('');
    setRole('cashier');
    setBaseSalary(6000);
    setCommissionRate(1.5);
    setPinCode('1111');
    setActive(true);
    setResetRolePermissions(false);
    setFormOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmp(emp);
    setName(emp.name);
    setEmail(emp.email);
    setPhone(emp.phone || '');
    setRole(emp.role);
    setBaseSalary(emp.baseSalary);
    setCommissionRate(emp.commissionRate);
    setPinCode(emp.pinCode);
    setActive(emp.active);
    setResetRolePermissions(false);
    setFormOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify('يرجى إدخال اسم الموظف', 'error');
      return;
    }

    if (editingEmp) {
      const nextPermissions = resetRolePermissions
        ? ROLE_DEFAULT_PERMISSIONS[role]
        : editingEmp.permissions;

      await dbLocal.employees.update(editingEmp.id, {
        name: trimmedName,
        email: email.trim(),
        phone: phone.trim(),
        role,
        permissions: nextPermissions,
        baseSalary: Math.max(0, baseSalary),
        commissionRate: Math.max(0, commissionRate),
        pinCode: pinCode.trim() || '1111',
        active,
      });

      await dbLocal.auditLogs.put({
        id: `aud-${generateUUID().slice(0, 8)}`,
        actorId: currentEmployee?.id || 'emp-admin',
        actorName: currentEmployee?.name || 'النظام',
        action: 'تعديل موظف',
        module: 'الموظفين',
        details: `تم تعديل بيانات الموظف: ${trimmedName} (${ROLE_LABELS[role]})`,
        deviceId: getOrCreateDeviceId(),
        createdAt: new Date().toISOString(),
      });

      setFormOpen(false);
      setEditingEmp(null);
      await refreshAll();
      notify(`تم تعديل بيانات الموظف "${trimmedName}" بنجاح`, 'success');
      return;
    }

    const emp: Employee = {
      id: `emp-${generateUUID().slice(0, 8)}`,
      name: trimmedName,
      email: email.trim(),
      phone: phone.trim(),
      role,
      permissions: ROLE_DEFAULT_PERMISSIONS[role],
      baseSalary: Math.max(0, baseSalary),
      commissionRate: Math.max(0, commissionRate),
      pinCode: pinCode.trim() || '1111',
      deviceId: getOrCreateDeviceId(),
      active,
      createdAt: new Date().toISOString(),
    };
    await dbLocal.employees.put(emp);
    await dbLocal.auditLogs.put({
      id: `aud-${generateUUID().slice(0, 8)}`,
      actorId: currentEmployee?.id || 'emp-admin',
      actorName: currentEmployee?.name || 'النظام',
      action: 'إضافة موظف',
      module: 'الموظفين',
      details: `تمت إضافة الموظف: ${trimmedName} (${ROLE_LABELS[role]})`,
      deviceId: getOrCreateDeviceId(),
      createdAt: new Date().toISOString(),
    });

    setFormOpen(false);
    await refreshAll();
    notify('تمت إضافة الموظف وتعيين صلاحياته بنجاح', 'success');
  };

  const requestDeleteEmployee = (emp: Employee) => {
    if (employees.length <= 1) {
      notify('لا يمكن حذف آخر موظف في النظام', 'error');
      return;
    }
    if (emp.id === currentEmployee?.id) {
      notify('لا يمكن حذف الموظف النشط حالياً — بدّل إلى موظف آخر أولاً', 'error');
      return;
    }
    setDeleteTarget(emp);
  };

  const confirmDeleteEmployee = async () => {
    if (!deleteTarget) return;
    await dbLocal.employees.delete(deleteTarget.id);
    await dbLocal.auditLogs.put({
      id: `aud-${generateUUID().slice(0, 8)}`,
      actorId: currentEmployee?.id || 'emp-admin',
      actorName: currentEmployee?.name || 'النظام',
      action: 'حذف موظف',
      module: 'الموظفين',
      details: `تم حذف الموظف: ${deleteTarget.name} (${ROLE_LABELS[deleteTarget.role]})`,
      deviceId: getOrCreateDeviceId(),
      createdAt: new Date().toISOString(),
    });
    const deletedName = deleteTarget.name;
    setDeleteTarget(null);
    await refreshAll();
    notify(`تم حذف الموظف "${deletedName}" بنجاح`, 'info');
  };

  const togglePermission = async (emp: Employee, perm: PermissionKey) => {
    const has = emp.permissions.includes(perm);
    const next = has ? emp.permissions.filter((p) => p !== perm) : [...emp.permissions, perm];
    await dbLocal.employees.update(emp.id, { permissions: next });
    await refreshAll();
  };

  const handleCheckIn = async (emp: Employee) => {
    const now = new Date();
    await dbLocal.attendance.put({
      id: `att-${generateUUID().slice(0, 8)}`,
      employeeId: emp.id,
      employeeName: emp.name,
      date: now.toISOString().slice(0, 10),
      checkIn: now.toTimeString().slice(0, 5),
      hoursWorked: 8,
    });
    await refreshAll();
    notify(`تم تسجيل حضور ${emp.name}`, 'success');
  };

  const handleGeneratePayroll = async (emp: Employee) => {
    const commissions = emp.commissionRate > 0 ? 450 : 0;
    const bonuses = 250;
    const advances = 0;
    const deductions = 0;
    const netSalary = emp.baseSalary + commissions + bonuses - advances - deductions;
    await dbLocal.payroll.put({
      id: `pay-${generateUUID().slice(0, 8)}`,
      employeeId: emp.id,
      employeeName: emp.name,
      month: new Date().toISOString().slice(0, 7),
      baseSalary: emp.baseSalary,
      commissions,
      bonuses,
      advances,
      deductions,
      netSalary,
      paid: true,
      createdAt: new Date().toISOString(),
    });
    await refreshAll();
    notify(`تم صرف راتب ${emp.name}: ${formatCurrency(netSalary)}`, 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl">
          {([
            { id: 'staff', label: 'الموظفين والصلاحيات (RBAC)' },
            { id: 'hr', label: 'الحضور والرواتب والعمولات (HR)' },
            { id: 'audit', label: 'سجل النشاط (Audit Log)' },
            { id: 'security', label: 'الأجهزة ومحاولات الدخول' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 px-4 py-2 text-xs font-bold text-white whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة موظف</span>
        </button>
      </div>

      {tab === 'staff' && (
        <div className="space-y-3">
          {employees.map((emp) => (
            <div key={emp.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#0B1F3A] text-white flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm flex flex-wrap items-center gap-2">
                      <span>{emp.name}</span>
                      {emp.id === currentEmployee?.id && (
                        <span className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">
                          (النشط حالياً)
                        </span>
                      )}
                      {!emp.active && (
                        <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                          (موقوف)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {ROLE_LABELS[emp.role]} · الراتب: {formatCurrency(emp.baseSalary, cur, 0)} · PIN:{' '}
                      <span className="font-mono">{emp.pinCode}</span>
                      {emp.phone ? ` · ${emp.phone}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(emp)}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5 text-teal-600" />
                    <span>تعديل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDeleteEmployee(emp)}
                    className="flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PERMISSION_LABELS.map(({ key: perm, label }) => {
                  const activePerm = emp.permissions.includes(perm);
                  return (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => togglePermission(emp, perm)}
                      title={perm}
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                        activePerm
                          ? 'bg-teal-600 text-white border-teal-600 font-semibold'
                          : 'border-slate-300 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'hr' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {employees.map((emp) => (
              <div key={emp.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-teal-600" />
                    <span>{emp.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(emp)}
                      title="تعديل بيانات الموظف"
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Pencil className="w-3.5 h-3.5 text-teal-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDeleteEmployee(emp)}
                      title="حذف الموظف"
                      className="p-1.5 rounded border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-slate-500">الراتب الأساسي: {formatCurrency(emp.baseSalary, cur, dec)}</div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => handleCheckIn(emp)} className="flex-1 rounded-lg border py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">
                    تسجيل حضور
                  </button>
                  <button type="button" onClick={() => handleGeneratePayroll(emp)} className="flex-1 rounded-lg bg-[#0B1F3A] text-white py-1.5 font-semibold">
                    صرف راتب الشهر
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-bold mb-2">سجل الحضور والانصراف وساعات العمل</h3>
              {attendance.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">لم يُسجل حضور اليوم بعد.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {attendance.map((a) => (
                    <div key={a.id} className="py-2 flex justify-between">
                      <span className="font-semibold">{a.employeeName}</span>
                      <span className="font-mono text-slate-500">{a.date} · {a.checkIn} ({a.hoursWorked} س)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-bold mb-2">مسير الرواتب والعمولات والحوافز</h3>
              {payroll.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">لم تُصرف رواتب هذا الشهر بعد.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {payroll.map((p) => (
                    <div key={p.id} className="py-2 flex justify-between">
                      <span>{p.employeeName} ({p.month})</span>
                      <span className="font-mono font-bold text-teal-600">{formatCurrency(p.netSalary, cur, dec)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">الوقت</th>
                <th className="py-3 px-3">الموظف</th>
                <th className="py-3 px-3">القسم</th>
                <th className="py-3 px-3">الإجراء</th>
                <th className="py-3 px-4">التفاصيل والجهاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {auditLogs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 px-4 font-mono text-slate-500">{new Date(l.createdAt).toLocaleString('ar-EG')}</td>
                  <td className="py-2 px-3 font-semibold">{l.actorName}</td>
                  <td className="py-2 px-3">{l.module}</td>
                  <td className="py-2 px-3 font-bold">{l.action}</td>
                  <td className="py-2 px-4 text-slate-500">{l.details} · <span className="font-mono">{l.deviceId}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'security' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">الوقت</th>
                <th className="py-3 px-3">المستخدم</th>
                <th className="py-3 px-3">معرف الجهاز</th>
                <th className="py-3 px-3">الحالة</th>
                <th className="py-3 px-4">السبب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loginAttempts.map((la) => (
                <tr key={la.id}>
                  <td className="py-2 px-4 font-mono text-slate-500">{new Date(la.createdAt).toLocaleString('ar-EG')}</td>
                  <td className="py-2 px-3 font-mono">{la.identifier}</td>
                  <td className="py-2 px-3 font-mono">{la.deviceId}</td>
                  <td className={`py-2 px-3 font-bold ${la.success ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {la.success ? 'ناجح' : 'مرفوض'}
                  </td>
                  <td className="py-2 px-4">{la.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleSaveEmployee} className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold text-[#0B1F3A] dark:text-white">
              {editingEmp ? `تعديل بيانات الموظف: ${editingEmp.name}` : 'إضافة موظف جديد'}
            </h3>
            <label className="block">
              <span className="block font-semibold mb-1">الاسم الكامل</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم الكامل"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block font-semibold mb-1">البريد الإلكتروني</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="block font-semibold mb-1">رقم الهاتف</span>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                />
              </label>
            </div>
            <label className="block">
              <span className="block font-semibold mb-1">الدور الوظيفي</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
              >
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block font-semibold mb-1">الراتب</span>
                <input
                  type="number"
                  min={0}
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                />
              </label>
              <label className="block">
                <span className="block font-semibold mb-1">العمولة %</span>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                />
              </label>
              <label className="block">
                <span className="block font-semibold mb-1">رمز PIN</span>
                <input
                  type="text"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                />
              </label>
            </div>
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <span>حساب الموظف نشط</span>
              </label>
              {editingEmp && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetRolePermissions}
                    onChange={(e) => setResetRolePermissions(e.target.checked)}
                    className="rounded text-teal-600"
                  />
                  <span>تطبيق الصلاحيات الافتراضية للدور الوظيفي المختار</span>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditingEmp(null);
                }}
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg"
              >
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg">
                {editingEmp ? 'حفظ التعديلات' : 'إضافة الموظف'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  تأكيد حذف الموظف
                </h3>
                <p className="text-slate-500 mt-0.5">
                  هل أنت متأكد من حذف <strong>{deleteTarget.name}</strong> ({ROLE_LABELS[deleteTarget.role]})؟
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg font-semibold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmDeleteEmployee}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
