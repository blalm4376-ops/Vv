import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Printer } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { closeExistingShift, formatCurrency, openNewShift } from '../services/erpEngine';

export const ShiftsPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [openingCash, setOpeningCash] = useState(2000);
  const [actualCash, setActualCash] = useState(0);

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => dbLocal.shifts.orderBy('openedAt').reverse().toArray(),
  });

  const openShift = shifts.find((s) => s.status === 'open');

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await openNewShift(currentEmployee?.id || 'emp-admin', currentEmployee?.name || 'الكاشير', openingCash);
      await refreshAll();
      notify('تم فتح الوردية بنجاح', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر فتح الوردية', 'error');
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openShift) return;
    try {
      const closed = await closeExistingShift(
        openShift.id,
        actualCash || openShift.expectedCash,
        currentEmployee?.id || 'emp-admin',
        currentEmployee?.name || 'المدير'
      );
      await refreshAll();
      notify(`تم إغلاق الوردية — العجز/الزيادة: ${formatCurrency(closed.variance)}`, 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إغلاق الوردية', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-5">
      {openShift ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-teal-600" />
              <div>
                <h3 className="text-sm font-bold">الوردية المفتوحة حالياً — {openShift.cashierName}</h3>
                <div className="text-xs text-slate-500 font-mono">بدأت: {new Date(openShift.openedAt).toLocaleString('ar-EG')}</div>
              </div>
            </div>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold no-print">
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة تقرير الوردية</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Box label="الرصيد الافتتاحي" val={formatCurrency(openShift.openingCash, cur, dec)} />
            <Box label="مبيعات نقدية" val={formatCurrency(openShift.cashSales, cur, dec)} />
            <Box label="مبيعات بطاقات ومحافظ" val={formatCurrency(openShift.cardSales + openShift.walletSales + openShift.transferSales, cur, dec)} />
            <Box label="النقدية المتوقعة بالدرج" val={formatCurrency(openShift.expectedCash, cur, dec)} highlight />
          </div>

          <form onSubmit={handleClose} className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 no-print">
            <label className="text-xs">
              <span className="block mb-1 font-semibold">النقدية الفعلية عند الجرد</span>
              <input
                type="number"
                step="0.5"
                value={actualCash || openShift.expectedCash}
                onChange={(e) => setActualCash(Number(e.target.value))}
                className="rounded-lg border px-3 py-2 font-mono text-sm w-48 bg-slate-50 dark:bg-slate-800"
              />
            </label>
            <button type="submit" className="rounded-lg bg-[#0B1F3A] text-white px-5 py-2.5 text-xs font-bold">
              إغلاق الوردية وحساب العجز/الزيادة
            </button>
          </form>
        </div>
      ) : (
        <form onSubmit={handleOpen} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block mb-1 font-semibold">الرصيد الافتتاحي لفتح وردية جديدة</span>
            <input
              type="number"
              min={0}
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value))}
              className="rounded-lg border px-3 py-2 font-mono text-sm w-48 bg-slate-50 dark:bg-slate-800"
            />
          </label>
          <button type="submit" className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-xs font-bold">
            فتح وردية جديدة
          </button>
        </form>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">الكاشير</th>
              <th className="py-3 px-3">الافتتاح</th>
              <th className="py-3 px-3">المتوقع</th>
              <th className="py-3 px-3">الفعلي</th>
              <th className="py-3 px-3">العجز / الزيادة</th>
              <th className="py-3 px-3">الفواتير</th>
              <th className="py-3 px-4">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shifts.map((sh) => (
              <tr key={sh.id}>
                <td className="py-2.5 px-4 font-bold">{sh.cashierName}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(sh.openingCash, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(sh.expectedCash, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{sh.actualCash !== undefined ? formatCurrency(sh.actualCash, cur, dec) : '—'}</td>
                <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${sh.variance < 0 ? 'text-rose-600' : sh.variance > 0 ? 'text-emerald-600' : ''}`}>
                  {formatCurrency(sh.variance, cur, dec)}
                </td>
                <td className="py-2.5 px-3 font-mono tabular-nums">{sh.invoiceCount}</td>
                <td className="py-2.5 px-4 font-semibold">{sh.status === 'open' ? 'مفتوحة' : 'مغلقة'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Box: React.FC<{ label: string; val: string; highlight?: boolean }> = ({ label, val, highlight }) => (
  <div className={`rounded-lg border p-3 ${highlight ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
    <div className="text-slate-500">{label}</div>
    <div className="font-mono tabular-nums font-extrabold text-sm mt-1">{val}</div>
  </div>
);
