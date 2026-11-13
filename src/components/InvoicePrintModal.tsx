import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, FileText, Receipt, Download } from 'lucide-react';
import type { SaleInvoice, StoreSettings } from '../types/erp';
import { formatCurrency } from '../services/erpEngine';

interface InvoicePrintModalProps {
  invoice: SaleInvoice;
  settings: StoreSettings;
  onClose: () => void;
  documentLabel?: string;
  partyLabel?: string;
  operatorLabel?: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة بنكية',
  wallet: 'محفظة إلكترونية',
  transfer: 'تحويل بنكي',
  credit: 'آجل على الحساب',
};

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({
  invoice,
  settings,
  onClose,
  documentLabel,
  partyLabel = 'العميل',
  operatorLabel = 'الكاشير',
}) => {
  const [format, setFormat] = useState<'58mm' | '80mm' | 'A4'>(settings.printerWidth || '80mm');
  const [logoError, setLogoError] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLogoError(false);
  }, [settings.storeLogoUrl]);

  useEffect(() => {
    document.body.classList.add('printing-modal');
    return () => {
      document.body.classList.remove('printing-modal');
    };
  }, []);

  const widthClass =
    format === '58mm' ? 'max-w-[260px]' : format === '80mm' ? 'max-w-[340px]' : 'max-w-3xl';

  const handlePrint = () => {
    document.body.classList.add('printing-modal');
    try {
      window.focus();
      window.print();
    } catch {
      // Fallback: download standalone printable HTML if browser restricts print()
      handleDownloadPrintableHtml();
    }
  };

  const handleDownloadPrintableHtml = () => {
    const contentHtml = sheetRef.current?.outerHTML || '';
    const pageWidth = format === '58mm' ? '58mm' : format === '80mm' ? '80mm' : '210mm';
    const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة ${invoice.invoiceNumber}</title>
  <style>
    @page { size: ${format === 'A4' ? 'A4' : `${pageWidth} auto`}; margin: 5mm; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Cairo', sans-serif; }
    body { margin: 0; padding: 12px; background: #fff; color: #0f172a; }
    .print-sheet { width: ${format === 'A4' ? '100%' : pageWidth}; max-width: 100%; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 5px 4px; border-bottom: 1px solid #e2e8f0; }
    .text-center { text-align: center; }
    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .flex { display: flex; }
    .justify-between { justify-content: space-between; }
    .justify-center { justify-content: center; }
    .grid { display: grid; }
    .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
    .font-bold, .font-semibold, .font-extrabold { font-weight: 700; }
    .font-mono { font-family: monospace; }
    img { max-height: 56px; width: auto; object-fit: contain; }
  </style>
</head>
<body onload="window.print()">
  ${contentHtml}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-${invoice.invoiceNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const docTitle =
    documentLabel ||
    (invoice.docType === 'quotation'
      ? 'عرض سعر'
      : invoice.docType === 'sales_order'
      ? 'طلب بيع'
      : 'فاتورة ضريبية');

  const modalContent = (
    <div className="print-portal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="print-portal-dialog w-full max-w-4xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 no-print">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              معاينة وطباعة {docTitle} — {invoice.invoiceNumber}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {(['58mm', '80mm', 'A4'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFormat(mode)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    format === mode
                      ? 'bg-[#0B1F3A] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
                >
                  {mode === 'A4' ? 'ورق A4 / PDF' : `حراري ${mode}`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / حفظ PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPrintableHtml}
              title="تنزيل نسخة جاهزة للطباعة"
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="print-portal-scroll p-6 bg-slate-100 dark:bg-slate-950 flex justify-center overflow-y-auto max-h-[78vh]">
          <div
            ref={sheetRef}
            data-print-format={format}
            className={`print-sheet ${widthClass} w-full bg-white text-slate-900 p-5 border border-slate-300 rounded-lg shadow-sm`}
          >
            <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
              <div className="flex justify-center mb-1.5">
                {settings.storeLogoUrl && !logoError ? (
                  <img
                    src={settings.storeLogoUrl}
                    alt={settings.storeName}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoError(true)}
                    className="max-h-14 w-auto object-contain rounded"
                  />
                ) : format === 'A4' ? (
                  <FileText className="w-7 h-7 text-[#0B1F3A]" />
                ) : (
                  <Receipt className="w-6 h-6 text-[#0B1F3A]" />
                )}
              </div>
              <h4 className="text-base font-extrabold text-[#0B1F3A]">{settings.storeName}</h4>
              <div className="text-[11px] font-bold text-teal-700 mt-0.5">{docTitle}</div>
              <p className="text-xs text-slate-600 mt-0.5">{settings.address}</p>
              <p className="text-xs text-slate-600 tabular-nums font-mono">
                هاتف: {settings.phone} · ر.ض: {settings.taxNumber}
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                س.ت: {settings.commercialRegister}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-y-1 text-xs mb-3 border-b border-slate-200 pb-3">
              <div>
                <span className="text-slate-500">رقم المستند: </span>
                <span className="font-mono font-bold">{invoice.invoiceNumber}</span>
              </div>
              <div className="text-left">
                <span className="text-slate-500">التاريخ: </span>
                <span className="font-mono tabular-nums">
                  {new Date(invoice.createdAt).toLocaleString('ar-EG')}
                </span>
              </div>
              <div>
                <span className="text-slate-500">{partyLabel}: </span>
                <span className="font-semibold">{invoice.customerName}</span>
              </div>
              <div className="text-left">
                <span className="text-slate-500">{operatorLabel}: </span>
                <span>{invoice.cashierName}</span>
              </div>
            </div>

            <table className="w-full text-xs border-collapse mb-3">
              <thead>
                <tr className="border-b border-slate-300 text-slate-600">
                  <th className="py-1.5 text-right font-semibold">الصنف</th>
                  <th className="py-1.5 text-center font-semibold">ك</th>
                  <th className="py-1.5 text-center font-semibold">سعر</th>
                  <th className="py-1.5 text-left font-semibold">إجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {invoice.items.map((item, idx) => (
                  <tr key={`${item.productId}-${idx}`}>
                    <td className="py-1.5 pr-0.5">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      {item.discount > 0 && (
                        <div className="text-[10px] text-slate-500">
                          خصم: {formatCurrency(item.discount, settings.currency, settings.decimalPlaces)}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 text-center font-mono tabular-nums">{item.qty}</td>
                    <td className="py-1.5 text-center font-mono tabular-nums">
                      {item.price.toFixed(settings.decimalPlaces)}
                    </td>
                    <td className="py-1.5 text-left font-mono tabular-nums font-semibold">
                      {item.total.toFixed(settings.decimalPlaces)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-dashed border-slate-300 pt-2.5 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">المجموع الفرعي</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(invoice.subtotal, settings.currency, settings.decimalPlaces)}
                </span>
              </div>
              {invoice.discountTotal > 0 && (
                <div className="flex justify-between text-teal-700">
                  <span>إجمالي الخصم</span>
                  <span className="font-mono tabular-nums">
                    -{formatCurrency(invoice.discountTotal, settings.currency, settings.decimalPlaces)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">ضريبة القيمة المضافة</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(invoice.taxTotal, settings.currency, settings.decimalPlaces)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-[#0B1F3A] border-t border-slate-200 pt-1.5">
                <span>الإجمالي النهائي</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(invoice.grandTotal, settings.currency, settings.decimalPlaces)}
                </span>
              </div>
              <div className="flex justify-between text-xs pt-1">
                <span className="text-slate-600">المدفوع</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(invoice.paidAmount, settings.currency, settings.decimalPlaces)}
                </span>
              </div>
              {invoice.remainingAmount > 0 && (
                <div className="flex justify-between text-xs text-rose-700 font-semibold">
                  <span>المتبقي (آجل)</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(invoice.remainingAmount, settings.currency, settings.decimalPlaces)}
                  </span>
                </div>
              )}
            </div>

            {invoice.payments.length > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                <span className="font-semibold">طرق الدفع: </span>
                {invoice.payments
                  .map(
                    (p) =>
                      `${PAYMENT_LABELS[p.method] || p.method}: ${p.amount.toFixed(settings.decimalPlaces)}`
                  )
                  .join(' · ')}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-dashed border-slate-300 text-center space-y-1.5">
              {invoice.eInvoiceUuid && (
                <div className="text-[10px] font-mono text-slate-500 break-all bg-slate-50 p-1.5 rounded border border-slate-200">
                  ETA UUID: {invoice.eInvoiceUuid}
                </div>
              )}
              {invoice.etaQrPayload && (
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  QR TLV: {invoice.etaQrPayload}
                </div>
              )}
              <p className="text-[11px] text-slate-600 mt-2">{settings.invoiceFooter}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
