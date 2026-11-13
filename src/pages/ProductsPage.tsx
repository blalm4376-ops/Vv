import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Plus,
  Search,
  Download,
  Upload,
  Barcode,
  Edit3,
  Trash2,
  Percent,
  Package,
} from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { computeProductTotalStock, formatCurrency, roundMoney } from '../services/erpEngine';
import { generateUUID } from '../lib/crypto';
import type { Product } from '../types/erp';
import { BarcodeModal } from '../components/BarcodeModal';

export const ProductsPage: React.FC = () => {
  const { settings, currentEmployee, hasPermission, notify, refreshAll } = useErp();
  const canManageProducts = hasPermission('products.manage');
  const canExportProducts = hasPermission('reports.export') || canManageProducts;
  const canSeePurchaseCost = canManageProducts || hasPermission('accounting.view') || hasPermission('purchases.manage');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('الكل');
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('الكل');
  const [bulkPct, setBulkPct] = useState(5);

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => dbLocal.products.filter((p) => !p.isDeleted).toArray(),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dbLocal.suppliers.toArray(),
  });

  const categories = useMemo(
    () => ['الكل', ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'الكل' && p.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryFilter]);

  const handleExportExcel = () => {
    const rows = products.map((p) => ({
      الكود: p.code,
      SKU: p.sku,
      الباركود: p.barcode,
      الاسم: p.name,
      التصنيف: p.category,
      الماركة: p.brand,
      بلد_المنشأ: p.originCountry,
      سعر_الشراء: p.purchasePrice,
      سعر_البيع: p.salePrice,
      سعر_الجملة: p.wholesalePrice,
      أقل_سعر: p.minSalePrice,
      الرصيد_الكلي: computeProductTotalStock(p),
      التشغيلة: p.batchNumber || '',
      الصلاحية: p.expiryDate || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `smart_pos_products_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify('تم تصدير قائمة المنتجات إلى Excel بنجاح', 'success');
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      const now = new Date().toISOString();
      let imported = 0;

      for (const r of rows) {
        const name = String(r['الاسم'] || r['name'] || '').trim();
        if (!name) continue;
        const id = `prod-${generateUUID().slice(0, 8)}`;
        await dbLocal.products.put({
          id,
          code: String(r['الكود'] || r['code'] || `PRD-${Date.now().toString().slice(-4)}`),
          sku: String(r['SKU'] || r['sku'] || id.toUpperCase()),
          name,
          barcode: String(r['الباركود'] || r['barcode'] || `${Math.floor(6220000000000 + Math.random() * 999999999)}`),
          extraBarcodes: [],
          category: String(r['التصنيف'] || r['category'] || 'عام'),
          brand: String(r['الماركة'] || ''),
          model: '',
          originCountry: String(r['بلد_المنشأ'] || 'مصر'),
          imageUrl: '',
          description: '',
          unit: 'قطعة',
          conversionFactor: 1,
          purchasePrice: Number(r['سعر_الشراء'] || 0),
          salePrice: Number(r['سعر_البيع'] || 0),
          wholesalePrice: Number(r['سعر_الجملة'] || r['سعر_البيع'] || 0),
          minSalePrice: Number(r['أقل_سعر'] || 0),
          taxRate: settings?.defaultTaxRate ?? 14,
          stockByWarehouse: { 'wh-main': Number(r['الرصيد_الكلي'] || 0) },
          reservedQty: 0,
          minStockAlert: 5,
          supplierId: suppliers[0]?.id || '',
          status: 'active',
          colors: [],
          sizes: [],
          serialNumbers: [],
          warrantyMonths: 0,
          priceHistory: [],
          isDeleted: false,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        imported++;
      }
      await refreshAll();
      notify(`تم استيراد ${imported} منتج من ملف Excel`, 'success');
    } catch {
      notify('تعذر قراءة ملف Excel', 'error');
    }
    e.target.value = '';
  };

  const handleBulkPriceUpdate = async () => {
    const targets = products.filter((p) => bulkCategory === 'الكل' || p.category === bulkCategory);
    const now = new Date().toISOString();
    for (const p of targets) {
      const nextPrice = roundMoney(p.salePrice * (1 + bulkPct / 100));
      await dbLocal.products.update(p.id, {
        salePrice: nextPrice,
        priceHistory: [
          ...p.priceHistory,
          {
            id: generateUUID().slice(0, 8),
            field: 'salePrice',
            oldPrice: p.salePrice,
            newPrice: nextPrice,
            changedBy: currentEmployee?.name || 'النظام',
            changedAt: now,
          },
        ],
        revision: p.revision + 1,
        updatedAt: now,
      });
    }
    setBulkModalOpen(false);
    await refreshAll();
    notify(`تم تحديث أسعار ${targets.length} منتج بنسبة ${bulkPct}%`, 'success');
  };

  const handleSoftDelete = async (p: Product) => {
    await dbLocal.products.update(p.id, { isDeleted: true, status: 'archived', updatedAt: new Date().toISOString() });
    await refreshAll();
    notify(`تم أرشفة المنتج "${p.name}" منطقياً`, 'info');
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct?.name) return;
    const now = new Date().toISOString();
    const isNew = !editingProduct.id;
    const existing = editingProduct.id ? await dbLocal.products.get(editingProduct.id) : null;
    const history = existing ? [...existing.priceHistory] : [];
    if (existing && existing.salePrice !== editingProduct.salePrice) {
      history.push({
        id: generateUUID().slice(0, 8),
        field: 'salePrice',
        oldPrice: existing.salePrice,
        newPrice: Number(editingProduct.salePrice || 0),
        changedBy: currentEmployee?.name || 'النظام',
        changedAt: now,
      });
    }

    const doc: Product = {
      id: editingProduct.id || `prod-${generateUUID().slice(0, 8)}`,
      code: editingProduct.code || `PRD-${Math.floor(1000 + Math.random() * 9000)}`,
      sku: editingProduct.sku || `SKU-${Date.now().toString().slice(-5)}`,
      name: editingProduct.name,
      barcode: editingProduct.barcode || `${Math.floor(6221000000000 + Math.random() * 99999999)}`,
      extraBarcodes: editingProduct.extraBarcodes || [],
      category: editingProduct.category || 'عام',
      brand: editingProduct.brand || '',
      model: editingProduct.model || '',
      originCountry: editingProduct.originCountry || 'مصر',
      imageUrl: editingProduct.imageUrl || '',
      description: editingProduct.description || '',
      unit: editingProduct.unit || 'قطعة',
      secondaryUnit: editingProduct.secondaryUnit || '',
      conversionFactor: Number(editingProduct.conversionFactor || 1),
      purchasePrice: Number(editingProduct.purchasePrice || 0),
      salePrice: Number(editingProduct.salePrice || 0),
      wholesalePrice: Number(editingProduct.wholesalePrice || editingProduct.salePrice || 0),
      minSalePrice: Number(editingProduct.minSalePrice || 0),
      taxRate: Number(editingProduct.taxRate ?? (settings?.defaultTaxRate || 14)),
      stockByWarehouse: editingProduct.stockByWarehouse || { 'wh-main': 0 },
      reservedQty: Number(editingProduct.reservedQty || 0),
      minStockAlert: Number(editingProduct.minStockAlert || 5),
      supplierId: editingProduct.supplierId || suppliers[0]?.id || '',
      status: editingProduct.status || 'active',
      colors: editingProduct.colors || [],
      sizes: editingProduct.sizes || [],
      batchNumber: editingProduct.batchNumber || '',
      expiryDate: editingProduct.expiryDate || '',
      serialNumbers: editingProduct.serialNumbers || [],
      warrantyMonths: Number(editingProduct.warrantyMonths || 0),
      priceHistory: history,
      isDeleted: false,
      revision: (existing?.revision || 0) + 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await dbLocal.products.put(doc);
    setEditingProduct(null);
    await refreshAll();
    notify(isNew ? 'تمت إضافة المنتج بنجاح' : 'تم تحديث بيانات المنتج', 'success');
  };

  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم، الكود، SKU، الباركود..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 py-2 text-xs"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageProducts && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportExcel}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>استيراد Excel</span>
              </button>
            </>
          )}
          {canExportProducts && (
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير Excel</span>
            </button>
          )}
          {canManageProducts && (
            <>
              <button
                onClick={() => setBulkModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Percent className="w-3.5 h-3.5 text-teal-600" />
                <span>تحديث أسعار</span>
              </button>
              <button
                onClick={() =>
                  setEditingProduct({
                    unit: 'قطعة',
                    conversionFactor: 1,
                    taxRate: settings?.defaultTaxRate ?? 14,
                    minStockAlert: 10,
                    stockByWarehouse: { 'wh-main': 0 },
                  })
                }
                className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white hover:bg-[#13325b]"
              >
                <Plus className="w-4 h-4" />
                <span>منتج جديد</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Products Data Grid */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4 font-semibold">المنتج</th>
                <th className="py-3 px-3 font-semibold">الكود / الباركود</th>
                <th className="py-3 px-3 font-semibold">التصنيف والماركة</th>
                {canSeePurchaseCost && <th className="py-3 px-3 font-semibold">سعر الشراء</th>}
                <th className="py-3 px-3 font-semibold">سعر البيع</th>
                <th className="py-3 px-3 font-semibold">الجملة</th>
                <th className="py-3 px-3 font-semibold">الرصيد</th>
                <th className="py-3 px-3 font-semibold">الصلاحية / الضمان</th>
                <th className="py-3 px-4 font-semibold text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((p) => {
                const total = computeProductTotalStock(p);
                return (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          ) : (
                            <Package className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {p.unit} {p.secondaryUnit ? `· ${p.secondaryUnit}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="font-semibold">{p.code}</div>
                      <div className="text-[11px] text-slate-500">{p.barcode}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div>{p.category}</div>
                      <div className="text-[11px] text-slate-500">{p.brand || p.originCountry}</div>
                    </td>
                    {canSeePurchaseCost && (
                      <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(p.purchasePrice, cur, dec)}</td>
                    )}
                    <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-teal-700 dark:text-teal-400">
                      {formatCurrency(p.salePrice, cur, dec)}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">{formatCurrency(p.wholesalePrice, cur, dec)}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      <span className={total <= p.minStockAlert ? 'text-amber-600 font-bold' : 'font-semibold'}>
                        {total} {p.unit}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-500">
                      {p.expiryDate ? `ينتهي: ${p.expiryDate}` : p.warrantyMonths > 0 ? `ضمان ${p.warrantyMonths} شهر` : '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setBarcodeProduct(p)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="طباعة باركود"
                        >
                          <Barcode className="w-3.5 h-3.5 text-teal-600" />
                        </button>
                        {canManageProducts && (
                          <>
                            <button
                              onClick={() => setEditingProduct(p)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="تعديل"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleSoftDelete(p)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              title="أرشفة منطقية"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-extrabold text-[#0B1F3A] dark:text-white">
              {editingProduct.id ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Field label="اسم المنتج *" value={editingProduct.name || ''} onChange={(v) => setEditingProduct({ ...editingProduct, name: v })} required />
              <Field label="الباركود" value={editingProduct.barcode || ''} onChange={(v) => setEditingProduct({ ...editingProduct, barcode: v })} />
              <Field label="الكود" value={editingProduct.code || ''} onChange={(v) => setEditingProduct({ ...editingProduct, code: v })} />
              <Field label="SKU" value={editingProduct.sku || ''} onChange={(v) => setEditingProduct({ ...editingProduct, sku: v })} />
              <Field label="التصنيف" value={editingProduct.category || ''} onChange={(v) => setEditingProduct({ ...editingProduct, category: v })} />
              <Field label="الماركة" value={editingProduct.brand || ''} onChange={(v) => setEditingProduct({ ...editingProduct, brand: v })} />
              <Field label="الوحدة" value={editingProduct.unit || 'قطعة'} onChange={(v) => setEditingProduct({ ...editingProduct, unit: v })} />
              <Field label="سعر الشراء" type="number" value={String(editingProduct.purchasePrice ?? 0)} onChange={(v) => setEditingProduct({ ...editingProduct, purchasePrice: Number(v) })} />
              <Field label="سعر البيع" type="number" value={String(editingProduct.salePrice ?? 0)} onChange={(v) => setEditingProduct({ ...editingProduct, salePrice: Number(v) })} />
              <Field label="سعر الجملة" type="number" value={String(editingProduct.wholesalePrice ?? 0)} onChange={(v) => setEditingProduct({ ...editingProduct, wholesalePrice: Number(v) })} />
              <Field label="أقل سعر بيع" type="number" value={String(editingProduct.minSalePrice ?? 0)} onChange={(v) => setEditingProduct({ ...editingProduct, minSalePrice: Number(v) })} />
              <Field label="نسبة الضريبة %" type="number" value={String(editingProduct.taxRate ?? 14)} onChange={(v) => setEditingProduct({ ...editingProduct, taxRate: Number(v) })} />
              <Field label="حد التنبيه للمخزون" type="number" value={String(editingProduct.minStockAlert ?? 5)} onChange={(v) => setEditingProduct({ ...editingProduct, minStockAlert: Number(v) })} />
              <Field label="رقم التشغيلة Batch" value={editingProduct.batchNumber || ''} onChange={(v) => setEditingProduct({ ...editingProduct, batchNumber: v })} />
              <Field label="تاريخ الصلاحية" type="date" value={editingProduct.expiryDate || ''} onChange={(v) => setEditingProduct({ ...editingProduct, expiryDate: v })} />
              <Field label="الضمان (بالأشهر)" type="number" value={String(editingProduct.warrantyMonths ?? 0)} onChange={(v) => setEditingProduct({ ...editingProduct, warrantyMonths: Number(v) })} />
            </div>

            {editingProduct.priceHistory && editingProduct.priceHistory.length > 0 && (
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs font-bold mb-1.5">سجل تغيرات الأسعار</div>
                <div className="space-y-1 max-h-24 overflow-y-auto text-[11px] text-slate-500">
                  {editingProduct.priceHistory.map((h) => (
                    <div key={h.id}>
                      {h.oldPrice} ← {h.newPrice} ({h.changedBy} · {h.changedAt.slice(0, 10)})
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-lg bg-teal-600 px-5 py-2 text-xs font-bold text-white hover:bg-teal-700"
              >
                حفظ المنتج
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Price Update Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h3 className="text-base font-bold">تحديث أسعار المجموعات</h3>
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <Field label="نسبة التعديل (%)" type="number" value={String(bulkPct)} onChange={(v) => setBulkPct(Number(v))} />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setBulkModalOpen(false)} className="px-3 py-1.5 text-xs border rounded-lg">إلغاء</button>
              <button onClick={handleBulkPriceUpdate} className="px-4 py-1.5 text-xs font-bold bg-[#0B1F3A] text-white rounded-lg">تطبيق</button>
            </div>
          </div>
        </div>
      )}

      {barcodeProduct && (
        <BarcodeModal product={barcodeProduct} onClose={() => setBarcodeProduct(null)} />
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  required?: boolean;
}> = ({ label, value, onChange, type = 'text', required }) => (
  <label className="block">
    <span className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">{label}</span>
    <input
      type={type}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
    />
  </label>
);
