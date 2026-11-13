import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processExpense } from '../services/erpEngine';
import type { ExpenseCategory } from '../types/erp';

const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  rent: 'الإيجار',
  electricity: 'الكهرباء',
  water: 'المياه',
  salaries: 'الرواتب والأجور',
  maintenance: 'الصيانة',
  transport: 'النقل والشحن',
  marketing: 'التسويق والإعلان',
  other: 'مصروفات أخرى',
};

export const ExpensesPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [category, setCategory] = useState<ExpenseCategory>('electricity');
  const [amount, setAmount] = useState(250);
  const [accountId, setAccountId] = useState('acc-cash-main');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | ExpenseCategory>('all');

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => dbLocal.expenses.orderBy('createdAt').reverse().toArray(),
  });
  const { data: cashboxes = [] } = useQuery({
    queryKey: ['cashboxAccounts'],
    queryFn: () => dbLocal.cashboxAccounts.toArray(),
  });

  const filtered = useMemo(
    () => expenses.filter((e) => catFilter === 'all' || e.category === catFilter),
    [expenses, catFilter]
  );

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await processExpense({
        category,
        amount,
        accountId,
        date,
        notes,
        receiptRef,
        userId: currentEmployee?.id || 'emp-admin',
        userName: currentEmployee?.name || 'المدير',
      });
      setNotes('');
      setReceiptRef('');
      await refreshAll();
      notify('تم تسجيل المصروف وإصدار سند الصرف والقيد المحاسبي', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل تسجيل المصروف', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs h-fit">
        <h3 className="text-sm font-bold">تسجيل مصروف وسند صرف</h3>
        <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="w-full rounded-lg border px-3 py-2 bg-slate-50 dark:bg-slate-800">
          {Object.entries(EXPENSE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input type="number" min={1} step="0.5" value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="المبلغ" className="w-full rounded-lg border px-3 py-2 font-mono" />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-slate-50 dark:bg-slate-800">
          {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 font-mono" />
        <input type="text" value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="رقم الإيصال المرفق (اختياري)" className="w-full rounded-lg border px-3 py-2 font-mono" />
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات وبيان الصرف" className="w-full rounded-lg border px-3 py-2" />
        <button type="submit" className="w-full rounded-lg bg-[#0B1F3A] text-white py-2.5 font-bold">تسجيل المصروف</button>
      </form>

      <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-bold">سجل المصروفات · الإجمالي: <span className="font-mono text-rose-600">{formatCurrency(totalFiltered, cur, dec)}</span></div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as 'all' | ExpenseCategory)} className="rounded-lg border px-3 py-1.5 bg-slate-50 dark:bg-slate-800">
            <option value="all">كل التصنيفات</option>
            {Object.entries(EXPENSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-3">التصنيف</th>
                <th className="py-3 px-3">المبلغ</th>
                <th className="py-3 px-3">المرجع</th>
                <th className="py-3 px-3">المسجل</th>
                <th className="py-3 px-4">البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((ex) => (
                <tr key={ex.id}>
                  <td className="py-2.5 px-4 font-mono">{ex.date}</td>
                  <td className="py-2.5 px-3 font-semibold">{EXPENSE_LABELS[ex.category]}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-rose-600">{formatCurrency(ex.amount, cur, dec)}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{ex.receiptRef || '—'}</td>
                  <td className="py-2.5 px-3">{ex.userName}</td>
                  <td className="py-2.5 px-4">{ex.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
