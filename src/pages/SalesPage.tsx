import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowRightLeft, Plus, XCircle, FileJson } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import {
  cancelSaleInvoice,
  formatCurrency,
  processSaleInvoice,
} from '../services/erpEngine';
import type { SaleInvoice, SaleLineItem } from '../types/erp';
import { InvoicePrintModal } from '../components/InvoicePrintModal';

export const SalesPage: React.FC = () => {
  const { settings, currentEmployee, hasPermission, notify, refreshAll } = useErp();
  const [filterType, setFilterType] = useState<'all' | 'invoice' | 'quotation' | 'sales_order'>('all');
  const [printInv, setPrintInv] = useState<SaleInvoice | null>(null);
  const [etaJsonInv, setEtaJsonInv] = useState<SaleInvoice | null>(null);
  const [newQuoteOpen, setNewQuoteOpen] = useState(false);

  // Quotation / Sales Order builder state
  const [docType, setDocType] = useState<'quotation' | 'sales_order'>('quotation');
  const [customerId, setCustomerId] = useState('cust-vip-1');
  const [selectedProdId, setSelectedProdId] = useState('prod-coffee');
  const [qty, setQty] = useState(5);

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => dbLocal.sales.orderBy('createdAt').reverse().toArray(),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => dbLocal.customers.toArray(),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => dbLocal.products.filter((p) => !p.isDeleted).toArray(),
  });

  const filtered = sales.filter((s) => filterType === 'all' || s.docType === filterType);

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    const prod = products.find((p) => p.id === selectedProdId);
    if (!prod) return;
    const taxRate = settings?.vatEnabled ? prod.taxRate : 0;
    const net = qty * prod.salePrice;
    const taxAmount = net * (taxRate / 100);
    const line: SaleLineItem = {
      productId: prod.id,
      code: prod.code,
      name: prod.name,
      barcode: prod.barcode,
      qty,
      unit: prod.unit,
      price: prod.salePrice,
      costPrice: prod.purchasePrice,
      discount: 0,
      taxRate,
      taxAmount,
      total: net + taxAmount,
    };

    await processSaleInvoice({
      docType,
      status: 'held',
      customerId,
      warehouseId: 'wh-main',
      items: [line],
      payments: [],
      cashierId: currentEmployee?.id || 'emp-admin',
      cashierName: currentEmployee?.name || 'النظام',
      shiftId: 'shift-current',
    });
    setNewQuoteOpen(false);
    await refreshAll();
    notify(docType === 'quotation' ? 'تم إنشاء عرض السعر بنجاح' : 'تم إنشاء طلب البيع بنجاح', 'success');
  };

  const handleConvertToInvoice = async (quote: SaleInvoice) => {
    try {
      await processSaleInvoice({
        docType: 'invoice',
        status: 'completed',
        customerId: quote.customerId,
        warehouseId: quote.warehouseId,
        items: quote.items,
        invoiceDiscount: quote.discountTotal,
        payments: [{ method: 'cash', amount: quote.grandTotal }],
        cashierId: currentEmployee?.id || 'emp-admin',
        cashierName: currentEmployee?.name || 'النظام',
        shiftId: 'shift-current',
      });
      await dbLocal.sales.update(quote.id, { status: 'converted', updatedAt: new Date().toISOString() });
      await refreshAll();
      notify(`تم تحويل ${quote.invoiceNumber} إلى فاتورة بيع معتمدة`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر التحويل', 'error');
    }
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          {([
            { id: 'all', label: 'الكل' },
            { id: 'invoice', label: 'فواتير البيع' },
            { id: 'quotation', label: 'عروض الأسعار' },
            { id: 'sales_order', label: 'طلبات البيع' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setFilterType(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                filterType === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setNewQuoteOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" />
          <span>عرض سعر / طلب بيع جديد</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">رقم المستند</th>
              <th className="py-3 px-3">النوع</th>
              <th className="py-3 px-3">العميل</th>
              <th className="py-3 px-3">التاريخ</th>
              <th className="py-3 px-3">الإجمالي</th>
              <th className="py-3 px-3">المدفوع / المتبقي</th>
              <th className="py-3 px-3">الحالة</th>
              <th className="py-3 px-4 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-2.5 px-4 font-mono font-bold">{s.invoiceNumber}</td>
                <td className="py-2.5 px-3">
                  {s.docType === 'quotation' ? 'عرض سعر' : s.docType === 'sales_order' ? 'طلب بيع' : 'فاتورة ضريبية'}
                </td>
                <td className="py-2.5 px-3 font-semibold">{s.customerName}</td>
                <td className="py-2.5 px-3 font-mono text-slate-500">{new Date(s.createdAt).toLocaleDateString('ar-EG')}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums font-bold">{formatCurrency(s.grandTotal, cur, dec)}</td>
                <td className="py-2.5 px-3 font-mono tabular-nums">
                  <span className="text-emerald-600">{s.paidAmount.toFixed(dec)}</span>
                  {s.remainingAmount > 0 && (
                    <span className="text-rose-600"> · متبقي {s.remainingAmount.toFixed(dec)}</span>
                  )}
                </td>
                <td className="py-2.5 px-3">
                  <span
                    className={`font-semibold ${
                      s.status === 'completed'
                        ? 'text-emerald-600'
                        : s.status === 'cancelled'
                        ? 'text-rose-600'
                        : 'text-amber-600'
                    }`}
                  >
                    {s.status === 'completed'
                      ? 'مرحلة'
                      : s.status === 'cancelled'
                      ? 'ملغاة'
                      : s.status === 'converted'
                      ? 'محولة لفاتورة'
                      : 'معلقة / مسودة'}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center justify-end gap-1.5">
                    {s.docType !== 'invoice' && s.status !== 'converted' && (
                      <button
                        onClick={() => handleConvertToInvoice(s)}
                        className="flex items-center gap-1 rounded bg-[#0B1F3A] text-white px-2.5 py-1 text-[11px] font-semibold"
                        title="تحويل إلى فاتورة بيع"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>تحويل لفاتورة</span>
                      </button>
                    )}
                    <button
                      onClick={() => setEtaJsonInv(s)}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="بيانات الفاتورة الإلكترونية المصرية ETA"
                    >
                      <FileJson className="w-3.5 h-3.5 text-teal-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintInv(s)}
                      className="flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                      title="طباعة / PDF"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#0B1F3A] dark:text-teal-400" />
                      <span>طباعة</span>
                    </button>
                    {s.status === 'completed' && hasPermission('pos.cancel_invoice') && (
                      <button
                        onClick={async () => {
                          await cancelSaleInvoice(s.id, currentEmployee?.id || 'emp-admin', currentEmployee?.name || 'المدير');
                          await refreshAll();
                          notify('تم إلغاء الفاتورة', 'info');
                        }}
                        className="p-1.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                        title="إلغاء الفاتورة"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newQuoteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleCreateDoc} className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold">إنشاء عرض سعر أو طلب بيع</h3>
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'quotation' | 'sales_order')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <option value="quotation">عرض سعر (Quotation)</option>
              <option value="sales_order">طلب بيع (Sales Order)</option>
            </select>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={selectedProdId} onChange={(e) => setSelectedProdId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.salePrice} ج.م)</option>)}
            </select>
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setNewQuoteOpen(false)} className="px-3 py-1.5 border rounded-lg">إلغاء</button>
              <button type="submit" className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-lg">إنشاء</button>
            </div>
          </form>
        </div>
      )}

      {etaJsonInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold">بيانات الإيصال / الفاتورة الإلكترونية المصرية (ETA Ready)</h3>
            <pre dir="ltr" className="bg-slate-950 text-teal-300 p-3 rounded-lg overflow-x-auto text-[11px] font-mono">
              {JSON.stringify(
                {
                  issuer: {
                    name: settings?.storeName,
                    rin: settings?.taxNumber,
                    commercialRegister: settings?.commercialRegister,
                  },
                  receiptNumber: etaJsonInv.invoiceNumber,
                  uuid: etaJsonInv.eInvoiceUuid,
                  dateTimeIssued: etaJsonInv.createdAt,
                  currency: 'EGP',
                  totalSales: etaJsonInv.subtotal,
                  totalTax: etaJsonInv.taxTotal,
                  netAmount: etaJsonInv.grandTotal,
                  qrTlvBase64: etaJsonInv.etaQrPayload,
                },
                null,
                2
              )}
            </pre>
            <div className="flex justify-end">
              <button onClick={() => setEtaJsonInv(null)} className="px-4 py-1.5 rounded-lg bg-[#0B1F3A] text-white font-semibold">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {printInv && settings && (
        <InvoicePrintModal invoice={printInv} settings={settings} onClose={() => setPrintInv(null)} />
      )}
    </div>
  );
};
