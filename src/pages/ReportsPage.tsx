import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Download, Printer } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { computeProductTotalStock, formatCurrency } from '../services/erpEngine';

export const ReportsPage: React.FC = () => {
  const { settings, hasPermission, notify } = useErp();
  const [reportType, setReportType] = useState<'sales' | 'margins' | 'inventory' | 'debts' | 'employees'>('sales');
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: sales = [] } = useQuery({ queryKey: ['sales'], queryFn: () => dbLocal.sales.toArray() });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: () => dbLocal.products.filter((p) => !p.isDeleted).toArray() });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => dbLocal.customers.toArray() });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => dbLocal.suppliers.toArray() });

  const filteredSales = useMemo(
    () =>
      sales.filter(
        (s) =>
          s.docType === 'invoice' &&
          s.status === 'completed' &&
          s.createdAt.slice(0, 10) >= dateFrom &&
          s.createdAt.slice(0, 10) <= dateTo
      ),
    [sales, dateFrom, dateTo]
  );

  const productMargins = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number }>();
    for (const s of filteredSales) {
      for (const it of s.items) {
        const cur = map.get(it.productId) || { name: it.name, qty: 0, revenue: 0, cost: 0, profit: 0 };
        const netRev = it.price * it.qty - it.discount;
        const cost = it.costPrice * it.qty;
        cur.qty += it.qty;
        cur.revenue += netRev;
        cur.cost += cost;
        cur.profit += netRev - cost;
        map.set(it.productId, cur);
      }
    }
    return Array.from(map.values());
  }, [filteredSales]);

  const employeePerf = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const s of filteredSales) {
      const cur = map.get(s.cashierId) || { name: s.cashierName, count: 0, total: 0 };
      cur.count += 1;
      cur.total += s.grandTotal;
      map.set(s.cashierId, cur);
    }
    return Array.from(map.values());
  }, [filteredSales]);

  const handleExportExcel = () => {
    const rows =
      reportType === 'sales'
        ? filteredSales.map((s) => ({ الفاتورة: s.invoiceNumber, العميل: s.customerName, الإجمالي: s.grandTotal, الضريبة: s.taxTotal, التاريخ: s.createdAt.slice(0, 10) }))
        : reportType === 'margins'
        ? productMargins.map((m) => ({ المنتج: m.name, الكمية: m.qty, الإيراد: m.revenue, التكلفة: m.cost, الربح: m.profit }))
        : products.map((p) => ({ الصنف: p.name, الرصيد: computeProductTotalStock(p), التكلفة: p.purchasePrice, البيع: p.salePrice }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `smart_pos_report_${reportType}.xlsx`);
    notify('تم تصدير التقرير إلى Excel', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          {([
            { id: 'sales', label: 'المبيعات' },
            { id: 'margins', label: 'هامش ربح الأصناف' },
            { id: 'inventory', label: 'المخزون والراكدة' },
            { id: 'debts', label: 'مديونيات العملاء والموردين' },
            { id: 'employees', label: 'أداء الموظفين' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setReportType(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                reportType === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-800" />
          <span>إلى</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-800" />
          {hasPermission('reports.export') && (
            <button onClick={handleExportExcel} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 font-semibold">
              <Download className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-1 rounded-lg bg-[#0B1F3A] text-white px-3 py-1.5 font-semibold">
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة / PDF</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto p-4">
        {reportType === 'sales' && (
          <table className="w-full text-xs text-right">
            <thead className="border-b">
              <tr>
                <th className="py-2">رقم الفاتورة</th>
                <th className="py-2">العميل</th>
                <th className="py-2">التاريخ</th>
                <th className="py-2">الضريبة</th>
                <th className="py-2">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSales.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 font-mono font-bold">{s.invoiceNumber}</td>
                  <td className="py-2">{s.customerName}</td>
                  <td className="py-2 font-mono">{s.createdAt.slice(0, 10)}</td>
                  <td className="py-2 font-mono tabular-nums">{formatCurrency(s.taxTotal, cur, dec)}</td>
                  <td className="py-2 font-mono tabular-nums font-bold">{formatCurrency(s.grandTotal, cur, dec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportType === 'margins' && (
          <table className="w-full text-xs text-right">
            <thead className="border-b">
              <tr>
                <th className="py-2">الصنف</th>
                <th className="py-2">الكمية المباعة</th>
                <th className="py-2">الإيراد الصافي</th>
                <th className="py-2">التكلفة</th>
                <th className="py-2">الربح المحقق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {productMargins.map((m, idx) => (
                <tr key={idx}>
                  <td className="py-2 font-bold">{m.name}</td>
                  <td className="py-2 font-mono tabular-nums">{m.qty}</td>
                  <td className="py-2 font-mono tabular-nums">{formatCurrency(m.revenue, cur, dec)}</td>
                  <td className="py-2 font-mono tabular-nums">{formatCurrency(m.cost, cur, dec)}</td>
                  <td className="py-2 font-mono tabular-nums font-bold text-teal-600">{formatCurrency(m.profit, cur, dec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportType === 'inventory' && (
          <table className="w-full text-xs text-right">
            <thead className="border-b">
              <tr>
                <th className="py-2">الصنف</th>
                <th className="py-2">الرصيد الحالي</th>
                <th className="py-2">حد التنبيه</th>
                <th className="py-2">القيمة بالتكلفة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {products.map((p) => {
                const qty = computeProductTotalStock(p);
                return (
                  <tr key={p.id}>
                    <td className="py-2 font-bold">{p.name}</td>
                    <td className="py-2 font-mono tabular-nums">{qty}</td>
                    <td className="py-2 font-mono tabular-nums">{p.minStockAlert}</td>
                    <td className="py-2 font-mono tabular-nums font-bold">{formatCurrency(qty * p.purchasePrice, cur, dec)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {reportType === 'debts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div>
              <h4 className="font-bold mb-2">ذمم العملاء المدينة</h4>
              {customers.filter((c) => c.balance > 0).map((c) => (
                <div key={c.id} className="flex justify-between py-2 border-b">
                  <span>{c.name}</span>
                  <span className="font-mono font-bold text-rose-600">{formatCurrency(c.balance, cur, dec)}</span>
                </div>
              ))}
            </div>
            <div>
              <h4 className="font-bold mb-2">مستحقات الموردين الدائنة</h4>
              {suppliers.filter((s) => s.balance > 0).map((s) => (
                <div key={s.id} className="flex justify-between py-2 border-b">
                  <span>{s.name}</span>
                  <span className="font-mono font-bold text-amber-600">{formatCurrency(s.balance, cur, dec)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {reportType === 'employees' && (
          <table className="w-full text-xs text-right">
            <thead className="border-b">
              <tr>
                <th className="py-2">الموظف</th>
                <th className="py-2">عدد الفواتير</th>
                <th className="py-2">إجمالي المبيعات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {employeePerf.map((e, i) => (
                <tr key={i}>
                  <td className="py-2 font-bold">{e.name}</td>
                  <td className="py-2 font-mono tabular-nums">{e.count}</td>
                  <td className="py-2 font-mono tabular-nums font-bold text-teal-600">{formatCurrency(e.total, cur, dec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
