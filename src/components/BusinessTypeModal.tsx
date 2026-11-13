import React, { useEffect, useState } from 'react';
import { Store, Pill, ShoppingBag, Check, PenLine, Ban } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { auth, ensureUserAndStoreInFirestore } from '../lib/firebase';
import type { BusinessType } from '../types/erp';

interface BusinessTypeModalProps {
  open: boolean;
  onClose: () => void;
}

const BUSINESS_OPTIONS: Array<{
  type: BusinessType;
  title: string;
  subtitle: string;
  features: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    type: 'supermarket',
    title: 'سوبر ماركت وبقالة',
    subtitle: 'تركيز على السرعة، الباركود الموزون، والوحدات المتعددة',
    features: 'دعم الكراتين والعبوات · تنبيهات الصلاحية · اختصارات كاشير سريعة',
    icon: ShoppingBag,
  },
  {
    type: 'pharmacy',
    title: 'صيدلية ومستحضرات طبية',
    subtitle: 'تتبع دقيق للتشغيلات وتواريخ الانتهاء والسلع المعفاة',
    features: 'رقم التشغيلة Batch · تنبيه انتهاء الصلاحية · ضريبة 0% للأدوية',
    icon: Pill,
  },
  {
    type: 'retail',
    title: 'محل تجاري وإلكترونيات وملابس',
    subtitle: 'دعم الألوان والمقاسات والأرقام التسلسلية والضمان',
    features: 'تتبع Serial Number · مدد الضمان · قوائم أسعار الجملة والقطاعي',
    icon: Store,
  },
];

export const BusinessTypeModal: React.FC<BusinessTypeModalProps> = ({ open, onClose }) => {
  const { settings, refreshAll, notify } = useErp();
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    if (open && settings) {
      setCustomName(settings.customBusinessType || '');
    }
  }, [open, settings]);

  if (!open || !settings) return null;

  const persistBusinessType = async (
    type: BusinessType,
    customText: string,
    selected: boolean,
    toastMessage: string
  ) => {
    await dbLocal.settings.update('main', {
      businessType: type,
      customBusinessType: customText,
      businessTypeSelected: selected,
    });
    if (auth.currentUser?.emailVerified) {
      await ensureUserAndStoreInFirestore(
        auth.currentUser,
        `store_${auth.currentUser.uid}`,
        settings.storeName,
        type,
        settings.taxNumber,
        settings.commercialRegister,
        customText
      ).catch(() => {});
    }
    await refreshAll();
    notify(toastMessage, 'success');
    onClose();
  };

  const handleSelectPreset = async (type: BusinessType) => {
    await persistBusinessType(
      type,
      '',
      true,
      'تم تخصيص واجهات وخصائص النظام وفق النشاط التجاري المختار'
    );
  };

  const handleSaveCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customName.trim();
    if (!trimmed) {
      notify('يرجى كتابة اسم النشاط التجاري أو اختيار إلغاء النشاط', 'error');
      return;
    }
    await persistBusinessType('custom', trimmed, true, `تم اعتماد النشاط التجاري: ${trimmed}`);
  };

  const handleCancelBusinessType = async () => {
    await persistBusinessType('none', '', false, 'تم إلغاء تحديد النشاط التجاري');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0B1F3A] dark:text-white">
          طبيعة النشاط التجاري
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-5">
          اختر نشاطاً جاهزاً أو اكتب اسم نشاطك التجاري بنفسك، ويمكنك إلغاء النشاط في أي وقت.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {BUSINESS_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = settings.businessType === opt.type;
            return (
              <button
                key={opt.type}
                type="button"
                onClick={() => handleSelectPreset(opt.type)}
                className={`text-right rounded-xl border p-4 transition-colors flex flex-col justify-between ${
                  active
                    ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0B1F3A] text-white flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    {active && <Check className="w-5 h-5 text-teal-600" />}
                  </div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">{opt.title}</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{opt.subtitle}</p>
                </div>
                <p className="text-[11px] text-teal-700 dark:text-teal-400 mt-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  {opt.features}
                </p>
              </button>
            );
          })}
        </div>

        {/* Custom Business Type Form */}
        <form
          onSubmit={handleSaveCustom}
          className={`mt-4 rounded-xl border p-4 transition-colors ${
            settings.businessType === 'custom'
              ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/20'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <PenLine className="w-4 h-4 text-teal-600 shrink-0" />
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              أو اكتب النشاط التجاري بنفسك
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              maxLength={100}
              placeholder="مثال: كافيه ومطعم، مركز صيانة، مكتبة وأدوات..."
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-xs font-bold whitespace-nowrap shrink-0"
            >
              حفظ النشاط المخصص
            </button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCancelBusinessType}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              settings.businessType === 'none'
                ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                : 'border-slate-300 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>إلغاء تحديد النشاط (بدون نشاط)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
