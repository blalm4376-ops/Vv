import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, logAudit, roundMoney, verifyJournalBalance } from '../services/erpEngine';
import { generateUUID } from '../lib/crypto';

export const AccountingPage: React.FC = () => {
  const { settings, currentEmployee, hasPermission, notify, refreshAll } = useErp();
  const canManageAccounting = hasPermission('accounting.manage');
  const [tab, setTab] = useState<'coa' | 'journal' | 'trial' | 'pnl' | 'balance'>('coa');
  const [debitAccId, setDebitAccId] = useState('coa-5201');
  const [creditAccId, setCreditAccId] = useState('coa-1101');
  const [entryAmt, setEntryAmt] = useState(500);
  const [entryDesc, setEntryDesc] = useState('قيد تسوية محاسبية');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => dbLocal.accounts.orderBy('code').toArray(),
  });
  const { data: entries = [] } = useQuery({
    queryKey: ['journalEntries'],
    queryFn: () => dbLocal.journalEntries.orderBy('createdAt').reverse().toArray(),
  });

  const financials = useMemo(() => {
    const revenue = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + a.balance, 0);
    const cogs = accounts.filter((a) => a.type === 'cogs').reduce((s, a) => s + a.balance, 0);
    const expenses = accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + a.balance, 0);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenses;

    const assets = accounts.filter((a) => a.type === 'asset').reduce((s, a) => s + a.balance, 0);
    const liabilities = accounts.filter((a) => a.type === 'liability').reduce((s, a) => s + a.balance, 0);
    const equity = accounts.filter((a) => a.type === 'equity').reduce((s, a) => s + a.balance, 0) + netProfit;

    const trialRows = accounts.map((a) => {
      const isDebitNature = a.type === 'asset' || a.type === 'cogs' || a.type === 'expense';
      return {
        ...a,
        debit: isDebitNature ? Math.max(0, a.balance) : Math.max(0, -a.balance),
        credit: !isDebitNature ? Math.max(0, a.balance) : Math.max(0, -a.balance),
      };
    });
    const trialDebit = trialRows.reduce((s, r) => s + r.debit, 0);
    const trialCredit = trialRows.reduce((s, r) => s + r.credit, 0);

    return { revenue, cogs, expenses, grossProfit, netProfit, assets, liabilities, equity, trialRows, trialDebit, trialCredit };
  }, [accounts]);

  const handleManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (debitAccId === creditAccId || entryAmt <= 0) {
      notify('يرجى اختيار حسابين مختلفين ومبلغ موجب', 'error');
      return;
    }
    const dAcc = accounts.find((a) => a.id === debitAccId);
    const cAcc = accounts.find((a) => a.id === creditAccId);
    if (!dAcc || !cAcc) return;

    const lines = [
      { accountId: dAcc.id, accountCode: dAcc.code, accountName: dAcc.name, debit: entryAmt, credit: 0 },
      { accountId: cAcc.id, accountCode: cAcc.code, accountName: cAcc.name, debit: 0, credit: entryAmt },
    ];
    const check = verifyJournalBalance(lines);
    if (!check.balanced) return;

    const now = new Date().toISOString();
    await dbLocal.journalEntries.put({
      id: `je-${generateUUID().slice(0, 8)}`,
      entryNumber: `JE-${new Date().getFullYear()}-${String(entries.length + 1).padStart(4, '0')}`,
      date: now.slice(0, 10),
      description: entryDesc,
      referenceType: 'manual',
      referenceId: 'manual',
      lines,
      totalDebit: check.totalDebit,
      totalCredit: check.totalCredit,
      createdAt: now,
    });

    for (const line of lines) {
      const acc = await dbLocal.accounts.get(line.accountId);
      if (acc) {
        const delta =
          acc.type === 'asset' || acc.type === 'cogs' || acc.type === 'expense'
            ? line.debit - line.credit
            : line.credit - line.debit;
        await dbLocal.accounts.update(acc.id, { balance: roundMoney(acc.balance + delta) });
      }
    }

    await refreshAll();
    notify('تم تسجيل القيد المزدوج المتوازن', 'success');
  };

  const handleClosePeriod = async () => {
    await dbLocal.settings.update('main', { fiscalYearClosedUntil: new Date().toISOString().slice(0, 10) });
    await logAudit(currentEmployee?.id || 'emp-admin', currentEmployee?.name || 'المحاسب', 'إقفال الفترة المالية', 'المحاسبة', `صافي الربح ${financials.netProfit}`);
    await refreshAll();
    notify('تم إقفال الفترة المالية وتوثيق الأرصدة الختامية', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl">
          {([
            { id: 'coa', label: 'دليل الحسابات ودفتر الأستاذ' },
            { id: 'journal', label: 'القيود اليومية المزدوجة' },
            { id: 'trial', label: 'ميزان المراجعة' },
            { id: 'pnl', label: 'قائمة الدخل (الأرباح والخسائر)' },
            { id: 'balance', label: 'الميزانية العمومية' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canManageAccounting && (
          <button
            onClick={handleClosePeriod}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            إقفال الفترة المالية
          </button>
        )}
      </div>

      {tab === 'coa' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">رقم الحساب</th>
                <th className="py-3 px-3">اسم الحساب</th>
                <th className="py-3 px-3">التصنيف</th>
                <th className="py-3 px-4">الرصيد الحالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 px-4 font-mono font-bold">{a.code}</td>
                  <td className="py-2.5 px-3 font-semibold">{a.name}</td>
                  <td className="py-2.5 px-3 text-slate-500">{a.type}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums font-bold">{formatCurrency(a.balance, cur, dec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'journal' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {canManageAccounting && (
            <form onSubmit={handleManualEntry} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs h-fit">
              <h3 className="text-sm font-bold">إضافة قيد يومي مزدوج (Double Entry)</h3>
              <label className="block">
                <span className="block mb-1 font-semibold">الحساب المدين (Debit)</span>
                <select value={debitAccId} onChange={(e) => setDebitAccId(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-slate-50 dark:bg-slate-800">
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 font-semibold">الحساب الدائن (Credit)</span>
                <select value={creditAccId} onChange={(e) => setCreditAccId(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-slate-50 dark:bg-slate-800">
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </label>
              <input type="number" min={1} value={entryAmt} onChange={(e) => setEntryAmt(Number(e.target.value))} placeholder="المبلغ" className="w-full rounded-lg border px-3 py-2 font-mono" />
              <input type="text" required value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} placeholder="البيان" className="w-full rounded-lg border px-3 py-2" />
              <button type="submit" className="w-full rounded-lg bg-[#0B1F3A] text-white py-2.5 font-bold">ترحيل القيد</button>
            </form>
          )}

          <div className={`${canManageAccounting ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-3`}>
            {entries.map((je) => (
              <div key={je.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="font-mono font-bold text-[#0B1F3A] dark:text-teal-400">{je.entryNumber}</span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span className="font-semibold">{je.description}</span>
                  </div>
                  <span className="font-mono text-slate-500">{je.date}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-right py-1">الحساب</th>
                      <th className="text-left py-1">مدين</th>
                      <th className="text-left py-1">دائن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {je.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="py-1">{l.accountCode} - {l.accountName}</td>
                        <td className="py-1 text-left font-mono tabular-nums">{l.debit > 0 ? l.debit.toFixed(dec) : '—'}</td>
                        <td className="py-1 text-left font-mono tabular-nums">{l.credit > 0 ? l.credit.toFixed(dec) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'trial' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">الكود</th>
                <th className="py-3 px-3">الحساب</th>
                <th className="py-3 px-3">مدين</th>
                <th className="py-3 px-4">دائن</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {financials.trialRows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4 font-mono">{r.code}</td>
                  <td className="py-2.5 px-3 font-semibold">{r.name}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(r.debit, cur, dec)}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums">{formatCurrency(r.credit, cur, dec)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 dark:bg-slate-800 font-extrabold">
                <td colSpan={2} className="py-3 px-4">الإجمالي</td>
                <td className="py-3 px-3 font-mono tabular-nums">{formatCurrency(financials.trialDebit, cur, dec)}</td>
                <td className="py-3 px-4 font-mono tabular-nums">{formatCurrency(financials.trialCredit, cur, dec)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pnl' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-2xl space-y-3 text-sm">
          <h3 className="font-extrabold text-base text-[#0B1F3A] dark:text-white border-b pb-2">قائمة الدخل (الأرباح والخسائر)</h3>
          <Row label="إجمالي إيرادات المبيعات" val={formatCurrency(financials.revenue, cur, dec)} />
          <Row label="تكلفة البضاعة المباعة (COGS)" val={`-${formatCurrency(financials.cogs, cur, dec)}`} />
          <Row label="مجمل الربح (Gross Profit)" val={formatCurrency(financials.grossProfit, cur, dec)} bold />
          <Row label="المصروفات التشغيلية والرواتب" val={`-${formatCurrency(financials.expenses, cur, dec)}`} />
          <Row label="صافي الربح (Net Profit)" val={formatCurrency(financials.netProfit, cur, dec)} bold highlight />
        </div>
      )}

      {tab === 'balance' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-2xl space-y-3 text-sm">
          <h3 className="font-extrabold text-base text-[#0B1F3A] dark:text-white border-b pb-2">الميزانية العمومية (المركز المالي)</h3>
          <Row label="إجمالي الأصول (النقدية، البنوك، العملاء، المخزون)" val={formatCurrency(financials.assets, cur, dec)} bold />
          <Row label="إجمالي الالتزامات (الموردين وضرائب القيمة المضافة)" val={formatCurrency(financials.liabilities, cur, dec)} />
          <Row label="حقوق الملكية + صافي أرباح الفترة" val={formatCurrency(financials.equity, cur, dec)} />
          <Row label="إجمالي الالتزامات وحقوق الملكية" val={formatCurrency(financials.liabilities + financials.equity, cur, dec)} bold highlight />
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; val: string; bold?: boolean; highlight?: boolean }> = ({
  label,
  val,
  bold,
  highlight,
}) => (
  <div className={`flex items-center justify-between py-1.5 ${bold ? 'font-bold border-t border-slate-200 dark:border-slate-800 pt-2' : ''} ${highlight ? 'text-teal-600 text-base' : ''}`}>
    <span>{label}</span>
    <span className="font-mono tabular-nums">{val}</span>
  </div>
);
