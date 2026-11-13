import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, ArrowLeftRight } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processCashboxOperation } from '../services/erpEngine';

export const CashboxPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [opType, setOpType] = useState<
    'receipt' | 'payment' | 'transfer' | 'deposit' | 'withdrawal' | 'capital' | 'personal_draw' | 'variance'
  >('transfer');
  const [accountId, setAccountId] = useState('acc-cash-pos');
  const [targetAccountId, setTargetAccountId] = useState('acc-cash-main');
  const [amount, setAmount] = useState(1000);
  const [description, setDescription] = useState('توريد من خزينة الكاشير للخزينة الرئيسية');

  const { data: accounts = [] } = useQuery({
    queryKey: ['cashboxAccounts'],
    queryFn: () => dbLocal.cashboxAccounts.toArray(),
  });
  const { data: txs = [] } = useQuery({
    queryKey: ['cashTransactions'],
    queryFn: () => dbLocal.cashTransactions.orderBy('createdAt').reverse().toArray(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await processCashboxOperation({
        type: opType,
        accountId,
        targetAccountId,
        amount,
        description,
        userId: currentEmployee?.id || 'emp-admin',
        userName: currentEmployee?.name || 'المدير',
      });
      await refreshAll();
      notify('تم تنفيذ حركة الخزينة والبنك بنجاح', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل العملية', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <div key={acc.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{acc.type === 'bank' ? 'حساب بنكي' : acc.type === 'main_cash' ? 'خزينة رئيسية' : 'خزينة فرعية'}</span>
              <Landmark className="w-4 h-4 text-teal-600" />
            </div>
            <div className="font-bold text-sm mt-1">{acc.name}</div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-[#0B1F3A] dark:text-teal-400 mt-2">
              {formatCurrency(acc.balance, cur, dec)}
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              الرصيد الافتتاحي: {formatCurrency(acc.openingBalance, cur, dec)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ArrowLeftRight className="w-4 h-4 text-teal-600" />
            <span>سندات القبض والصرف والتحويلات</span>
          </div>
          <select value={opType} onChange={(e) => setOpType(e.target.value as typeof opType)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
            <option value="transfer">تحويل بين الخزائن</option>
            <option value="deposit">إيداع بنكي</option>
            <option value="withdrawal">سحب بنكي</option>
            <option value="receipt">سند قبض / إيراد</option>
            <option value="payment">سند صرف</option>
            <option value="capital">إيداع رأس مال</option>
            <option value="personal_draw">مسحوبات شخصية</option>
            <option value="variance">تسوية عجز / زيادة</option>
          </select>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
            {accounts.map((a) => <option key={a.id} value={a.id}>الحساب: {a.name}</option>)}
          </select>
          {(opType === 'transfer' || opType === 'deposit' || opType === 'withdrawal') && (
            <select value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {accounts.map((a) => <option key={a.id} value={a.id}>إلى: {a.name}</option>)}
            </select>
          )}
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="المبلغ" className="w-full rounded-lg border px-3 py-2 font-mono" />
          <input type="text" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="البيان" className="w-full rounded-lg border px-3 py-2" />
          <button type="submit" className="w-full rounded-lg bg-teal-600 text-white py-2.5 font-bold hover:bg-teal-700">
            تنفيذ السند
          </button>
        </form>

        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-3">النوع</th>
                <th className="py-3 px-3">المبلغ</th>
                <th className="py-3 px-4">البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{new Date(t.createdAt).toLocaleString('ar-EG')}</td>
                  <td className="py-2.5 px-3 font-semibold">{t.category}</td>
                  <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${t.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatCurrency(t.amount, cur, dec)}
                  </td>
                  <td className="py-2.5 px-4">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
