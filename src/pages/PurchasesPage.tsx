import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Printer } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { formatCurrency, processPurchaseInvoice } from '../services/erpEngine';
import type { PurchaseInvoice, SaleInvoice } from '../types/erp';
import { InvoicePrintModal } from '../components/InvoicePrintModal';

export const PurchasesPage: React.FC = () => {
  const { settings, currentEmployee, notify, refreshAll } = useErp();
  const [modalOpen, setModalOpen] = useState(false);
  const [printPurchase, setPrintPurchase] = useState<PurchaseInvoice | null>(null);
  const [docType, setDocType] = useState<'invoice' | 'po' | 'quote'>('invoice');
  const [supplierId, setSupplierId] = useState('sup-1');
  const [warehouseId, setWarehouseId] = useState('wh-main');
  const [productId, setProductId] = useState('prod-coffee');
  const [orderedQty, setOrderedQty] = useState(10);
  const [receivedQty, setReceivedQty] = useState(10);
  const [unitCost, setUnitCost] = useState(205);
  const [shippingCost, setShippingCost] = useState(100);
  const [paidAmount, setPaidAmount] = useState(1500);
  const [accountId, setAccountId] = useState('acc-cash-main');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));

  const { data: purchases = [] } = useQuery({
    queryKey: ['purchases'],
    queryFn: () => dbLocal.purchases.orderBy('createdAt').reverse().toArray(),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dbLocal.suppliers.toArray(),
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => dbLocal.warehouses.toArray(),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => dbLocal.products.filter((p) => !p.isDeleted).toArray(),
  });
  const { data: cashboxes = [] } = useQuery({
    queryKey: ['cashboxAccounts'],
    queryFn: () => dbLocal.cashboxAccounts.toArray(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    try {
      await processPurchaseInvoice({
        docType,
        supplierId,
        warehouseId,
        items: [
          {
            productId: prod.id,
            name: prod.name,
            orderedQty,
            receivedQty: docType === 'invoice' ? receivedQty : 0,
            unitCost,
            allocatedShippingCost: 0,
            discount: 0,
            taxRate: prod.taxRate,
            total: 0,
          },
        ],
        shippingCost,
        paidAmount: docType === 'invoice' ? paidAmount : 0,
        accountId,
        dueDate,
        userId: currentEmployee?.id || 'emp-admin',
        userName: currentEmployee?.name || 'المشتريات',
      });
      setModalOpen(false);
      await refreshAll();
      notify('تم حفظ مستند المشتريات وتحديث التكلفة والموردين', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل حفظ المشتريات', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">فواتير الشراء وأوامر الشراء (PO) والاستلام الجزئي</h2>
          <p className="text-xs text-slate-500">توزيع مصاريف النقل والشحن تلقائياً على تكلفة الأصناف</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white"
        >
          <Plus className="w-4 h-4" />
          <span>فاتورة / أمر شراء جديد</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">الرقم</th>
              <th className="py-3 px-3">النوع</th>
              <th className="py-3 px-3">المورد</th>
              <th className="py-3 px-3">الشحن</th>
              <th className="py-3 px-3">الإجمالي</th>
              <th className="py-3 px-3">المدفوع / المتبقي</th>
              <th className="py-3 px-3">الاستحقاق</th>
              <th className="py-3 px-3">الحالة</th>
              <th className="py-3 px-4 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  لا توجد فواتير شراء مسجلة بعد — اضغط لإضافة أول فاتورة أو أمر شراء.
                </td>
              </tr>
            ) : (
              purchases.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 px-4 font-mono font-bold">{p.purchaseNumber}</td>
                  <td className="py-2.5 px-3">{p.docType === 'po' ? 'أمر شراء' : p.docType === 'quote' ? 'عرض مورد' : 'فاتورة شراء'}</td>
                  <td className="py-2.5 px-3 font-semibold">{p.supplierName}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(p.shippingCost, cur, dec)}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums font-bold">{formatCurrency(p.grandTotal, cur, dec)}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums">
                    {p.paidAmount.toFixed(dec)} · <span className="text-rose-600">متبقي {p.remainingAmount.toFixed(dec)}</span>
                  </td>
                  <td className="py-2.5 px-3 font-mono">{p.dueDate || '—'}</td>
                  <td className="py-2.5 px-3 font-semibold text-teal-600">
                    {p.status === 'received' ? 'مستلم بالكامل' : p.status === 'partial' ? 'استلام جزئي' : 'تحت الطلب'}
                  </td>
                  <td className="py-2.5 px-4 text-left">
                    <button
                      type="button"
                      onClick={() => setPrintPurchase(p)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                      title="طباعة فاتورة الشراء"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#0B1F3A] dark:text-teal-400" />
                      <span>طباعة</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold">تسجيل مستند مشتريات</h3>
            <div className="grid grid-cols-2 gap-3">
              <select value={docType} onChange={(e) => setDocType(e.target.value as 'invoice' | 'po' | 'quote')} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <option value="invoice">فاتورة شراء واستلام</option>
                <option value="po">أمر شراء (PO)</option>
                <option value="quote">عرض سعر مورد</option>
              </select>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block mb-1">الكمية المطلوبة</span>
                <input type="number" min={1} value={orderedQty} onChange={(e) => setOrderedQty(Number(e.target.value))} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
              <label className="block">
                <span className="block mb-1">الكمية المستلمة</span>
                <input type="number" min={0} value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
              <label className="block">
                <span className="block mb-1">تكلفة الوحدة</span>
                <input type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block mb-1">مصاريف الشحن</span>
                <input type="number" min={0} value={shippingCost} onChange={(e) => setShippingCost(Number(e.target.value))} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
              <label className="block">
                <span className="block mb-1">المدفوع الآن</span>
                <input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
              <label className="block">
                <span className="block mb-1">تاريخ الاستحقاق</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border px-2.5 py-1.5 font-mono" />
              </label>
            </div>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({formatCurrency(c.balance, cur, 0)})</option>)}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-1.5 border rounded-lg">إلغاء</button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-lg">حفظ واعتماد</button>
            </div>
          </form>
        </div>
      )}

      {printPurchase && settings && (
        <InvoicePrintModal
          invoice={mapPurchaseToPrintableInvoice(printPurchase, currentEmployee?.name || 'المسؤول')}
          settings={settings}
          documentLabel={
            printPurchase.docType === 'po'
              ? 'أمر شراء'
              : printPurchase.docType === 'quote'
              ? 'عرض سعر مورد'
              : 'فاتورة مشتريات'
          }
          partyLabel="المورد"
          operatorLabel="المسؤول"
          onClose={() => setPrintPurchase(null)}
        />
      )}
    </div>
  );
};

