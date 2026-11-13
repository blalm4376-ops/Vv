import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Star, Banknote } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processCashboxOperation } from '../services/erpEngine';
import { generateUUID } from '../lib/crypto';
import type { Supplier } from '../types/erp';

export const SuppliersPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [payTarget, setPayTarget] = useState<Supplier | null>(null);
  const [payAmt, setPayAmt] = useState(0);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dbLocal.suppliers.toArray(),
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.name) return;
    const now = new Date().toISOString();
    const doc: Supplier = {
      id: editing.id || `sup-${generateUUID().slice(0, 8)}`,
      name: editing.name,
      phone: editing.phone || '',
      address: editing.address || '',
      taxNumber: editing.taxNumber || '',
      openingBalance: Number(editing.openingBalance || 0),
      totalPurchases: editing.totalPurchases || 0,
      totalPaid: editing.totalPaid || 0,
      balance: editing.id ? Number(editing.balance || 0) : Number(editing.openingBalance || 0),
      rating: Number(editing.rating || 5),
      nextDueDate: editing.nextDueDate,
      createdAt: editing.createdAt || now,
      updatedAt: now,
    };
    await dbLocal.suppliers.put(doc);
    setEditing(null);
    await refreshAll();
    notify('تم حفظ بيانات المورد بنجاح', 'success');
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget || payAmt <= 0) return;
    await processCashboxOperation({
      type: 'payment',
      accountId: 'acc-cash-main',
      amount: payAmt,
      description: `سداد مستحقات المورد ${payTarget.name}`,
      supplierId: payTarget.id,
      userId: currentEmployee?.id || 'emp-admin',
      userName: currentEmployee?.name || 'المحاسب',
    });
    setPayTarget(null);
    setPayAmt(0);
    await refreshAll();
    notify('تم سداد الدفعة للمورد وتحديث كشف الحساب', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">دليل الموردين والمديونيات والتقييم</h2>
          <p className="text-xs text-slate-500">الأرصدة الافتتاحية، الأرقام الضريبية، مواعيد الاستحقاق وسداد الموردين</p>
        </div>
        <button
          onClick={() => setEditing({ rating: 5, openingBalance: 0 })}
          className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مورد</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">المورد</th>
              <th className="py-3 px-3">الرقم الضريبي</th>
              <th className="py-3 px-3">إجمالي المشتريات</th>
              <th className="py-3 px-3">المدفوع</th>
              <th className="py-3 px-3">المستحق للمورد</th>
              <th className="py-3 px-3">التقييم</th>
              <th className="py-3 px-4 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td className="py-2.5 px-4">
                  <div className="font-bold">{s.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{s.phone} · {s.address}</div>
                </td>
                <td className="py-2.5 px-3 font-mono">{s.taxNumber || '—'}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(s.totalPurchases, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums text-emerald-600">{formatCurrency(s.totalPaid, cur, dec)}</td>
                <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${s.balance > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                  {formatCurrency(s.balance, cur, dec)}
                </td>
                <td className="py-2.5 px-3">
                  <span className="inline-flex items-center gap-1 text-amber-500 font-mono font-bold">
                    <Star className="w-3.5 h-3.5 fill-amber-500" />
                    {s.rating}/5
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center justify-end gap-2">
                    {s.balance > 0 && (
                      <button
                        onClick={() => {
                          setPayTarget(s);
                          setPayAmt(s.balance);
                        }}
                        className="flex items-center gap-1 rounded bg-teal-600 text-white px-2.5 py-1 font-semibold"
                      >
                        <Banknote className="w-3 h-3" />
                        <span>سداد</span>
                      </button>
                    )}
                    <button onClick={() => setEditing(s)} className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-semibold">
                      تعديل
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleSave} className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold">{editing.id ? 'تعديل مورد' : 'مورد جديد'}</h3>
            <input type="text" required value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="اسم المورد *" className="w-full rounded-lg border px-3 py-2" />
            <input type="text" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="الهاتف" className="w-full rounded-lg border px-3 py-2" />
            <input type="text" value={editing.taxNumber || ''} onChange={(e) => setEditing({ ...editing, taxNumber: e.target.value })} placeholder="الرقم الضريبي" className="w-full rounded-lg border px-3 py-2 font-mono" />
            <input type="number" min={1} max={5} value={editing.rating ?? 5} onChange={(e) => setEditing({ ...editing, rating: Number(e.target.value) })} placeholder="التقييم 1-5" className="w-full rounded-lg border px-3 py-2 font-mono" />
            {!editing.id && (
              <input type="number" value={editing.openingBalance ?? 0} onChange={(e) => setEditing({ ...editing, openingBalance: Number(e.target.value) })} placeholder="الرصيد الافتتاحي" className="w-full rounded-lg border px-3 py-2 font-mono" />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 border rounded-lg">إلغاء</button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-lg">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handlePaySupplier} className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold">سند صرف للمورد: {payTarget.name}</h3>
            <p className="text-slate-500">المستحق الحالي: {formatCurrency(payTarget.balance, cur, dec)}</p>
            <input type="number" min={1} max={payTarget.balance} step="0.5" value={payAmt} onChange={(e) => setPayAmt(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 font-mono text-sm" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayTarget(null)} className="px-3 py-1.5 border rounded-lg">إلغاء</button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-lg">تأكيد السداد</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
