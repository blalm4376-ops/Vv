import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Barcode,
  Trash2,
  Plus,
  Minus,
  PauseCircle,
  PlayCircle,
  CreditCard,
  Printer,
  UserPlus,
  Package,
  XCircle,
  Check,
} from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import {
  cancelSaleInvoice,
  computeSaleTotals,
  formatCurrency,
  processSaleInvoice,
  roundMoney,
} from '../services/erpEngine';
import { generateIdempotencyKey } from '../lib/crypto';
import type { PaymentMethod, PaymentSplit, Product, SaleInvoice, SaleLineItem } from '../types/erp';
import { InvoicePrintModal } from '../components/InvoicePrintModal';

export const PosPage: React.FC = () => {
  const { settings, currentEmployee, hasPermission, notify, refreshAll } = useErp();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('wh-main');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('cust-walkin');
  const [cart, setCart] = useState<SaleLineItem[]>([]);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number>(0);
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [heldModalOpen, setHeldModalOpen] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<SaleInvoice | null>(null);
  const [lastInvoice, setLastInvoice] = useState<SaleInvoice | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateIdempotencyKey('pos'));

  // Split payment state
  const [payCash, setPayCash] = useState<number>(0);
  const [payCard, setPayCard] = useState<number>(0);
  const [payWallet, setPayWallet] = useState<number>(0);
  const [payTransfer, setPayTransfer] = useState<number>(0);
  const [payCredit, setPayCredit] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => dbLocal.products.filter((p) => !p.isDeleted && p.status === 'active').toArray(),
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => dbLocal.warehouses.toArray(),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => dbLocal.customers.toArray(),
  });
  const { data: heldInvoices = [] } = useQuery({
    queryKey: ['heldInvoices'],
    queryFn: () => dbLocal.sales.where('status').equals('held').toArray(),
  });
  const { data: activeShift } = useQuery({
    queryKey: ['activeShift'],
    queryFn: () => dbLocal.shifts.where('status').equals('open').first(),
  });
  const { data: latestCompletedSale } = useQuery({
    queryKey: ['latestCompletedSale'],
    queryFn: async () => {
      const list = await dbLocal.sales
        .filter((s) => s.docType === 'invoice' && s.status === 'completed')
        .toArray();
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return list[0] || null;
    },
  });

  const printableInvoice = lastInvoice || latestCompletedSale || null;

  const handlePrintLastInvoice = () => {
    if (previewInvoice) {
      window.print();
      return;
    }
    if (!printableInvoice) {
      notify('لا توجد فواتير مكتملة للطباعة بعد', 'info');
      return;
    }
    setPreviewInvoice(printableInvoice);
  };

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category)));
    return ['الكل', ...cats];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const catOk = selectedCategory === 'الكل' || p.category === selectedCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.extraBarcodes.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [products, search, selectedCategory]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const vatEnabled = settings?.vatEnabled ?? true;

  const totals = useMemo(
    () => computeSaleTotals(cart, invoiceDiscount, vatEnabled),
    [cart, invoiceDiscount, vatEnabled]
  );

  const addProductToCart = (prod: Product) => {
    const stock = prod.stockByWarehouse[selectedWarehouseId] || 0;
    if (settings?.preventNegativeStock && stock <= 0) {
      notify(`نفد مخزون "${prod.name}" في المخزن المحدد`, 'error');
      return;
    }

    const useWholesale = selectedCustomer?.tier === 'wholesale';
    const unitPrice = useWholesale ? prod.wholesalePrice : prod.salePrice;

    setCart((prev) => {
      const existingIdx = prev.findIndex((i) => i.productId === prod.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        const target = next[existingIdx];
        if (settings?.preventNegativeStock && target.qty + 1 > stock) {
          notify(`الكمية المتاحة (${stock}) فقط`, 'error');
          return prev;
        }
        const newQty = target.qty + 1;
        const gross = newQty * target.price - target.discount;
        const taxAmount = vatEnabled ? roundMoney(gross * (target.taxRate / 100)) : 0;
        next[existingIdx] = {
          ...target,
          qty: newQty,
          taxAmount,
          total: roundMoney(gross + taxAmount),
        };
        setSelectedRowIdx(existingIdx);
        return next;
      }

      const taxAmount = vatEnabled ? roundMoney(unitPrice * (prod.taxRate / 100)) : 0;
      const newLine: SaleLineItem = {
        productId: prod.id,
        code: prod.code,
        name: prod.name,
        barcode: prod.barcode,
        qty: 1,
        unit: prod.unit,
        price: unitPrice,
        costPrice: prod.purchasePrice,
        discount: 0,
        taxRate: prod.taxRate,
        taxAmount,
        total: roundMoney(unitPrice + taxAmount),
        batchNumber: prod.batchNumber,
      };
      setSelectedRowIdx(prev.length);
      return [...prev, newLine];
    });
  };

  const updateCartItem = (idx: number, patch: Partial<SaleLineItem>) => {
    setCart((prev) => {
      const next = [...prev];
      const item = { ...next[idx], ...patch };
      const prod = products.find((p) => p.id === item.productId);
      if (prod && settings?.preventNegativeStock) {
        const avail = prod.stockByWarehouse[selectedWarehouseId] || 0;
        if (item.qty > avail) {
          notify(`الكمية المتاحة من "${prod.name}" هي ${avail}`, 'error');
          return prev;
        }
      }
      if (prod && item.price < prod.minSalePrice && !hasPermission('pos.edit_price')) {
        notify(`الحد الأدنى لسعر البيع هو ${prod.minSalePrice}`, 'error');
        return prev;
      }
      const gross = Math.max(0, item.qty * item.price - item.discount);
      item.taxAmount = vatEnabled ? roundMoney(gross * (item.taxRate / 100)) : 0;
      item.total = roundMoney(gross + item.taxAmount);
      next[idx] = item;
      return next;
    });
  };

  const removeCartItem = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
    setSelectedRowIdx((prevIdx) => Math.max(0, prevIdx - 1));
  };

  const openPaymentModal = () => {
    if (cart.length === 0) {
      notify('سلة البيع فارغة', 'info');
      return;
    }
    setPayCash(totals.grandTotal);
    setPayCard(0);
    setPayWallet(0);
    setPayTransfer(0);
    setPayCredit(0);
    setPaymentModalOpen(true);
  };

  const handleHoldInvoice = async () => {
    if (cart.length === 0) {
      notify('لا توجد أصناف لتعليقها', 'info');
      return;
    }
    try {
      await processSaleInvoice({
        docType: 'invoice',
        status: 'held',
        customerId: selectedCustomerId,
        warehouseId: selectedWarehouseId,
        items: cart,
        invoiceDiscount,
        payments: [],
        cashierId: currentEmployee?.id || 'emp-admin',
        cashierName: currentEmployee?.name || 'النظام',
        shiftId: activeShift?.id || 'shift-current',
        idempotencyKey,
      });
      setCart([]);
      setInvoiceDiscount(0);
      setIdempotencyKey(generateIdempotencyKey('pos'));
      notify('تم تعليق الفاتورة بنجاح', 'success');
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'خطأ في تعليق الفاتورة', 'error');
    }
  };

  const handleResumeHeld = async (held: SaleInvoice) => {
    setCart(held.items);
    setSelectedCustomerId(held.customerId);
    setSelectedWarehouseId(held.warehouseId);
    setInvoiceDiscount(held.discountTotal);
    await dbLocal.sales.delete(held.id);
    setHeldModalOpen(false);
    await refreshAll();
    notify(`تم استكمال الفاتورة ${held.invoiceNumber}`, 'info');
  };

  const handleCompleteSale = async () => {
    if (isSubmitting) return;
    const maxDisc = ((settings?.maxCashierDiscountPct || 100) / 100) * totals.subtotal;
    if (invoiceDiscount > maxDisc && !hasPermission('pos.edit_price')) {
      notify(`تجاوز حد الخصم المسموح للكاشير (${settings?.maxCashierDiscountPct}%)`, 'error');
      return;
    }

    const totalTendered = roundMoney(payCash + payCard + payWallet + payTransfer + payCredit);
    if (totalTendered < totals.grandTotal - 0.01) {
      notify('المبلغ المدفوع أقل من إجمالي الفاتورة', 'error');
      return;
    }

    const splits: PaymentSplit[] = [];
    const nonCash = payCard + payWallet + payTransfer + payCredit;
    const effectiveCash = Math.max(0, roundMoney(totals.grandTotal - nonCash));
    if (effectiveCash > 0) splits.push({ method: 'cash', amount: effectiveCash });
    if (payCard > 0) splits.push({ method: 'card', amount: payCard });
    if (payWallet > 0) splits.push({ method: 'wallet', amount: payWallet });
    if (payTransfer > 0) splits.push({ method: 'transfer', amount: payTransfer });
    if (payCredit > 0) splits.push({ method: 'credit', amount: payCredit });

    setIsSubmitting(true);
    try {
      const created = await processSaleInvoice({
        docType: 'invoice',
        status: 'completed',
        customerId: selectedCustomerId,
        warehouseId: selectedWarehouseId,
        items: cart,
        invoiceDiscount,
        payments: splits,
        cashierId: currentEmployee?.id || 'emp-admin',
        cashierName: currentEmployee?.name || 'الكاشير',
        shiftId: activeShift?.id || 'shift-current',
        idempotencyKey,
      });

      setLastInvoice(created);
      setPreviewInvoice(created);
      setCart([]);
      setInvoiceDiscount(0);
      setPaymentModalOpen(false);
      setIdempotencyKey(generateIdempotencyKey('pos'));
      notify(`تم إتمام الفاتورة ${created.invoiceNumber} بنجاح`, 'success');
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل حفظ الفاتورة', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcuts: F1 Search, F2 Customer, F3 Hold, F4 Pay, F5 Print, Delete Remove row, Esc Close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F2') {
        e.preventDefault();
        setCustomerModalOpen(true);
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleHoldInvoice();
      } else if (e.key === 'F4') {
        e.preventDefault();
        openPaymentModal();
      } else if (e.key === 'F5') {
        e.preventDefault();
        handlePrintLastInvoice();
      } else if (e.key === 'Delete' && document.activeElement?.tagName !== 'INPUT') {
        if (cart.length > 0) removeCartItem(selectedRowIdx);
      } else if (e.key === 'Escape') {
        setPaymentModalOpen(false);
        setCustomerModalOpen(false);
        setHeldModalOpen(false);
        setPreviewInvoice(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Barcode Enter Capture (USB / Bluetooth Scanner)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      const q = search.trim().toLowerCase();
      const exact = products.find(
        (p) =>
          p.barcode.toLowerCase() === q ||
          p.extraBarcodes.some((b) => b.toLowerCase() === q) ||
          p.code.toLowerCase() === q
      );
      if (exact) {
        addProductToCart(exact);
        setSearch('');
      } else if (filteredProducts.length === 1) {
        addProductToCart(filteredProducts[0]);
        setSearch('');
      }
    }
  };

  const setQuickMethod = (method: PaymentMethod) => {
    setPayCash(method === 'cash' ? totals.grandTotal : 0);
    setPayCard(method === 'card' ? totals.grandTotal : 0);
    setPayWallet(method === 'wallet' ? totals.grandTotal : 0);
    setPayTransfer(method === 'transfer' ? totals.grandTotal : 0);
    setPayCredit(method === 'credit' ? totals.grandTotal : 0);
  };

  const totalTendered = roundMoney(payCash + payCard + payWallet + payTransfer + payCredit);
  const changeDue = roundMoney(Math.max(0, totalTendered - totals.grandTotal));
  const cur = settings?.currency || 'EGP';
  const dec = settings?.decimalPlaces ?? 2;

  return (
    <div className="space-y-3">
      {/* Shortcut & Toolbar Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300">
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">F1</strong> بحث</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">F2</strong> عميل</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">F3</strong> تعليق</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">F4</strong> دفع</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">F5</strong> طباعة</span>
          <span aria-hidden="true">·</span>
          <span><strong className="font-mono text-[#0B1F3A] dark:text-teal-400">Del</strong> حذف</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <button
            onClick={() => setHeldModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <PlayCircle className="w-3.5 h-3.5 text-amber-600" />
            <span>المعلقة ({heldInvoices.length})</span>
          </button>

          <button
            type="button"
            onClick={handlePrintLastInvoice}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            title="طباعة آخر فاتورة (F5)"
          >
            <Printer className="w-3.5 h-3.5 text-teal-600" />
            <span>طباعة الفاتورة</span>
          </button>
        </div>
      </div>

      {/* Main Split Cashier Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Right (RTL): Product Search & Grid */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="امسح الباركود (USB/Bluetooth) أو ابحث بالاسم أو الكود واضغط Enter..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-10 py-2.5 text-sm focus:outline-none focus:border-teal-600"
              />
              <Barcode className="w-4 h-4 text-teal-600 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    selectedCategory === cat
                      ? 'bg-[#0B1F3A] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((prod) => {
              const stock = prod.stockByWarehouse[selectedWarehouseId] || 0;
              return (
                <button
                  key={prod.id}
                  onClick={() => addProductToCart(prod)}
                  className="text-right bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden hover:border-teal-600 transition-colors flex flex-col"
                >
                  <div className="aspect-[4/3] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                    {prod.imageUrl ? (
                      <img
                        src={prod.imageUrl}
                        alt={prod.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="w-8 h-8 text-slate-400" />
                    )}
                  </div>
                  <div className="p-2.5 flex-1 flex flex-col justify-between w-full">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2">
                        {prod.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {prod.code} · المتاح: {stock}
                      </div>
                    </div>
                    <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-extrabold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                        {formatCurrency(
                          selectedCustomer?.tier === 'wholesale' ? prod.wholesalePrice : prod.salePrice,
                          cur,
                          dec
                        )}
                      </span>
                      <span className="text-[11px] text-slate-400">{prod.unit}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Left (RTL): Active Cart & Totals */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 sticky top-20">
          {/* Customer selector */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 mb-1">العميل الحالي</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.tier === 'wholesale' ? 'جملة' : c.tier === 'vip' ? 'VIP' : 'قطاعي'})
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setCustomerModalOpen(true)}
              className="mt-4 p-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="إضافة عميل سريع (F2)"
            >
              <UserPlus className="w-4 h-4 text-teal-600" />
            </button>
          </div>

          {/* Cart Items */}
          <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {cart.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                اختر منتجات من القائمة أو امسح الباركود لإضافتها إلى السلة
              </div>
            ) : (
              cart.map((item, idx) => (
                <div
                  key={`${item.productId}-${idx}`}
                  onClick={() => setSelectedRowIdx(idx)}
                  className={`py-2.5 px-1.5 rounded-lg transition-colors ${
                    selectedRowIdx === idx ? 'bg-slate-50 dark:bg-slate-800/60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {item.name}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCartItem(idx);
                      }}
                      className="text-rose-500 hover:text-rose-700 p-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          item.qty > 1
                            ? updateCartItem(idx, { qty: item.qty - 1 })
                            : removeCartItem(idx)
                        }
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) => updateCartItem(idx, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-12 text-center font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-0.5"
                      />
                      <button
                        onClick={() => updateCartItem(idx, { qty: item.qty + 1 })}
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">سعر:</span>
                      <input
                        type="number"
                        disabled={!hasPermission('pos.edit_price')}
                        value={item.price}
                        onChange={(e) => updateCartItem(idx, { price: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-18 text-center font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-0.5 disabled:opacity-60"
                      />
                    </div>

                    <div className="font-mono tabular-nums font-bold text-teal-700 dark:text-teal-400">
                      {item.total.toFixed(dec)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totals Summary */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">المجموع الفرعي</span>
              <span className="font-mono tabular-nums font-semibold">
                {formatCurrency(totals.subtotal, cur, dec)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">خصم الفاتورة</span>
              <input
                type="number"
                min={0}
                disabled={!hasPermission('pos.discount')}
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 text-left font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1"
              />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">ضريبة القيمة المضافة</span>
              <span className="font-mono tabular-nums font-semibold">
                {formatCurrency(totals.taxTotal, cur, dec)}
              </span>
            </div>
            <div className="flex justify-between text-base font-extrabold text-[#0B1F3A] dark:text-white border-t border-slate-200 dark:border-slate-800 pt-2">
              <span>الإجمالي المستحق</span>
              <span className="font-mono tabular-nums text-teal-600 dark:text-teal-400">
                {formatCurrency(totals.grandTotal, cur, dec)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={handleHoldInvoice}
              className="flex items-center justify-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <PauseCircle className="w-4 h-4 text-amber-600" />
              <span>تعليق</span>
            </button>
            <button
              onClick={() => setCart([])}
              className="flex items-center justify-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 py-2.5 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <XCircle className="w-4 h-4" />
              <span>إفراغ</span>
            </button>
            <button
              onClick={openPaymentModal}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 py-2.5 text-xs font-bold text-white hover:bg-teal-700 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              <span>دفع (F4)</span>
            </button>
          </div>

          {lastInvoice && lastInvoice.status === 'completed' && hasPermission('pos.cancel_invoice') && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>آخر فاتورة: {lastInvoice.invoiceNumber}</span>
              <button
                onClick={async () => {
                  await cancelSaleInvoice(
                    lastInvoice.id,
                    currentEmployee?.id || 'emp-admin',
                    currentEmployee?.name || 'المدير'
                  );
                  setLastInvoice(null);
                  await refreshAll();
                  notify('تم إلغاء الفاتورة وإرجاع المخزون', 'info');
                }}
                className="text-rose-600 hover:underline font-semibold"
              >
                إلغاء الفاتورة الأخيرة
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Payment Split Modal */}
      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-[#0B1F3A] dark:text-white">
                تحصيل وتقسيم الدفع
              </h3>
              <span className="font-mono tabular-nums font-extrabold text-teal-600 text-base">
                {formatCurrency(totals.grandTotal, cur, dec)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {([
                { id: 'cash', label: 'نقدي كامل' },
                { id: 'card', label: 'بطاقة فيزا' },
                { id: 'wallet', label: 'محفظة (فودافون/انستاباي)' },
                { id: 'transfer', label: 'تحويل بنكي' },
                { id: 'credit', label: 'آجل بالكامل' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setQuickMethod(m.id)}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold hover:bg-[#0B1F3A] hover:text-white transition-colors"
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <PaymentField label="نقدي (Cash)" value={payCash} onChange={setPayCash} />
              <PaymentField label="بطاقة بنكية (Visa/Master)" value={payCard} onChange={setPayCard} />
              <PaymentField label="محفظة إلكترونية" value={payWallet} onChange={setPayWallet} />
              <PaymentField label="تحويل بنكي" value={payTransfer} onChange={setPayTransfer} />
              <PaymentField label="بيع آجل (على العميل)" value={payCredit} onChange={setPayCredit} />
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>إجمالي المدفوع:</span>
                <span className="font-mono tabular-nums font-bold">{formatCurrency(totalTendered, cur, dec)}</span>
              </div>
              <div className="flex justify-between text-teal-700 dark:text-teal-400 font-bold">
                <span>الباقي للعميل:</span>
                <span className="font-mono tabular-nums">{formatCurrency(changeDue, cur, dec)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPaymentModalOpen(false)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold"
              >
                إلغاء (Esc)
              </button>
              <button
                onClick={handleCompleteSale}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>تأكيد وإصدار الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Customer Modal */}
      {customerModalOpen && (
        <QuickCustomerModal
          onClose={() => setCustomerModalOpen(false)}
          onCreated={async (id) => {
            await refreshAll();
            setSelectedCustomerId(id);
            setCustomerModalOpen(false);
          }}
        />
      )}

      {/* Held Invoices Modal */}
      {heldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-base font-bold mb-3">الفواتير المعلقة</h3>
            {heldInvoices.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">لا توجد فواتير معلقة حالياً.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {heldInvoices.map((h) => (
                  <div key={h.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono font-bold">{h.invoiceNumber}</div>
                      <div className="text-slate-500">{h.customerName} · {h.items.length} أصناف</div>
                    </div>
                    <button
                      onClick={() => handleResumeHeld(h)}
                      className="rounded-lg bg-[#0B1F3A] text-white px-3 py-1.5 font-semibold"
                    >
                      استكمال
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={() => setHeldModalOpen(false)} className="text-xs font-semibold px-3 py-1.5 border rounded-lg">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {previewInvoice && settings && (
        <InvoicePrintModal
          invoice={previewInvoice}
          settings={settings}
          onClose={() => setPreviewInvoice(null)}
        />
      )}
    </div>
  );
};

const PaymentField: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
}> = ({ label, value, onChange }) => (
  <label className="block">
    <span className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">{label}</span>
    <input
      type="number"
      min={0}
      step="0.5"
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono tabular-nums text-sm"
    />
  </label>
);

const QuickCustomerModal: React.FC<{
  onClose: () => void;
  onCreated: (id: string) => void;
}> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState(5000);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = `cust-${Date.now()}`;
    const now = new Date().toISOString();
    await dbLocal.customers.put({
      id,
      name: name.trim(),
      phone: phone.trim(),
      address: '',
      taxNumber: '',
      openingBalance: 0,
      creditLimit,
      totalPurchases: 0,
      totalPaid: 0,
      balance: 0,
      tier: 'retail',
      loyaltyPoints: 0,
      paymentSchedule: [],
      createdAt: now,
      updatedAt: now,
    });
    onCreated(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3"
      >
        <h3 className="text-base font-bold">إضافة عميل جديد</h3>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم العميل"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="رقم الهاتف"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={creditLimit}
          onChange={(e) => setCreditLimit(Number(e.target.value) || 0)}
          placeholder="الحد الائتماني"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs border rounded-lg">
            إلغاء
          </button>
          <button type="submit" className="px-4 py-1.5 text-xs font-bold bg-teal-600 text-white rounded-lg">
            حفظ
          </button>
        </div>
      </form>
    </div>
  );
};
