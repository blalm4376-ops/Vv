import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Wallet, Award } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processCashboxOperation } from '../services/erpEngine';
import { generateUUID } from '../lib/crypto';
import type { Customer } from '../types/erp';

export const CustomersPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [collectTarget, setCollectTarget] = useState<Customer | null>(null);
  const [collectAmt, setCollectAmt] = useState(0);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => dbLocal.customers.toArray(),
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.name) return;
    const now = new Date().toISOString();
    const doc: Customer = {
      id: editing.id || `cust-${generateUUID().slice(0, 8)}`,
      name: editing.name,
      phone: editing.phone || '',
      address: editing.address || '',
      taxNumber: editing.taxNumber || '',
      openingBalance: Number(editing.openingBalance || 0),
      creditLimit: Number(editing.creditLimit || 0),
      totalPurchases: editing.totalPurchases || 0,
      totalPaid: editing.totalPaid || 0,
      balance: editing.id ? Number(editing.balance || 0) : Number(editing.openingBalance || 0),
      tier: editing.tier || 'retail',
      loyaltyPoints: editing.loyaltyPoints || 0,
      paymentSchedule: editing.paymentSchedule || [],
      createdAt: editing.createdAt || now,
      updatedAt: now,
    };
    await dbLocal.customers.put(doc);
    setEditing(null);
    await refreshAll();
    notify('تم حفظ بيانات العميل بنجاح', 'success');
  };

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectTarget || collectAmt <= 0) return;
    await processCashboxOperation({
      type: 'receipt',
      accountId: 'acc-cash-main',
      amount: collectAmt,
      description: `تحصيل مديونية من العميل ${collectTarget.name}`,
      customerId: collectTarget.id,
      userId: currentEmployee?.id || 'emp-admin',
      userName: currentEmployee?.name || 'المحاسب',
    });
    setCollectTarget(null);
    setCollectAmt(0);
    await refreshAll();
    notify('تم تحصيل الدفعة وتحديث كشف حساب العميل', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">دليل العملاء والائتمان ونقاط الولاء</h2>
          <p className="text-xs text-slate-500">متابعة المديونيات، التحصيل، والحدود الائتمانية</p>
        </div>
        <button
          onClick={() => setEditing({ tier: 'retail', creditLimit: 5000, openingBalance: 0 })}
          className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة عميل</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">العميل</th>
              <th className="py-3 px-3">التصنيف</th>
              <th className="py-3 px-3">إجمالي المشتريات</th>
              <th className="py-3 px-3">المدفوع</th>
              <th className="py-3 px-3">الرصيد المستحق</th>
              <th className="py-3 px-3">الحد الائتماني</th>
              <th className="py-3 px-3">نقاط الولاء</th>
              <th className="py-3 px-4 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="py-2.5 px-4">
                  <div className="font-bold">{c.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{c.phone}</div>
                </td>
                <td className="py-2.5 px-3">{c.tier === 'wholesale' ? 'جملة' : c.tier === 'vip' ? 'VIP' : 'قطاعي'}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(c.totalPurchases, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums text-emerald-600">{formatCurrency(c.totalPaid, cur, dec)}</td>
                <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${c.balance > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                  {formatCurrency(c.balance, cur, dec)}
                </td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(c.creditLimit, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1 text-teal-600 font-bold">
                    <Award className="w-3.5 h-3.5" />
                    {c.loyaltyPoints}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center justify-end gap-2">
                    {c.balance > 0 && (
                      <button
                        onClick={() => {
                          setCollectTarget(c);
                          setCollectAmt(c.balance);
                        }}
                        className="flex items-center gap-1 rounded bg-teal-600 text-white px-2.5 py-1 font-semibold"
                      >
                        <Wallet className="w-3 h-3" />
                        <span>تحصيل</span>
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-semibold"
                    >
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
            <h3 className="text-base font-bold">{editing.id ? 'تعديل عميل' : 'عميل جديد'}</h3>
            <input type="text" required value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="اسم العميل *" className="w-full rounded-lg border px-3 py-2" />
            <input type="text" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="الهاتف" className="w-full rounded-lg border px-3 py-2" />
            <input type="text" value={editing.address || ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="العنوان" className="w-full rounded-lg border px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={editing.tier || 'retail'} onChange={(e) => setEditing({ ...editing, tier: e.target.value as Customer['tier'] })} className="rounded-lg border px-3 py-2">
                <option value="retail">قطاعي</option>
                <option value="wholesale">جملة</option>
                <option value="vip">VIP</option>
              </select>
              <input type="number" value={editing.creditLimit ?? 0} onChange={(e) => setEditing({ ...editing, creditLimit: Number(e.target.value) })} placeholder="الحد الائتماني" className="rounded-lg border px-3 py-2 font-mono" />
            </div>
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

      {collectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleCollect} className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold">سند تحصيل من العميل: {collectTarget.name}</h3>
            <p className="text-slate-500">المديونية الحالية: {formatCurrency(collectTarget.balance, cur, dec)}</p>
            <input type="number" min={1} max={collectTarget.balance} step="0.5" value={collectAmt} onChange={(e) => setCollectAmt(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 font-mono text-sm" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCollectTarget(null)} className="px-3 py-1.5 border rounded-lg">إلغاء</button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-lg">تأكيد التحصيل</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
