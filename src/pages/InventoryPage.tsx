import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ClipboardCheck, PlusCircle, AlertTriangle } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import {
  computeProductTotalStock,
  formatCurrency,
  processStockCount,
  processStockTransfer,
} from '../services/erpEngine';
import { generateUUID } from '../lib/crypto';
import type { StockCountItem } from '../types/erp';

export const InventoryPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [tab, setTab] = useState<'balances' | 'transfer' | 'count' | 'ledger'>('balances');
  const [selectedWh, setSelectedWh] = useState('wh-main');
  const [transferProd, setTransferProd] = useState('prod-coffee');
  const [fromWh, setFromWh] = useState('wh-main');
  const [toWh, setToWh] = useState('wh-branch');
  const [transferQty, setTransferQty] = useState(1);
  const [transferReason, setTransferReason] = useState('تغذية الفرع');

  // Stock adjustment voucher
  const [adjProd, setAdjProd] = useState('prod-oil');
  const [adjType, setAdjType] = useState<'in' | 'out' | 'damage'>('in');
  const [adjQty, setAdjQty] = useState(5);
  const [adjReason, setAdjReason] = useState('إذن إضافة مخزني');

  // Stock count state
  const [countActuals, setCountActuals] = useState<Record<string, number>>({});
  const [countReasons, setCountReasons] = useState<Record<string, string>>({});

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => dbLocal.warehouses.toArray(),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => dbLocal.products.filter((p) => !p.isDeleted).toArray(),
  });
  const { data: movements = [] } = useQuery({
    queryKey: ['stockMovements'],
    queryFn: () => dbLocal.stockMovements.orderBy('createdAt').reverse().toArray(),
  });

  const valuationSummary = useMemo(() => {
    const costValue = products.reduce(
      (s, p) => s + computeProductTotalStock(p) * p.purchasePrice,
      0
    );
    const retailValue = products.reduce(
      (s, p) => s + computeProductTotalStock(p) * p.salePrice,
      0
    );
    const lowCount = products.filter((p) => computeProductTotalStock(p) <= p.minStockAlert).length;
    return { costValue, retailValue, lowCount };
  }, [products]);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await processStockTransfer({
        productId: transferProd,
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        quantity: transferQty,
        reason: transferReason,
        userId: currentEmployee?.id || 'emp-admin',
      });
      await refreshAll();
      notify('تم التحويل بين المخازن بنجاح', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل التحويل', 'error');
    }
  };

  const handleVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    const prod = await dbLocal.products.get(adjProd);
    if (!prod || adjQty <= 0) return;
    const prevQty = prod.stockByWarehouse[selectedWh] || 0;
    const delta = adjType === 'in' ? adjQty : -adjQty;
    const newQty = Math.max(0, prevQty + delta);
    const now = new Date().toISOString();
    await dbLocal.products.update(prod.id, {
      stockByWarehouse: { ...prod.stockByWarehouse, [selectedWh]: newQty },
      updatedAt: now,
    });
    await dbLocal.stockMovements.put({
      id: `mv-${generateUUID().slice(0, 8)}`,
      productId: prod.id,
      productName: prod.name,
      warehouseId: selectedWh,
      type: adjType,
      quantity: delta,
      previousQty: prevQty,
      newQty,
      unitCost: prod.purchasePrice,
      referenceId: `VCH-${Date.now().toString().slice(-5)}`,
      reason: adjReason,
      userId: currentEmployee?.id || 'emp-admin',
      createdAt: now,
    });
    await refreshAll();
    notify('تم تسجيل الإذن المخزني وتحديث الرصيد', 'success');
  };

  const handlePostCount = async () => {
    const items: StockCountItem[] = products.map((p) => {
      const bookQty = p.stockByWarehouse[selectedWh] || 0;
      const actualQty = countActuals[p.id] ?? bookQty;
      return {
        productId: p.id,
        productName: p.name,
        bookQty,
        actualQty,
        diff: actualQty - bookQty,
        reason: countReasons[p.id] || '',
      };
    });
    await processStockCount({
      warehouseId: selectedWh,
      type: 'full',
      items,
      userId: currentEmployee?.id || 'emp-admin',
      userName: currentEmployee?.name || 'مسؤول المخزن',
    });
    await refreshAll();
    notify('تم اعتماد الجرد الفعلي وتسوية الفروقات', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-5">
      {/* Valuation Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">تقييم المخزون بالتكلفة ({settings?.valuationMethod === 'fifo' ? 'FIFO' : 'المتوسط المرجح'})</div>
          <div className="text-lg font-extrabold font-mono tabular-nums mt-1 text-[#0B1F3A] dark:text-white">
            {formatCurrency(valuationSummary.costValue, cur, dec)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">القيمة البيعية المتوقعة للمخزون</div>
          <div className="text-lg font-extrabold font-mono tabular-nums mt-1 text-teal-600">
            {formatCurrency(valuationSummary.retailValue, cur, dec)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">أصناف تحت حد التنبيه</div>
          <div className="text-lg font-extrabold font-mono tabular-nums mt-1 text-amber-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{valuationSummary.lowCount} صنف</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl">
          {([
            { id: 'balances', label: 'أرصدة المخازن' },
            { id: 'transfer', label: 'التحويلات وأذون الصرف والإضافة' },
            { id: 'count', label: 'الجرد الفعلي والتسويات' },
            { id: 'ledger', label: 'سجل حركات المخزون (Stock Ledger)' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={selectedWh}
          onChange={(e) => setSelectedWh(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {tab === 'balances' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">الصنف</th>
                {warehouses.map((w) => (
                  <th key={w.id} className="py-3 px-3">{w.name}</th>
                ))}
                <th className="py-3 px-3">المحجوز</th>
                <th className="py-3 px-3">الإجمالي</th>
                <th className="py-3 px-4">قيمة المخزون</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {products.map((p) => {
                const total = computeProductTotalStock(p);
                return (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4 font-bold">{p.name}</td>
                    {warehouses.map((w) => (
                      <td key={w.id} className="py-2.5 px-3 font-mono tabular-nums">
                        {p.stockByWarehouse[w.id] || 0}
                      </td>
                    ))}
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">{p.reservedQty}</td>
                    <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${total <= p.minStockAlert ? 'text-amber-600' : 'text-teal-600'}`}>
                      {total} {p.unit}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">
                      {formatCurrency(total * p.purchasePrice, cur, dec)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'transfer' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <form onSubmit={handleTransfer} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-sm">
              <ArrowLeftRight className="w-4 h-4 text-teal-600" />
              <span>تحويل مخزني بين المستودعات</span>
            </div>
            <select value={transferProd} onChange={(e) => setTransferProd(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={fromWh} onChange={(e) => setFromWh(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                {warehouses.map((w) => <option key={w.id} value={w.id}>من: {w.name}</option>)}
              </select>
              <select value={toWh} onChange={(e) => setToWh(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                {warehouses.map((w) => <option key={w.id} value={w.id}>إلى: {w.name}</option>)}
              </select>
            </div>
            <input type="number" min={1} value={transferQty} onChange={(e) => setTransferQty(Number(e.target.value))} placeholder="الكمية" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono" />
            <input type="text" value={transferReason} onChange={(e) => setTransferReason(e.target.value)} placeholder="السبب" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2" />
            <button type="submit" className="w-full rounded-lg bg-[#0B1F3A] text-white py-2.5 font-bold">تنفيذ التحويل</button>
          </form>

          <form onSubmit={handleVoucher} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-sm">
              <PlusCircle className="w-4 h-4 text-teal-600" />
              <span>إذن إضافة / صرف / تالف ومفقود</span>
            </div>
            <select value={adjProd} onChange={(e) => setAdjProd(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={adjType} onChange={(e) => setAdjType(e.target.value as 'in' | 'out' | 'damage')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <option value="in">إذن إضافة للمخزن</option>
              <option value="out">إذن صرف من المخزن</option>
              <option value="damage">إثبات تالف / مفقود</option>
            </select>
            <input type="number" min={1} value={adjQty} onChange={(e) => setAdjQty(Number(e.target.value))} placeholder="الكمية" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono" />
            <input type="text" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="السبب / المرجع" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2" />
            <button type="submit" className="w-full rounded-lg bg-teal-600 text-white py-2.5 font-bold">اعتماد الإذن</button>
          </form>
        </div>
      )}

      {tab === 'count' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm">
              <ClipboardCheck className="w-4 h-4 text-teal-600" />
              <span>مقارنة الجرد الفعلي والدفتري</span>
            </div>
            <button onClick={handlePostCount} className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white">
              اعتماد وترحيل التسوية
            </button>
          </div>
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">الصنف</th>
                <th className="py-2.5 px-3">الرصيد الدفتري</th>
                <th className="py-2.5 px-3">الجرد الفعلي</th>
                <th className="py-2.5 px-3">الفرق (عجز/زيادة)</th>
                <th className="py-2.5 px-3">سبب الفرق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {products.map((p) => {
                const book = p.stockByWarehouse[selectedWh] || 0;
                const actual = countActuals[p.id] ?? book;
                const diff = actual - book;
                return (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-semibold">{p.name}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{book}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={actual}
                        onChange={(e) => setCountActuals({ ...countActuals, [p.id]: Number(e.target.value) })}
                        className="w-20 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 font-mono"
                      />
                    </td>
                    <td className={`py-2 px-3 font-mono tabular-nums font-bold ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={countReasons[p.id] || ''}
                        onChange={(e) => setCountReasons({ ...countReasons, [p.id]: e.target.value })}
                        placeholder="تلف / خطأ عد / زيادة..."
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-3">الصنف</th>
                <th className="py-3 px-3">نوع الحركة</th>
                <th className="py-3 px-3">الكمية</th>
                <th className="py-3 px-3">قبل / بعد</th>
                <th className="py-3 px-4">البيان والمرجع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{new Date(m.createdAt).toLocaleString('ar-EG')}</td>
                  <td className="py-2.5 px-3 font-semibold">{m.productName}</td>
                  <td className="py-2.5 px-3">{m.type}</td>
                  <td className={`py-2.5 px-3 font-mono tabular-nums font-bold ${m.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums">{m.previousQty} ← {m.newQty}</td>
                  <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
