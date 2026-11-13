import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { dbLocal } from '../db/dexie';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildEtaQrTlvBase64,
  generateIdempotencyKey,
  generateUUID,
  getOrCreateDeviceId,
} from '../lib/crypto';
import type {
  AuditLog,
  CashTransaction,
  Customer,
  Expense,
  ExpenseCategory,
  JournalEntry,
  JournalLine,
  PaymentSplit,
  Product,
  PurchaseInvoice,
  PurchaseLineItem,
  ReturnInvoice,
  ReturnLineItem,
  SaleInvoice,
  SaleLineItem,
  Shift,
  StockCountItem,
  StockMovement,
  Supplier,
  SyncQueueItem,
} from '../types/erp';

export function roundMoney(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

export function formatCurrency(val: number, currency = 'EGP', decimals = 2): string {
  const formatted = Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${currency === 'EGP' ? 'ج.م' : currency}`;
}

export function computeProductTotalStock(product: Product): number {
  return Object.values(product.stockByWarehouse || {}).reduce((sum, q) => sum + (Number(q) || 0), 0);
}

export function computeSaleTotals(
  items: Array<{
    qty: number;
    price: number;
    discount: number;
    taxRate: number;
  }>,
  invoiceDiscount = 0,
  vatEnabled = true
) {
  let subtotal = 0;
  let itemDiscountTotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const gross = item.qty * item.price;
    const disc = Math.min(gross, Math.max(0, item.discount));
    const netBeforeTax = gross - disc;
    const tax = vatEnabled ? roundMoney(netBeforeTax * (item.taxRate / 100)) : 0;
    subtotal += gross;
    itemDiscountTotal += disc;
    taxTotal += tax;
  }

  const totalDiscount = roundMoney(itemDiscountTotal + Math.max(0, invoiceDiscount));
  const netAfterDiscount = Math.max(0, roundMoney(subtotal - totalDiscount));
  const grandTotal = roundMoney(netAfterDiscount + taxTotal);

  return {
    subtotal: roundMoney(subtotal),
    discountTotal: totalDiscount,
    taxTotal: roundMoney(taxTotal),
    grandTotal,
  };
}

export function verifyJournalBalance(lines: JournalLine[]): {
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
} {
  const totalDebit = roundMoney(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = roundMoney(lines.reduce((s, l) => s + (l.credit || 0), 0));
  return {
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    totalDebit,
    totalCredit,
  };
}

export async function logAudit(
  actorId: string,
  actorName: string,
  action: string,
  module: string,
  details: string
): Promise<void> {
  const entry: AuditLog = {
    id: `aud-${generateUUID().slice(0, 8)}`,
    actorId,
    actorName,
    action,
    module,
    details,
    deviceId: getOrCreateDeviceId(),
    createdAt: new Date().toISOString(),
  };
  await dbLocal.auditLogs.put(entry);
}

export async function enqueueSyncItem(
  entityType: SyncQueueItem['entityType'],
  entityId: string,
  action: 'create' | 'update',
  payload: Record<string, unknown>,
  revision = 1,
  version = 1,
  idempotencyKey?: string
): Promise<void> {
  const item: SyncQueueItem = {
    id: `sync-${generateUUID().slice(0, 10)}`,
    entityType,
    entityId,
    action,
    payload,
    idempotencyKey: idempotencyKey || generateIdempotencyKey(entityType),
    uuid: generateUUID(),
    revision,
    version,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await dbLocal.syncQueue.put(item);
}

async function postJournalEntryInternal(
  description: string,
  referenceType: string,
  referenceId: string,
  lines: JournalLine[],
  isPeriodClosing = false
): Promise<JournalEntry> {
  const check = verifyJournalBalance(lines);
  if (!check.balanced) {
    throw new Error(`القيد المحاسبي غير متوازن: مدين ${check.totalDebit} ≠ دائن ${check.totalCredit}`);
  }

  const count = await dbLocal.journalEntries.count();
  const now = new Date().toISOString();
  const entry: JournalEntry = {
    id: `je-${generateUUID().slice(0, 10)}`,
    entryNumber: `JE-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
    date: now.slice(0, 10),
    description,
    referenceType,
    referenceId,
    lines,
    totalDebit: check.totalDebit,
    totalCredit: check.totalCredit,
    isPeriodClosing,
    createdAt: now,
  };

  await dbLocal.journalEntries.put(entry);

  for (const line of lines) {
    const acc = await dbLocal.accounts.get(line.accountId);
    if (acc) {
      const delta =
        acc.type === 'asset' || acc.type === 'cogs' || acc.type === 'expense'
          ? line.debit - line.credit
          : line.credit - line.debit;
      await dbLocal.accounts.update(acc.id, { balance: roundMoney(acc.balance + delta) });
    }
  }

  return entry;
}

export interface CreateSaleInput {
  docType: 'invoice' | 'quotation' | 'sales_order';
  status: 'completed' | 'held';
  customerId: string;
  warehouseId: string;
  items: SaleLineItem[];
  invoiceDiscount?: number;
  payments: PaymentSplit[];
  cashierId: string;
  cashierName: string;
  shiftId: string;
  notes?: string;
  idempotencyKey?: string;
}