function mapPurchaseToPrintableInvoice(p: PurchaseInvoice, operatorName: string): SaleInvoice {
  return {
    id: p.id,
    invoiceNumber: p.purchaseNumber,
    docType: 'invoice',
    status: 'completed',
    customerId: p.supplierId,
    customerName: p.supplierName,
    warehouseId: p.warehouseId,
    items: p.items.map((it) => ({
      productId: it.productId,
      code: it.productId,
      name: it.name,
      barcode: '',
      qty: it.receivedQty || it.orderedQty,
      unit: 'وحدة',
      price: it.unitCost,
      costPrice: it.unitCost,
      discount: it.discount,
      taxRate: it.taxRate,
      taxAmount: 0,
      total: it.total || (it.receivedQty || it.orderedQty) * it.unitCost,
    })),
    subtotal: p.subtotal,
    discountTotal: 0,
    taxTotal: p.taxTotal,
    grandTotal: p.grandTotal,
    paidAmount: p.paidAmount,
    remainingAmount: p.remainingAmount,
    payments: p.paidAmount > 0 ? [{ method: 'cash', amount: p.paidAmount }] : [],
    cashierId: '',
    cashierName: operatorName,
    shiftId: '',
    etaQrPayload: '',
    eInvoiceUuid: '',
    etaStatus: 'prepared',
    uuid: p.id,
    idempotencyKey: p.id,
    revision: 1,
    version: 1,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
