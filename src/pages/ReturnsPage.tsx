import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, RotateCcw } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processSaleReturn } from '../services/erpEngine';
import type { ReturnLineItem, SaleInvoice } from '../types/erp';

export const ReturnsPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [queryNum, setQueryNum] = useState('');
  const [selectedInv, setSelectedInv] = useState<SaleInvoice | null>(null);
  const [retQtys, setRetQtys] = useState<Record<string, number>>({});
  const [conditions, setConditions] = useState<Record<string, 'good' | 'damaged'>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<'cash' | 'customer_credit'>('cash');

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => dbLocal.sales.filter((s) => s.docType === 'invoice' && s.status === 'completed').toArray(),
  });
  const { data: returns = [] } = useQuery({
    queryKey: ['returns'],
    queryFn: () => dbLocal.returns.orderBy('createdAt').reverse().toArray(),
  });

  const handleFind = () => {
    const found = sales.find(
      (s) => s.invoiceNumber.toLowerCase() === queryNum.trim().toLowerCase()
    );
    if (!found) {
      notify('لم يتم العثور على فاتورة مكتملة بهذا الرقم', 'error');
      return;
    }
    setSelectedInv(found);
    setRetQtys({});
  };

  const handleReturnSubmit = async () => {
    if (!selectedInv) return;
    const items: ReturnLineItem[] = selectedInv.items
      .map((item) => ({
        productId: item.productId,
        name: item.name,
        qty: retQtys[item.productId] || 0,
        refundPrice: roundUnitRefund(item.total, item.qty),
        condition: conditions[item.productId] || 'good',
        reason: reasons[item.productId] || 'استرجاع عميل',
      }))
      .filter((i) => i.qty > 0);

    try {
      const ret = await processSaleReturn({
        originalInvoiceId: selectedInv.id,
        items,
        refundMethod,
        shiftId: 'shift-current',
        userId: currentEmployee?.id || 'emp-admin',
        userName: currentEmployee?.name || 'الكاشير',
      });
      setSelectedInv(null);
      setQueryNum('');
      await refreshAll();
      notify(`تم تسجيل المرتجع ${ret.returnNumber} وإعادة الصالح للمخزون`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل تنفيذ المرتجع', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold">بحث الفاتورة الأصلية وإجراء مرتجع مبيعات</h2>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryNum}
              onChange={(e) => setQueryNum(e.target.value)}
              placeholder="أدخل رقم الفاتورة مثل INV-2026-0001..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 py-2 text-xs font-mono"
            />
          </div>
          <button onClick={handleFind} className="rounded-lg bg-[#0B1F3A] text-white px-4 py-2 text-xs font-bold">
            بحث عن الفاتورة
          </button>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">أو اختر سريعاً:</span>
            {sales.slice(0, 3).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setQueryNum(s.invoiceNumber);
                  setSelectedInv(s);
                  setRetQtys({});
                }}
                className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-mono hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {s.invoiceNumber}
              </button>
            ))}
          </div>
        </div>

        {selectedInv && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                الفاتورة: <strong className="font-mono">{selectedInv.invoiceNumber}</strong> · العميل: <strong>{selectedInv.customerName}</strong>
              </div>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'customer_credit')}
                className="rounded-lg border px-3 py-1.5 bg-slate-50 dark:bg-slate-800"
              >
                <option value="cash">استرداد نقدي من الخزينة</option>
                <option value="customer_credit">إضافة رصيد لحساب العميل</option>
              </select>
            </div>
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3">المباع</th>
                  <th className="py-2 px-3">الكمية المرتجعة</th>
                  <th className="py-2 px-3">الحالة</th>
                  <th className="py-2 px-3">سبب الإرجاع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {selectedInv.items.map((it) => (
                  <tr key={it.productId}>
                    <td className="py-2 px-3 font-semibold">{it.name}</td>
                    <td className="py-2 px-3 font-mono">{it.qty}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min={0}
                        max={it.qty}
                        value={retQtys[it.productId] || 0}
                        onChange={(e) => setRetQtys({ ...retQtys, [it.productId]: Number(e.target.value) })}
                        className="w-20 rounded border px-2 py-1 font-mono"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={conditions[it.productId] || 'good'}
                        onChange={(e) => setConditions({ ...conditions, [it.productId]: e.target.value as 'good' | 'damaged' })}
                        className="rounded border px-2 py-1 bg-slate-50 dark:bg-slate-800"
                      >
                        <option value="good">صالح (يعود للمخزون)</option>
                        <option value="damaged">تالف (لا يعود للبيع)</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={reasons[it.productId] || ''}
                        onChange={(e) => setReasons({ ...reasons, [it.productId]: e.target.value })}
                        placeholder="السبب..."
                        className="w-full rounded border px-2 py-1"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <button onClick={handleReturnSubmit} className="flex items-center gap-1.5 rounded-lg bg-teal-600 text-white px-4 py-2 text-xs font-bold">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>اعتماد المرتجع وتحديث الحسابات</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">رقم المرتجع</th>
              <th className="py-3 px-3">الفاتورة الأصلية</th>
              <th className="py-3 px-3">العميل</th>
              <th className="py-3 px-3">المبلغ المسترد</th>
              <th className="py-3 px-3">طريقة التسوية</th>
              <th className="py-3 px-4">التاريخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {returns.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">لا توجد مرتجعات مسجلة بعد.</td>
              </tr>
            ) : (
              returns.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4 font-mono font-bold">{r.returnNumber}</td>
                  <td className="py-2.5 px-3 font-mono">{r.originalInvoiceNumber}</td>
                  <td className="py-2.5 px-3">{r.customerName}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-rose-600">{formatCurrency(r.totalRefund, cur, dec)}</td>
                  <td className="py-2.5 px-3">{r.refundMethod === 'cash' ? 'نقدي' : 'رصيد عميل'}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{new Date(r.createdAt).toLocaleString('ar-EG')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function roundUnitRefund(total: number, qty: number): number {
  return qty > 0 ? Math.round((total / qty) * 100) / 100 : 0;
}