export async function processSaleInvoice(input: CreateSaleInput): Promise<SaleInvoice> {
  const idemKey = input.idempotencyKey || generateIdempotencyKey('sale');
  const duplicate = await dbLocal.sales.where('idempotencyKey').equals(idemKey).first();
  if (duplicate) {
    return duplicate;
  }

  const settings = await dbLocal.settings.get('main');
  if (!settings) throw new Error('إعدادات المتجر غير مهيأة');

  const customer = await dbLocal.customers.get(input.customerId);
  if (!customer) throw new Error('العميل المحدد غير موجود');

  const totals = computeSaleTotals(
    input.items,
    input.invoiceDiscount || 0,
    settings.vatEnabled
  );

  const nonCreditPaid = roundMoney(
    input.payments.filter((p) => p.method !== 'credit').reduce((s, p) => s + p.amount, 0)
  );
  const creditAmount = roundMoney(Math.max(0, totals.grandTotal - nonCreditPaid));

  if (input.docType === 'invoice' && input.status === 'completed') {
    if (creditAmount > 0) {
      if (!settings.allowCreditSales) {
        throw new Error('البيع الآجل معطل في إعدادات المتجر');
      }
      if (customer.id === 'cust-walkin') {
        throw new Error('لا يمكن البيع بالآجل للعميل النقدي المباشر');
      }
      if (customer.creditLimit > 0 && customer.balance + creditAmount > customer.creditLimit) {
        throw new Error(`تجاوز الحد الائتماني للعميل (${formatCurrency(customer.creditLimit)})`);
      }
    }

    if (settings.preventNegativeStock) {
      for (const item of input.items) {
        const prod = await dbLocal.products.get(item.productId);
        if (!prod) throw new Error(`المنتج ${item.name} غير موجود`);
        const available = prod.stockByWarehouse[input.warehouseId] || 0;
        if (available < item.qty) {
          throw new Error(`الكمية المتاحة من "${prod.name}" (${available}) غير كافية للبيع (${item.qty})`);
        }
      }
    }
  }

  const now = new Date().toISOString();
  const salesCount = await dbLocal.sales.count();
  const prefix =
    input.docType === 'quotation' ? 'QT' : input.docType === 'sales_order' ? 'SO' : 'INV';
  const invoiceNumber = `${prefix}-${new Date().getFullYear()}-${String(salesCount + 1).padStart(4, '0')}`;
  const invoiceId = `sale-${generateUUID().slice(0, 10)}`;
  const eInvoiceUuid = generateUUID();

  const invoice: SaleInvoice = {
    id: invoiceId,
    invoiceNumber,
    docType: input.docType,
    status: input.status,
    customerId: customer.id,
    customerName: customer.name,
    warehouseId: input.warehouseId,
    items: input.items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    paidAmount: nonCreditPaid,
    remainingAmount: creditAmount,
    payments: input.payments,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    shiftId: input.shiftId,
    notes: input.notes,
    eInvoiceUuid,
    etaQrPayload: buildEtaQrTlvBase64({
      sellerName: settings.storeName,
      taxNumber: settings.taxNumber,
      timestamp: now,
      totalWithVat: totals.grandTotal.toFixed(2),
      vatAmount: totals.taxTotal.toFixed(2),
    }),
    etaStatus: 'prepared',
    uuid: generateUUID(),
    idempotencyKey: idemKey,
    revision: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  await dbLocal.sales.put(invoice);

  if (input.docType === 'invoice' && input.status === 'completed') {
    let totalCogs = 0;

    for (const item of input.items) {
      const prod = await dbLocal.products.get(item.productId);
      if (prod) {
        const prevQty = prod.stockByWarehouse[input.warehouseId] || 0;
        const newQty = prevQty - item.qty;
        const nextStock = { ...prod.stockByWarehouse, [input.warehouseId]: newQty };
        await dbLocal.products.update(prod.id, {
          stockByWarehouse: nextStock,
          revision: prod.revision + 1,
          updatedAt: now,
        });

        totalCogs += roundMoney(item.qty * prod.purchasePrice);

        const mv: StockMovement = {
          id: `mv-${generateUUID().slice(0, 10)}`,
          productId: prod.id,
          productName: prod.name,
          warehouseId: input.warehouseId,
          type: 'sale',
          quantity: -item.qty,
          previousQty: prevQty,
          newQty,
          unitCost: prod.purchasePrice,
          referenceId: invoice.id,
          reason: `فاتورة بيع ${invoice.invoiceNumber}`,
          userId: input.cashierId,
          createdAt: now,
        };
        await dbLocal.stockMovements.put(mv);
      }
    }

    let cashPaid = 0;
    let bankOrCardPaid = 0;
    let cardAmt = 0;
    let walletAmt = 0;
    let transferAmt = 0;

    for (const pay of input.payments) {
      if (pay.amount <= 0 || pay.method === 'credit') continue;
      const targetAccId = pay.method === 'cash' ? 'acc-cash-pos' : 'acc-bank-nbe';
      if (pay.method === 'cash') cashPaid += pay.amount;
      else bankOrCardPaid += pay.amount;

      if (pay.method === 'card') cardAmt += pay.amount;
      if (pay.method === 'wallet') walletAmt += pay.amount;
      if (pay.method === 'transfer') transferAmt += pay.amount;

      const acc = await dbLocal.cashboxAccounts.get(targetAccId);
      if (acc) {
        await dbLocal.cashboxAccounts.update(acc.id, {
          balance: roundMoney(acc.balance + pay.amount),
        });
      }

      const tx: CashTransaction = {
        id: `ctx-${generateUUID().slice(0, 10)}`,
        accountId: targetAccId,
        type: 'sale',
        amount: pay.amount,
        category: 'مبيعات نقاط البيع',
        referenceType: 'sale',
        referenceId: invoice.id,
        description: `تحصيل فاتورة ${invoice.invoiceNumber} (${pay.method})`,
        userId: input.cashierId,
        createdAt: now,
      };
      await dbLocal.cashTransactions.put(tx);
    }

    await dbLocal.customers.update(customer.id, {
      totalPurchases: roundMoney(customer.totalPurchases + invoice.grandTotal),
      totalPaid: roundMoney(customer.totalPaid + nonCreditPaid),
      balance: roundMoney(customer.balance + creditAmount),
      loyaltyPoints: customer.loyaltyPoints + Math.floor(invoice.grandTotal / 50),
      updatedAt: now,
    });

    const shift = await dbLocal.shifts.get(input.shiftId);
    if (shift && shift.status === 'open') {
      await dbLocal.shifts.update(shift.id, {
        salesTotal: roundMoney(shift.salesTotal + invoice.grandTotal),
        cashSales: roundMoney(shift.cashSales + cashPaid),
        cardSales: roundMoney(shift.cardSales + cardAmt),
        walletSales: roundMoney(shift.walletSales + walletAmt),
        transferSales: roundMoney(shift.transferSales + transferAmt),
        creditSales: roundMoney(shift.creditSales + creditAmount),
        expectedCash: roundMoney(shift.expectedCash + cashPaid),
        invoiceCount: shift.invoiceCount + 1,
      });
    }

    const lines: JournalLine[] = [];
    if (cashPaid > 0) {
      lines.push({
        accountId: 'coa-1101',
        accountCode: '1101',
        accountName: 'النقدية بالخزينة',
        debit: roundMoney(cashPaid),
        credit: 0,
      });
    }
    if (bankOrCardPaid > 0) {
      lines.push({
        accountId: 'coa-1102',
        accountCode: '1102',
        accountName: 'البنوك والحسابات الجارية',
        debit: roundMoney(bankOrCardPaid),
        credit: 0,
      });
    }
    if (creditAmount > 0) {
      lines.push({
        accountId: 'coa-1201',
        accountCode: '1201',
        accountName: 'العملاء والذمم المدينة',
        debit: roundMoney(creditAmount),
        credit: 0,
      });
    }
    const netRevenue = roundMoney(invoice.grandTotal - invoice.taxTotal);
    lines.push({
      accountId: 'coa-4101',
      accountCode: '4101',
      accountName: 'إيرادات المبيعات',
      debit: 0,
      credit: netRevenue,
    });
    if (invoice.taxTotal > 0) {
      lines.push({
        accountId: 'coa-2201',
        accountCode: '2201',
        accountName: 'ضريبة القيمة المضافة المستحقة (14%)',
        debit: 0,
        credit: invoice.taxTotal,
      });
    }
    if (totalCogs > 0) {
      lines.push(
        {
          accountId: 'coa-5101',
          accountCode: '5101',
          accountName: 'تكلفة البضاعة المباعة (COGS)',
          debit: roundMoney(totalCogs),
          credit: 0,
        },
        {
          accountId: 'coa-1301',
          accountCode: '1301',
          accountName: 'المخزون السلعي',
          debit: 0,
          credit: roundMoney(totalCogs),
        }
      );
    }

    await postJournalEntryInternal(
      `قيد مبيعات فاتورة ${invoice.invoiceNumber}`,
      'sale',
      invoice.id,
      lines
    );

    await enqueueSyncItem(
      'sale',
      invoice.id,
      'create',
      {
        invoiceNumber: invoice.invoiceNumber,
        docType: invoice.docType,
        status: invoice.status,
        customerId: invoice.customerId,
        grandTotal: invoice.grandTotal,
        paidAmount: invoice.paidAmount,
        remainingAmount: invoice.remainingAmount,
        idempotencyKey: invoice.idempotencyKey,
        revision: invoice.revision,
      },
      invoice.revision,
      invoice.version,
      invoice.idempotencyKey
    );

    await logAudit(
      input.cashierId,
      input.cashierName,
      `إصدار فاتورة ${invoice.invoiceNumber}`,
      'نقطة البيع',
      `الإجمالي ${formatCurrency(invoice.grandTotal)}`
    );
  }

  return invoice;
}

export async function cancelSaleInvoice(
  invoiceId: string,
  actorId: string,
  actorName: string
): Promise<void> {
  const inv = await dbLocal.sales.get(invoiceId);
  if (!inv) throw new Error('الفاتورة غير موجودة');
  if (inv.status === 'cancelled') throw new Error('الفاتورة ملغاة بالفعل');

  const now = new Date().toISOString();
  if (inv.status === 'completed' && inv.docType === 'invoice') {
    for (const item of inv.items) {
      const prod = await dbLocal.products.get(item.productId);
      if (prod) {
        const prevQty = prod.stockByWarehouse[inv.warehouseId] || 0;
        const newQty = prevQty + item.qty;
        await dbLocal.products.update(prod.id, {
          stockByWarehouse: { ...prod.stockByWarehouse, [inv.warehouseId]: newQty },
          updatedAt: now,
        });
        await dbLocal.stockMovements.put({
          id: `mv-${generateUUID().slice(0, 10)}`,
          productId: prod.id,
          productName: prod.name,
          warehouseId: inv.warehouseId,
          type: 'return',
          quantity: item.qty,
          previousQty: prevQty,
          newQty,
          unitCost: prod.purchasePrice,
          referenceId: inv.id,
          reason: `إلغاء فاتورة ${inv.invoiceNumber}`,
          userId: actorId,
          createdAt: now,
        });
      }
    }

    if (inv.remainingAmount > 0) {
      const cust = await dbLocal.customers.get(inv.customerId);
      if (cust) {
        await dbLocal.customers.update(cust.id, {
          balance: roundMoney(Math.max(0, cust.balance - inv.remainingAmount)),
          updatedAt: now,
        });
      }
    }
  }

  await dbLocal.sales.update(inv.id, {
    status: 'cancelled',
    revision: inv.revision + 1,
    updatedAt: now,
  });

  await logAudit(actorId, actorName, `إلغاء فاتورة ${inv.invoiceNumber}`, 'المبيعات', 'بصلاحية المدير');
}

export async function processSaleReturn(params: {
  originalInvoiceId: string;
  items: ReturnLineItem[];
  refundMethod: 'cash' | 'customer_credit';
  shiftId: string;
  userId: string;
  userName: string;
}): Promise<ReturnInvoice> {
  const original = await dbLocal.sales.get(params.originalInvoiceId);
  if (!original) throw new Error('الفاتورة الأصلية غير موجودة');

  const previousReturns = await dbLocal.returns
    .where('originalInvoiceId')
    .equals(original.id)
    .toArray();

  for (const retItem of params.items) {
    if (retItem.qty <= 0) continue;
    const soldLine = original.items.find((i) => i.productId === retItem.productId);
    if (!soldLine) throw new Error(`الصنف ${retItem.name} غير موجود في الفاتورة الأصلية`);
    const alreadyReturned = previousReturns.reduce(
      (sum, r) => sum + (r.items.find((ri) => ri.productId === retItem.productId)?.qty || 0),
      0
    );
    if (retItem.qty + alreadyReturned > soldLine.qty) {
      throw new Error(
        `الكمية المرتجعة للصنف "${retItem.name}" تتجاوز المتبقي القابل للإرجاع (${soldLine.qty - alreadyReturned})`
      );
    }
  }

  const now = new Date().toISOString();
  const count = await dbLocal.returns.count();
  const totalRefund = roundMoney(
    params.items.reduce((s, item) => s + item.qty * item.refundPrice, 0)
  );
  if (totalRefund <= 0) throw new Error('يرجى تحديد كمية مرتجعة صالحة');

  const retDoc: ReturnInvoice = {
    id: `ret-${generateUUID().slice(0, 10)}`,
    returnNumber: `RET-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
    originalInvoiceId: original.id,
    originalInvoiceNumber: original.invoiceNumber,
    customerId: original.customerId,
    customerName: original.customerName,
    warehouseId: original.warehouseId,
    items: params.items.filter((i) => i.qty > 0),
    totalRefund,
    refundMethod: params.refundMethod,
    shiftId: params.shiftId,
    userId: params.userId,
    createdAt: now,
  };

  await dbLocal.returns.put(retDoc);

  for (const item of retDoc.items) {
    const prod = await dbLocal.products.get(item.productId);
    if (prod) {
      const prevQty = prod.stockByWarehouse[original.warehouseId] || 0;
      if (item.condition === 'good') {
        const newQty = prevQty + item.qty;
        await dbLocal.products.update(prod.id, {
          stockByWarehouse: { ...prod.stockByWarehouse, [original.warehouseId]: newQty },
          updatedAt: now,
        });
        await dbLocal.stockMovements.put({
          id: `mv-${generateUUID().slice(0, 10)}`,
          productId: prod.id,
          productName: prod.name,
          warehouseId: original.warehouseId,
          type: 'return',
          quantity: item.qty,
          previousQty: prevQty,
          newQty,
          unitCost: prod.purchasePrice,
          referenceId: retDoc.id,
          reason: `مرتجع مبيعات صالح (${retDoc.returnNumber})`,
          userId: params.userId,
          createdAt: now,
        });
      } else {
        await dbLocal.stockMovements.put({
          id: `mv-${generateUUID().slice(0, 10)}`,
          productId: prod.id,
          productName: prod.name,
          warehouseId: original.warehouseId,
          type: 'damage',
          quantity: 0,
          previousQty: prevQty,
          newQty: prevQty,
          unitCost: prod.purchasePrice,
          referenceId: retDoc.id,
          reason: `مرتجع تالف (${item.reason})`,
          userId: params.userId,
          createdAt: now,
        });
      }
    }
  }

  if (params.refundMethod === 'cash') {
    const acc = await dbLocal.cashboxAccounts.get('acc-cash-pos');
    if (acc) {
      await dbLocal.cashboxAccounts.update(acc.id, {
        balance: roundMoney(acc.balance - totalRefund),
      });
    }
    await dbLocal.cashTransactions.put({
      id: `ctx-${generateUUID().slice(0, 10)}`,
      accountId: 'acc-cash-pos',
      type: 'refund',
      amount: -totalRefund,
      category: 'مرتجعات مبيعات',
      referenceType: 'return',
      referenceId: retDoc.id,
      description: `استرداد نقدي مرتجع ${retDoc.returnNumber}`,
      userId: params.userId,
      createdAt: now,
    });
    const shift = await dbLocal.shifts.get(params.shiftId);
    if (shift && shift.status === 'open') {
      await dbLocal.shifts.update(shift.id, {
        returnsTotal: roundMoney(shift.returnsTotal + totalRefund),
        expectedCash: roundMoney(shift.expectedCash - totalRefund),
      });
    }
  } else {
    const cust = await dbLocal.customers.get(original.customerId);
    if (cust) {
      await dbLocal.customers.update(cust.id, {
        balance: roundMoney(cust.balance - totalRefund),
        updatedAt: now,
      });
    }
  }

  await postJournalEntryInternal(
    `قيد مرتجع مبيعات ${retDoc.returnNumber}`,
    'return',
    retDoc.id,
    [
      {
        accountId: 'coa-4101',
        accountCode: '4101',
        accountName: 'إيرادات المبيعات',
        debit: totalRefund,
        credit: 0,
      },
      {
        accountId: params.refundMethod === 'cash' ? 'coa-1101' : 'coa-1201',
        accountCode: params.refundMethod === 'cash' ? '1101' : '1201',
        accountName: params.refundMethod === 'cash' ? 'النقدية بالخزينة' : 'العملاء والذمم المدينة',
        debit: 0,
        credit: totalRefund,
      },
    ]
  );

  await logAudit(
    params.userId,
    params.userName,
    `مرتجع مبيعات ${retDoc.returnNumber}`,
    'المرتجعات',
    `على الفاتورة ${original.invoiceNumber} بمبلغ ${formatCurrency(totalRefund)}`
  );

  return retDoc;
}

export async function processPurchaseInvoice(params: {
  docType: 'invoice' | 'po' | 'quote';
  supplierId: string;
  warehouseId: string;
  items: PurchaseLineItem[];
  shippingCost: number;
  paidAmount: number;
  accountId: string;
  dueDate?: string;
  userId: string;
  userName: string;
}): Promise<PurchaseInvoice> {
  const supplier = await dbLocal.suppliers.get(params.supplierId);
  if (!supplier) throw new Error('المورد غير موجود');

  const totalQty = params.items.reduce((s, i) => s + Math.max(0, i.receivedQty || i.orderedQty), 0) || 1;
  const shippingPerUnit = params.shippingCost / totalQty;

  let subtotal = 0;
  let taxTotal = 0;
  const normalizedItems = params.items.map((item) => {
    const qty = params.docType === 'invoice' ? item.receivedQty : item.orderedQty;
    const gross = qty * item.unitCost - item.discount;
    const tax = roundMoney(gross * (item.taxRate / 100));
    subtotal += gross;
    taxTotal += tax;
    return {
      ...item,
      allocatedShippingCost: roundMoney(shippingPerUnit * qty),
      total: roundMoney(gross + tax),
    };
  });

  const grandTotal = roundMoney(subtotal + taxTotal + params.shippingCost);
  const paid = Math.min(grandTotal, Math.max(0, params.paidAmount));
  const remaining = roundMoney(grandTotal - paid);

  const isPartial =
    params.docType === 'invoice' &&
    normalizedItems.some((i) => i.receivedQty < i.orderedQty);

  const status: PurchaseInvoice['status'] =
    params.docType === 'invoice' ? (isPartial ? 'partial' : 'received') : 'ordered';

  const now = new Date().toISOString();
  const count = await dbLocal.purchases.count();
  const prefix = params.docType === 'po' ? 'PO' : params.docType === 'quote' ? 'PQ' : 'PUR';
  const purchaseNumber = `${prefix}-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

  const docObj: PurchaseInvoice = {
    id: `pur-${generateUUID().slice(0, 10)}`,
    purchaseNumber,
    docType: params.docType,
    status,
    supplierId: supplier.id,
    supplierName: supplier.name,
    warehouseId: params.warehouseId,
    items: normalizedItems,
    shippingCost: params.shippingCost,
    subtotal: roundMoney(subtotal),
    taxTotal: roundMoney(taxTotal),
    grandTotal,
    paidAmount: paid,
    remainingAmount: remaining,
    dueDate: params.dueDate,
    createdAt: now,
    updatedAt: now,
  };

  await dbLocal.purchases.put(docObj);

  if (params.docType === 'invoice') {
    for (const item of normalizedItems) {
      if (item.receivedQty <= 0) continue;
      const prod = await dbLocal.products.get(item.productId);
      if (prod) {
        const oldTotalQty = computeProductTotalStock(prod);
        const prevWhQty = prod.stockByWarehouse[params.warehouseId] || 0;
        const newWhQty = prevWhQty + item.receivedQty;
        const landedUnitCost = roundMoney(item.unitCost + item.allocatedShippingCost / item.receivedQty);
        const weightedCost =
          oldTotalQty + item.receivedQty > 0
            ? roundMoney(
                (oldTotalQty * prod.purchasePrice + item.receivedQty * landedUnitCost) /
                  (oldTotalQty + item.receivedQty)
              )
            : landedUnitCost;

        await dbLocal.products.update(prod.id, {
          purchasePrice: weightedCost,
          batchNumber: item.batchNumber || prod.batchNumber,
          expiryDate: item.expiryDate || prod.expiryDate,
          stockByWarehouse: { ...prod.stockByWarehouse, [params.warehouseId]: newWhQty },
          revision: prod.revision + 1,
          updatedAt: now,
        });

        await dbLocal.stockMovements.put({
          id: `mv-${generateUUID().slice(0, 10)}`,
          productId: prod.id,
          productName: prod.name,
          warehouseId: params.warehouseId,
          type: 'purchase',
          quantity: item.receivedQty,
          previousQty: prevWhQty,
          newQty: newWhQty,
          unitCost: landedUnitCost,
          referenceId: docObj.id,
          reason: `فاتورة شراء ${docObj.purchaseNumber}`,
          userId: params.userId,
          createdAt: now,
        });
      }
    }

    if (paid > 0) {
      const acc = await dbLocal.cashboxAccounts.get(params.accountId);
      if (acc) {
        await dbLocal.cashboxAccounts.update(acc.id, { balance: roundMoney(acc.balance - paid) });
      }
      await dbLocal.cashTransactions.put({
        id: `ctx-${generateUUID().slice(0, 10)}`,
        accountId: params.accountId,
        type: 'purchase',
        amount: -paid,
        category: 'مشتريات بضاعة',
        referenceType: 'purchase',
        referenceId: docObj.id,
        description: `سداد فاتورة شراء ${docObj.purchaseNumber}`,
        userId: params.userId,
        createdAt: now,
      });
    }

    await dbLocal.suppliers.update(supplier.id, {
      totalPurchases: roundMoney(supplier.totalPurchases + grandTotal),
      totalPaid: roundMoney(supplier.totalPaid + paid),
      balance: roundMoney(supplier.balance + remaining),
      nextDueDate: params.dueDate || supplier.nextDueDate,
      updatedAt: now,
    });

    const lines: JournalLine[] = [
      {
        accountId: 'coa-1301',
        accountCode: '1301',
        accountName: 'المخزون السلعي',
        debit: grandTotal,
        credit: 0,
      },
    ];
    if (paid > 0) {
      lines.push({
        accountId: params.accountId.includes('bank') ? 'coa-1102' : 'coa-1101',
        accountCode: params.accountId.includes('bank') ? '1102' : '1101',
        accountName: params.accountId.includes('bank') ? 'البنوك والحسابات الجارية' : 'النقدية بالخزينة',
        debit: 0,
        credit: paid,
      });
    }
    if (remaining > 0) {
      lines.push({
        accountId: 'coa-2101',
        accountCode: '2101',
        accountName: 'الموردين والذمم الدائنة',
        debit: 0,
        credit: remaining,
      });
    }

    await postJournalEntryInternal(`قيد مشتريات ${docObj.purchaseNumber}`, 'purchase', docObj.id, lines);
    await enqueueSyncItem('purchase', docObj.id, 'create', {
      purchaseNumber: docObj.purchaseNumber,
      docType: docObj.docType,
      status: docObj.status,
      supplierId: docObj.supplierId,
      grandTotal: docObj.grandTotal,
      paidAmount: docObj.paidAmount,
      remainingAmount: docObj.remainingAmount,
    });
    await logAudit(params.userId, params.userName, `تسجيل مشتريات ${docObj.purchaseNumber}`, 'المشتريات', supplier.name);
  }

  return docObj;
}

export async function processExpense(params: {
  category: ExpenseCategory;
  amount: number;
  accountId: string;
  date: string;
  notes: string;
  receiptRef: string;
  userId: string;
  userName: string;
}): Promise<Expense> {
  if (params.amount <= 0) throw new Error('مبلغ المصروف يجب أن يكون أكبر من صفر');
  const now = new Date().toISOString();
  const expense: Expense = {
    id: `exp-${generateUUID().slice(0, 10)}`,
    category: params.category,
    amount: roundMoney(params.amount),
    accountId: params.accountId,
    date: params.date,
    notes: params.notes,
    receiptRef: params.receiptRef,
    userId: params.userId,
    userName: params.userName,
    createdAt: now,
  };

  await dbLocal.expenses.put(expense);

  const acc = await dbLocal.cashboxAccounts.get(params.accountId);
  if (acc) {
    await dbLocal.cashboxAccounts.update(acc.id, {
      balance: roundMoney(acc.balance - expense.amount),
    });
  }

  await dbLocal.cashTransactions.put({
    id: `ctx-${generateUUID().slice(0, 10)}`,
    accountId: params.accountId,
    type: 'expense',
    amount: -expense.amount,
    category: params.category,
    referenceType: 'expense',
    referenceId: expense.id,
    description: params.notes || `مصروف ${params.category}`,
    userId: params.userId,
    createdAt: now,
  });

  if (params.accountId === 'acc-cash-pos') {
    const openShift = await dbLocal.shifts.where('status').equals('open').first();
    if (openShift) {
      await dbLocal.shifts.update(openShift.id, {
        expensesTotal: roundMoney(openShift.expensesTotal + expense.amount),
        expectedCash: roundMoney(openShift.expectedCash - expense.amount),
      });
    }
  }

  await postJournalEntryInternal(`قيد مصروف ${params.category}`, 'expense', expense.id, [
    {
      accountId: 'coa-5201',
      accountCode: '5201',
      accountName: 'المصروفات التشغيلية والرواتب',
      debit: expense.amount,
      credit: 0,
    },
    {
      accountId: params.accountId.includes('bank') ? 'coa-1102' : 'coa-1101',
      accountCode: params.accountId.includes('bank') ? '1102' : '1101',
      accountName: params.accountId.includes('bank') ? 'البنوك والحسابات الجارية' : 'النقدية بالخزينة',
      debit: 0,
      credit: expense.amount,
    },
  ]);

  await enqueueSyncItem('expense', expense.id, 'create', {
    category: expense.category,
    amount: expense.amount,
    accountId: expense.accountId,
  });
  await logAudit(params.userId, params.userName, `تسجيل مصروف ${formatCurrency(expense.amount)}`, 'المصروفات', params.notes);

  return expense;
}

export async function processCashboxOperation(params: {
  type: 'receipt' | 'payment' | 'transfer' | 'deposit' | 'withdrawal' | 'capital' | 'personal_draw' | 'variance';
  accountId: string;
  targetAccountId?: string;
  amount: number;
  description: string;
  customerId?: string;
  supplierId?: string;
  userId: string;
  userName: string;
}): Promise<void> {
  if (params.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const now = new Date().toISOString();
  const amt = roundMoney(params.amount);
  const source = await dbLocal.cashboxAccounts.get(params.accountId);
  if (!source) throw new Error('الحساب المحدد غير موجود');

  if (params.type === 'transfer' || params.type === 'deposit' || params.type === 'withdrawal') {
    if (!params.targetAccountId || params.targetAccountId === params.accountId) {
      throw new Error('يرجى تحديد حساب وجهة مختلف');
    }
    const target = await dbLocal.cashboxAccounts.get(params.targetAccountId);
    if (!target) throw new Error('حساب الوجهة غير موجود');
    await dbLocal.cashboxAccounts.update(source.id, { balance: roundMoney(source.balance - amt) });
    await dbLocal.cashboxAccounts.update(target.id, { balance: roundMoney(target.balance + amt) });
  } else if (params.type === 'receipt' || params.type === 'capital') {
    await dbLocal.cashboxAccounts.update(source.id, { balance: roundMoney(source.balance + amt) });
  } else {
    await dbLocal.cashboxAccounts.update(source.id, { balance: roundMoney(source.balance - amt) });
  }

  if (params.customerId) {
    const cust = await dbLocal.customers.get(params.customerId);
    if (cust) {
      await dbLocal.customers.update(cust.id, {
        totalPaid: roundMoney(cust.totalPaid + amt),
        balance: roundMoney(cust.balance - amt),
        updatedAt: now,
      });
    }
  }

  if (params.supplierId) {
    const sup = await dbLocal.suppliers.get(params.supplierId);
    if (sup) {
      await dbLocal.suppliers.update(sup.id, {
        totalPaid: roundMoney(sup.totalPaid + amt),
        balance: roundMoney(sup.balance - amt),
        updatedAt: now,
      });
    }
  }

  await dbLocal.cashTransactions.put({
    id: `ctx-${generateUUID().slice(0, 10)}`,
    accountId: params.accountId,
    targetAccountId: params.targetAccountId,
    type: params.type,
    amount: params.type === 'receipt' || params.type === 'capital' ? amt : -amt,
    category: params.type,
    referenceType: 'cashbox',
    referenceId: params.customerId || params.supplierId || params.accountId,
    description: params.description,
    userId: params.userId,
    createdAt: now,
  });

  await logAudit(params.userId, params.userName, `حركة خزينة (${params.type})`, 'الخزينة', `${formatCurrency(amt)} - ${params.description}`);
}

export async function processStockTransfer(params: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  reason: string;
  userId: string;
}): Promise<void> {
  if (params.fromWarehouseId === params.toWarehouseId) throw new Error('المخزن المصدر والوجهة متطابقان');
  if (params.quantity <= 0) throw new Error('الكمية يجب أن تكون موجبة');
  const prod = await dbLocal.products.get(params.productId);
  if (!prod) throw new Error('المنتج غير موجود');
  const fromQty = prod.stockByWarehouse[params.fromWarehouseId] || 0;
  if (fromQty < params.quantity) throw new Error('الكمية غير متاحة في المخزن المصدر');

  const toQty = prod.stockByWarehouse[params.toWarehouseId] || 0;
  const now = new Date().toISOString();
  await dbLocal.products.update(prod.id, {
    stockByWarehouse: {
      ...prod.stockByWarehouse,
      [params.fromWarehouseId]: fromQty - params.quantity,
      [params.toWarehouseId]: toQty + params.quantity,
    },
    updatedAt: now,
  });

  await dbLocal.stockMovements.put({
    id: `mv-${generateUUID().slice(0, 10)}`,
    productId: prod.id,
    productName: prod.name,
    warehouseId: params.fromWarehouseId,
    targetWarehouseId: params.toWarehouseId,
    type: 'transfer',
    quantity: params.quantity,
    previousQty: fromQty,
    newQty: fromQty - params.quantity,
    unitCost: prod.purchasePrice,
    referenceId: `TRF-${Date.now()}`,
    reason: params.reason || 'تحويل بين المخازن',
    userId: params.userId,
    createdAt: now,
  });
}

export async function processStockCount(params: {
  warehouseId: string;
  type: 'partial' | 'full';
  items: StockCountItem[];
  userId: string;
  userName: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const countId = `cnt-${generateUUID().slice(0, 10)}`;
  await dbLocal.stockCounts.put({
    id: countId,
    warehouseId: params.warehouseId,
    type: params.type,
    items: params.items,
    status: 'posted',
    createdBy: params.userName,
    createdAt: now,
  });

  for (const item of params.items) {
    if (item.diff === 0) continue;
    const prod = await dbLocal.products.get(item.productId);
    if (prod) {
      await dbLocal.products.update(prod.id, {
        stockByWarehouse: { ...prod.stockByWarehouse, [params.warehouseId]: item.actualQty },
        updatedAt: now,
      });
      await dbLocal.stockMovements.put({
        id: `mv-${generateUUID().slice(0, 10)}`,
        productId: prod.id,
        productName: prod.name,
        warehouseId: params.warehouseId,
        type: 'adjustment',
        quantity: item.diff,
        previousQty: item.bookQty,
        newQty: item.actualQty,
        unitCost: prod.purchasePrice,
        referenceId: countId,
        reason: item.reason || (item.diff > 0 ? 'زيادة جرد فعلي' : 'عجز جرد فعلي'),
        userId: params.userId,
        createdAt: now,
      });
    }
  }

  await logAudit(params.userId, params.userName, 'اعتماد تسوية جرد مخزني', 'المخازن', `عدد الأصناف: ${params.items.length}`);
}

export async function openNewShift(
  cashierId: string,
  cashierName: string,
  openingCash: number
): Promise<Shift> {
  const settings = await dbLocal.settings.get('main');
  const existingOpen = await dbLocal.shifts.where('status').equals('open').first();
  if (settings?.preventConflictingShifts && existingOpen) {
    throw new Error(`توجد وردية مفتوحة حالياً باسم ${existingOpen.cashierName}، يجب إغلاقها أولاً`);
  }

  const now = new Date().toISOString();
  const shift: Shift = {
    id: `shift-${generateUUID().slice(0, 10)}`,
    cashierId,
    cashierName,
    openingCash: roundMoney(openingCash),
    expectedCash: roundMoney(openingCash),
    variance: 0,
    salesTotal: 0,
    cashSales: 0,
    cardSales: 0,
    walletSales: 0,
    transferSales: 0,
    creditSales: 0,
    expensesTotal: 0,
    returnsTotal: 0,
    invoiceCount: 0,
    status: 'open',
    openedAt: now,
  };

  await dbLocal.shifts.put(shift);
  await logAudit(cashierId, cashierName, 'فتح وردية كاشير', 'الورديات', `رصيد افتتاحي ${formatCurrency(openingCash)}`);
  return shift;
}

export async function closeExistingShift(
  shiftId: string,
  actualCash: number,
  actorId: string,
  actorName: string
): Promise<Shift> {
  const shift = await dbLocal.shifts.get(shiftId);
  if (!shift) throw new Error('الوردية غير موجودة');
  if (shift.status === 'closed') throw new Error('الوردية مغلقة بالفعل');

  const variance = roundMoney(actualCash - shift.expectedCash);
  const closedAt = new Date().toISOString();
  const updated: Shift = {
    ...shift,
    actualCash: roundMoney(actualCash),
    variance,
    status: 'closed',
    closedAt,
  };
  await dbLocal.shifts.put(updated);
  await enqueueSyncItem('shift', updated.id, 'update', {
    cashierId: updated.cashierId,
    status: updated.status,
    openingCash: updated.openingCash,
    expectedCash: updated.expectedCash,
    actualCash: updated.actualCash,
    variance: updated.variance,
  });
  await logAudit(
    actorId,
    actorName,
    'إغلاق وردية كاشير',
    'الورديات',
    `المتوقع ${formatCurrency(shift.expectedCash)} | الفعلي ${formatCurrency(actualCash)} | الفرق ${formatCurrency(variance)}`
  );
  return updated;
}

export async function syncQueueToFirestore(): Promise<{ synced: number; failed: number }> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const pending = await dbLocal.syncQueue.where('status').anyOf(['pending', 'error']).toArray();
  const storeId = `store_${user.uid}`;
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    const collectionMap: Record<SyncQueueItem['entityType'], string> = {
      product: 'products',
      sale: 'sales',
      customer: 'customers',
      supplier: 'suppliers',
      purchase: 'purchases',
      expense: 'expenses',
      shift: 'shifts',
    };
    const subCol = collectionMap[item.entityType];
    const path = `stores/${storeId}/${subCol}/${item.entityId}`;

    try {
      await setDoc(
        doc(db, 'stores', storeId, subCol, item.entityId),
        {
          ...item.payload,
          ownerId: user.uid,
          storeId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await dbLocal.syncQueue.update(item.id, { status: 'synced', errorMsg: undefined });
      synced++;
    } catch (err) {
      failed++;
      await dbLocal.syncQueue.update(item.id, {
        status: 'error',
        errorMsg: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    }
  }

  return { synced, failed };
}

export async function exportFullBackupJson(): Promise<string> {
  const backup = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    settings: await dbLocal.settings.toArray(),
    warehouses: await dbLocal.warehouses.toArray(),
    products: await dbLocal.products.toArray(),
    customers: await dbLocal.customers.toArray(),
    suppliers: await dbLocal.suppliers.toArray(),
    sales: await dbLocal.sales.toArray(),
    returns: await dbLocal.returns.toArray(),
    purchases: await dbLocal.purchases.toArray(),
    cashboxAccounts: await dbLocal.cashboxAccounts.toArray(),
    cashTransactions: await dbLocal.cashTransactions.toArray(),
    expenses: await dbLocal.expenses.toArray(),
    accounts: await dbLocal.accounts.toArray(),
    journalEntries: await dbLocal.journalEntries.toArray(),
    employees: await dbLocal.employees.toArray(),
    shifts: await dbLocal.shifts.toArray(),
    stockMovements: await dbLocal.stockMovements.toArray(),
    stockCounts: await dbLocal.stockCounts.toArray(),
  };

  await dbLocal.settings.update('main', { lastBackupAt: new Date().toISOString() });
  return JSON.stringify(backup, null, 2);
}

export async function restoreFullBackupJson(jsonStr: string): Promise<void> {
  const data = JSON.parse(jsonStr);
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.settings)) {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }

  await dbLocal.transaction(
    'rw',
    [
      dbLocal.settings,
      dbLocal.warehouses,
      dbLocal.products,
      dbLocal.customers,
      dbLocal.suppliers,
      dbLocal.sales,
      dbLocal.returns,
      dbLocal.purchases,
      dbLocal.cashboxAccounts,
      dbLocal.cashTransactions,
      dbLocal.expenses,
      dbLocal.accounts,
      dbLocal.journalEntries,
      dbLocal.employees,
      dbLocal.shifts,
      dbLocal.stockMovements,
      dbLocal.stockCounts,
    ],
    async () => {
      if (data.settings?.length) await dbLocal.settings.bulkPut(data.settings);
      if (data.warehouses?.length) await dbLocal.warehouses.bulkPut(data.warehouses);
      if (data.products?.length) await dbLocal.products.bulkPut(data.products);
      if (data.customers?.length) await dbLocal.customers.bulkPut(data.customers);
      if (data.suppliers?.length) await dbLocal.suppliers.bulkPut(data.suppliers);
      if (data.sales?.length) await dbLocal.sales.bulkPut(data.sales);
      if (data.returns?.length) await dbLocal.returns.bulkPut(data.returns);
      if (data.purchases?.length) await dbLocal.purchases.bulkPut(data.purchases);
      if (data.cashboxAccounts?.length) await dbLocal.cashboxAccounts.bulkPut(data.cashboxAccounts);
      if (data.cashTransactions?.length) await dbLocal.cashTransactions.bulkPut(data.cashTransactions);
      if (data.expenses?.length) await dbLocal.expenses.bulkPut(data.expenses);
      if (data.accounts?.length) await dbLocal.accounts.bulkPut(data.accounts);
      if (data.journalEntries?.length) await dbLocal.journalEntries.bulkPut(data.journalEntries);
      if (data.employees?.length) await dbLocal.employees.bulkPut(data.employees);
      if (data.shifts?.length) await dbLocal.shifts.bulkPut(data.shifts);
      if (data.stockMovements?.length) await dbLocal.stockMovements.bulkPut(data.stockMovements);
      if (data.stockCounts?.length) await dbLocal.stockCounts.bulkPut(data.stockCounts);
    }
  );
}
