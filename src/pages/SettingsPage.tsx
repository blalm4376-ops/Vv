import React, { useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, Play, Save, Store, Trash2, Ban } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { auth, ensureUserAndStoreInFirestore } from '../lib/firebase';
import {
  computeSaleTotals,
  verifyJournalBalance,
} from '../services/erpEngine';
import { buildEtaQrTlvBase64, generateIdempotencyKey } from '../lib/crypto';
import type { BusinessType, StoreSettings } from '../types/erp';

function resizeLogoToDataUrl(file: File, maxSize = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ملف الصورة غير صالح'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const SettingsPage: React.FC = () => {
  const { settings, notify, refreshAll } = useErp();
  const [form, setForm] = useState<StoreSettings | null>(settings);
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [testResults, setTestResults] = useState<Array<{ name: string; pass: boolean; detail: string }>>([]);

  useEffect(() => {
    if (settings) {
      setForm(settings);
      setLogoImgFailed(false);
    }
  }, [settings]);

  if (!form) return null;

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeLogoToDataUrl(file, 240);
      setLogoImgFailed(false);
      setForm((prev) => (prev ? { ...prev, storeLogoUrl: dataUrl } : prev));
      notify('تم تجهيز شعار المكان — اضغط حفظ الإعدادات لتأكيده', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر تحميل الشعار', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedCustom =
      form.businessType === 'custom' ? (form.customBusinessType || '').trim() : '';
    if (form.businessType === 'custom' && !cleanedCustom) {
      notify('يرجى كتابة اسم النشاط التجاري المخصص أو اختيار إلغاء النشاط', 'error');
      return;
    }

    const updated: StoreSettings = {
      ...form,
      customBusinessType: cleanedCustom,
      businessTypeSelected: form.businessType !== 'none',
    };

    await dbLocal.settings.put(updated);

    if (auth.currentUser?.emailVerified) {
      await ensureUserAndStoreInFirestore(
        auth.currentUser,
        `store_${auth.currentUser.uid}`,
        updated.storeName,
        updated.businessType,
        updated.taxNumber,
        updated.commercialRegister,
        updated.customBusinessType
      ).catch(() => {});
    }

    await refreshAll();
    notify('تم حفظ إعدادات المنشأة والضرائب بنجاح', 'success');
  };

  const runSelfVerification = async () => {
    const results: Array<{ name: string; pass: boolean; detail: string }> = [];

    const taxTest = computeSaleTotals([{ qty: 2, price: 100, discount: 0, taxRate: 14 }], 0, true);
    results.push({
      name: 'حساب ضريبة القيمة المضافة المصرية 14%',
      pass: taxTest.subtotal === 200 && taxTest.taxTotal === 28 && taxTest.grandTotal === 228,
      detail: `الإجمالي ${taxTest.grandTotal} ج.م`,
    });

    const jeCheck = verifyJournalBalance([
      { accountId: 'a', accountCode: '1101', accountName: 'نقدية', debit: 228, credit: 0 },
      { accountId: 'b', accountCode: '4101', accountName: 'مبيعات', debit: 0, credit: 200 },
      { accountId: 'c', accountCode: '2201', accountName: 'ضريبة', debit: 0, credit: 28 },
    ]);
    results.push({
      name: 'توازن القيد المزدوج (Double Entry)',
      pass: jeCheck.balanced && jeCheck.totalDebit === 228,
      detail: `مدين ${jeCheck.totalDebit} = دائن ${jeCheck.totalCredit}`,
    });

    const tlv = buildEtaQrTlvBase64({
      sellerName: form.storeName,
      taxNumber: form.taxNumber,
      timestamp: new Date().toISOString(),
      totalWithVat: '228.00',
      vatAmount: '28.00',
    });
    results.push({
      name: 'توليد رمز QR TLV للإيصال الإلكتروني (ETA)',
      pass: tlv.length > 20,
      detail: `طول الحمولة ${tlv.length} حرف Base64`,
    });

    const key1 = generateIdempotencyKey('pos');
    const key2 = generateIdempotencyKey('pos');
    results.push({
      name: 'توليد مفاتيح منع التكرار (Idempotency Keys)',
      pass: key1 !== key2 && key1.startsWith('pos_'),
      detail: key1,
    });

    const prodCount = await dbLocal.products.count();
    results.push({
      name: 'جاهزية قاعدة IndexedDB (Dexie.js)',
      pass: prodCount > 0,
      detail: `${prodCount} منتج مخزن محلياً`,
    });

    setTestResults(results);
    notify('اكتمل فحص سلامة النظام والمحاسبة', 'success');
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-extrabold text-[#0B1F3A] dark:text-white">
              إعدادات المتجر ومتطلبات الضرائب المصرية (ETA)
            </h2>
            <p className="text-slate-500 mt-0.5">تهيئة اللوجو، النشاط التجاري، الفاتورة الإلكترونية، والطابعات</p>
          </div>
          <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-teal-600 text-white px-5 py-2 font-bold hover:bg-teal-700 whitespace-nowrap shrink-0">
            <Save className="w-4 h-4" />
            <span>حفظ الإعدادات</span>
          </button>
        </div>

        {/* Store Logo Section */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
              {form.storeLogoUrl && !logoImgFailed ? (
                <img
                  src={form.storeLogoUrl}
                  alt="شعار المكان"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgFailed(true)}
                  className="w-full h-full object-contain p-1"
                />
              ) : (
                <Store className="w-8 h-8 text-slate-400" />
              )}
            </div>

            <div className="flex-1 space-y-2.5">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  لوجو / شعار المكان
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  يظهر في القائمة الجانبية ولوحة التحكم وأعلى الفواتير والإيصالات المطبوعة
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] hover:bg-[#133159] text-white px-3.5 py-2 font-semibold transition-colors whitespace-nowrap shrink-0">
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>رفع صورة الشعار</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileChange}
                    className="hidden"
                  />
                </label>

                {form.storeLogoUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoImgFailed(false);
                      setForm({ ...form, storeLogoUrl: '' });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-3 py-2 font-semibold whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف الشعار</span>
                  </button>
                )}
              </div>

              <input
                type="text"
                value={form.storeLogoUrl || ''}
                onChange={(e) => {
                  setLogoImgFailed(false);
                  setForm({ ...form, storeLogoUrl: e.target.value });
                }}
                placeholder="أو الصق رابط صورة اللوجو (https://...)"
                dir="ltr"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="اسم المتجر / المنشأة" value={form.storeName} onChange={(v) => setForm({ ...form, storeName: v })} />
          <Input label="الاسم بالإنجليزية" value={form.storeNameEn} onChange={(v) => setForm({ ...form, storeNameEn: v })} />
          <Input label="العنوان" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Input label="رقم الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Input label="الرقم الضريبي (RIN)" value={form.taxNumber} onChange={(v) => setForm({ ...form, taxNumber: v })} />
          <Input label="السجل التجاري" value={form.commercialRegister} onChange={(v) => setForm({ ...form, commercialRegister: v })} />

          <div className="space-y-2">
            <label className="block">
              <span className="block font-semibold mb-1">طبيعة النشاط التجاري</span>
              <div className="flex items-center gap-2">
                <select
                  value={form.businessType}
                  onChange={(e) => {
                    const nextType = e.target.value as BusinessType;
                    setForm({
                      ...form,
                      businessType: nextType,
                      customBusinessType: nextType === 'custom' ? form.customBusinessType || '' : '',
                    });
                  }}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="supermarket">سوبر ماركت وبقالة</option>
                  <option value="pharmacy">صيدلية ومستحضرات طبية</option>
                  <option value="retail">محل تجاري وإلكترونيات</option>
                  <option value="custom">نشاط مخصص (أكتبه بنفسي)</option>
                  <option value="none">إلغاء / بدون نشاط محدد</option>
                </select>
                {form.businessType !== 'none' && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, businessType: 'none', customBusinessType: '', businessTypeSelected: false })
                    }
                    title="إلغاء النشاط التجاري"
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-800 px-2.5 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap shrink-0"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>إلغاء</span>
                  </button>
                )}
              </div>
            </label>

            {form.businessType === 'custom' && (
              <label className="block">
                <span className="block font-semibold mb-1 text-teal-700 dark:text-teal-400">
                  اكتب اسم النشاط التجاري
                </span>
                <input
                  type="text"
                  maxLength={100}
                  value={form.customBusinessType || ''}
                  onChange={(e) => setForm({ ...form, customBusinessType: e.target.value })}
                  placeholder="مثال: مطعم وكافيه، مكتبة، ورشة صيانة..."
                  className="w-full rounded-lg border border-teal-500 bg-white dark:bg-slate-800 px-3 py-2"
                />
              </label>
            )}
          </div>

          <label className="block">
            <span className="block font-semibold mb-1">حجم طابعة الفواتير</span>
            <select
              value={form.printerWidth}
              onChange={(e) => setForm({ ...form, printerWidth: e.target.value as StoreSettings['printerWidth'] })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800"
            >
              <option value="80mm">طابعة حرارية 80mm</option>
              <option value="58mm">طابعة حرارية 58mm</option>
              <option value="A4">طابعة مكتبية A4 / PDF</option>
            </select>
          </label>

          <Input label="العملة" value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
          <Input label="نسبة الضريبة الافتراضية (%)" type="number" value={String(form.defaultTaxRate)} onChange={(v) => setForm({ ...form, defaultTaxRate: Number(v) })} />
          <Input label="أقصى خصم للكاشير (%)" type="number" value={String(form.maxCashierDiscountPct)} onChange={(v) => setForm({ ...form, maxCashierDiscountPct: Number(v) })} />
          <label className="block">
            <span className="block font-semibold mb-1">طريقة تقييم المخزون</span>
            <select
              value={form.valuationMethod}
              onChange={(e) => setForm({ ...form, valuationMethod: e.target.value as 'weighted_avg' | 'fifo' })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800"
            >
              <option value="weighted_avg">المتوسط المرجح (Weighted Average)</option>
              <option value="fifo">الوارد أولاً صادر أولاً (FIFO)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <Check label="تفعيل ضريبة القيمة المضافة (VAT)" checked={form.vatEnabled} onChange={(c) => setForm({ ...form, vatEnabled: c })} />
          <Check label="منع البيع عند نفاد المخزون" checked={form.preventNegativeStock} onChange={(c) => setForm({ ...form, preventNegativeStock: c })} />
          <Check label="منع فتح ورديتين متعارضتين" checked={form.preventConflictingShifts} onChange={(c) => setForm({ ...form, preventConflictingShifts: c })} />
          <Check label="السماح بالبيع الآجل للعملاء" checked={form.allowCreditSales} onChange={(c) => setForm({ ...form, allowCreditSales: c })} />
          <Check label="تفعيل المزامنة التلقائية عند الاتصال" checked={form.autoSyncEnabled} onChange={(c) => setForm({ ...form, autoSyncEnabled: c })} />
          <Check label="المصادقة بخطوتين (2FA) للعمليات الحساسة" checked={form.twoFactorEnabled} onChange={(c) => setForm({ ...form, twoFactorEnabled: c })} />
        </div>
      </form>

      {/* Built-in Verification Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">اختبارات التحقق والجودة الفورية</h3>
            <p className="text-slate-500">تحقق من الضرائب، توازن القيد المزدوج، باركود ETA، وIndexedDB</p>
          </div>
          <button
            onClick={runSelfVerification}
            className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] text-white px-4 py-2 font-bold"
          >
            <Play className="w-3.5 h-3.5" />
            <span>تشغيل الفحص الآن</span>
          </button>
        </div>

        {testResults.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t pt-2">
            {testResults.map((r, i) => (
              <div key={i} className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className={`w-4 h-4 ${r.pass ? 'text-emerald-600' : 'text-rose-600'}`} />
                  <span>{r.name}</span>
                </div>
                <span className="font-mono text-slate-500">{r.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Input: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({
  label,
  value,
  onChange,
  type = 'text',
}) => (
  <label className="block">
    <span className="block font-semibold mb-1">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
    />
  </label>
);

const Check: React.FC<{ label: string; checked: boolean; onChange: (c: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded text-teal-600" />
    <span>{label}</span>
  </label>
);
