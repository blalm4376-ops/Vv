export type BusinessType = 'supermarket' | 'pharmacy' | 'retail' | 'custom' | 'none';

export type UserRole =
  | 'system_admin'
  | 'store_manager'
  | 'accountant'
  | 'warehouse_keeper'
  | 'cashier';

export type PermissionKey =
  | 'pos.sell'
  | 'pos.edit_price'
  | 'pos.discount'
  | 'pos.cancel_invoice'
  | 'pos.returns'
  | 'products.view'
  | 'products.manage'
  | 'inventory.manage'
  | 'purchases.manage'
  | 'customers.manage'
  | 'suppliers.manage'
  | 'cashbox.manage'
  | 'accounting.view'
  | 'accounting.manage'
  | 'expenses.manage'
  | 'employees.manage'
  | 'shifts.manage'
  | 'reports.view'
  | 'reports.export'
  | 'settings.manage';

export interface PriceHistoryEntry {
  id: string;
  field: 'purchasePrice' | 'salePrice' | 'wholesalePrice';
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  changedAt: string;
}

export interface Product {
  id: string;
  code: string;
  sku: string;
  name: string;
  barcode: string;
  extraBarcodes: string[];
  category: string;
  brand: string;
  model: string;
  originCountry: string;
  imageUrl: string;
  description: string;
  unit: string;
  secondaryUnit?: string;
  conversionFactor: number;
  purchasePrice: number;
  salePrice: number;
  wholesalePrice: number;
  minSalePrice: number;
  taxRate: number;
  stockByWarehouse: Record<string, number>;
  reservedQty: number;
  minStockAlert: number;
  supplierId: string;
  status: 'active' | 'inactive' | 'archived';
  colors: string[];
  sizes: string[];
  expiryDate?: string;
  batchNumber?: string;
  serialNumbers: string[];
  warrantyMonths: number;
  priceHistory: PriceHistoryEntry[];
  isDeleted: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  location: string;
  isMain: boolean;
}

export type StockMovementType =
  | 'in'
  | 'out'
  | 'transfer'
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'damage'
  | 'purchase';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  warehouseId: string;
  targetWarehouseId?: string;
  type: StockMovementType;
  quantity: number;
  previousQty: number;
  newQty: number;
  unitCost: number;
  referenceId: string;
  reason: string;
  userId: string;
  createdAt: string;
}

export interface StockCountItem {
  productId: string;
  productName: string;
  bookQty: number;
  actualQty: number;
  diff: number;
  reason: string;
}

export interface StockCount {
  id: string;
  warehouseId: string;
  type: 'partial' | 'full';
  items: StockCountItem[];
  status: 'draft' | 'posted';
  createdBy: string;
  createdAt: string;
}

export interface PaymentScheduleItem {
  id: string;
  dueDate: string;
  amount: number;
  paid: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  taxNumber: string;
  openingBalance: number;
  creditLimit: number;
  totalPurchases: number;
  totalPaid: number;
  balance: number;
  tier: 'retail' | 'wholesale' | 'vip';
  loyaltyPoints: number;
  paymentSchedule: PaymentScheduleItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  taxNumber: string;
  openingBalance: number;
  totalPurchases: number;
  totalPaid: number;
  balance: number;
  rating: number;
  nextDueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'transfer' | 'credit';

export interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface SaleLineItem {
  productId: string;
  code: string;
  name: string;
  barcode: string;
  qty: number;
  unit: string;
  price: number;
  costPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  batchNumber?: string;
  serialNumber?: string;
}

export interface SaleInvoice {
  id: string;
  invoiceNumber: string;
  docType: 'invoice' | 'quotation' | 'sales_order';
  status: 'completed' | 'held' | 'cancelled' | 'converted';
  customerId: string;
  customerName: string;
  warehouseId: string;
  items: SaleLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  payments: PaymentSplit[];
  cashierId: string;
  cashierName: string;
  shiftId: string;
  notes?: string;
  eInvoiceUuid: string;
  etaQrPayload: string;
  etaStatus: 'prepared' | 'pending' | 'submitted';
  uuid: string;
  idempotencyKey: string;
  revision: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnLineItem {
  productId: string;
  name: string;
  qty: number;
  refundPrice: number;
  condition: 'good' | 'damaged';
  reason: string;
}

export interface ReturnInvoice {
  id: string;
  returnNumber: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  items: ReturnLineItem[];
  totalRefund: number;
  refundMethod: 'cash' | 'customer_credit';
  shiftId: string;
  userId: string;
  createdAt: string;
}

export interface PurchaseLineItem {
  productId: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
  allocatedShippingCost: number;
  discount: number;
  taxRate: number;
  total: number;
  batchNumber?: string;
  expiryDate?: string;
}

export interface PurchaseInvoice {
  id: string;
  purchaseNumber: string;
  docType: 'invoice' | 'po' | 'quote';
  status: 'received' | 'partial' | 'ordered' | 'cancelled';
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  items: PurchaseLineItem[];
  shippingCost: number;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashboxAccount {
  id: string;
  name: string;
  type: 'main_cash' | 'sub_cash' | 'bank';
  balance: number;
  openingBalance: number;
  accountNumber?: string;
}

export type CashTransactionType =
  | 'receipt'
  | 'payment'
  | 'transfer'
  | 'deposit'
  | 'withdrawal'
  | 'capital'
  | 'personal_draw'
  | 'variance'
  | 'sale'
  | 'purchase'
  | 'expense'
  | 'refund';

export interface CashTransaction {
  id: string;
  accountId: string;
  targetAccountId?: string;
  type: CashTransactionType;
  amount: number;
  category: string;
  referenceType: string;
  referenceId: string;
  description: string;
  userId: string;
  createdAt: string;
}

export type ExpenseCategory =
  | 'rent'
  | 'electricity'
  | 'water'
  | 'salaries'
  | 'maintenance'
  | 'transport'
  | 'marketing'
  | 'other';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  accountId: string;
  date: string;
  notes: string;
  receiptRef: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface AccountNode {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  balance: number;
}

export interface JournalLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  referenceType: string;
  referenceId: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  isPeriodClosing?: boolean;
  createdAt: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  permissions: PermissionKey[];
  baseSalary: number;
  commissionRate: number;
  pinCode: string;
  deviceId: string;
  active: boolean;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn: string;
  checkOut?: string;
  hoursWorked: number;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string;
  baseSalary: number;
  commissions: number;
  bonuses: number;
  advances: number;
  deductions: number;
  netSalary: number;
  paid: boolean;
  createdAt: string;
}

export interface Shift {
  id: string;
  cashierId: string;
  cashierName: string;
  openingCash: number;
  expectedCash: number;
  actualCash?: number;
  variance: number;
  salesTotal: number;
  cashSales: number;
  cardSales: number;
  walletSales: number;
  transferSales: number;
  creditSales: number;
  expensesTotal: number;
  returnsTotal: number;
  invoiceCount: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  module: string;
  details: string;
  deviceId: string;
  createdAt: string;
}

export interface LoginAttempt {
  id: string;
  identifier: string;
  deviceId: string;
  success: boolean;
  reason: string;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  entityType: 'product' | 'sale' | 'customer' | 'supplier' | 'purchase' | 'expense' | 'shift';
  entityId: string;
  action: 'create' | 'update';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  uuid: string;
  revision: number;
  version: number;
  status: 'pending' | 'synced' | 'conflict' | 'error';
  errorMsg?: string;
  createdAt: string;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  storeNameEn: string;
  address: string;
  phone: string;
  taxNumber: string;
  commercialRegister: string;
  currency: string;
  decimalPlaces: number;
  defaultTaxRate: number;
  vatEnabled: boolean;
  businessType: BusinessType;
  customBusinessType?: string;
  storeLogoUrl?: string;
  businessTypeSelected: boolean;
  invoiceFooter: string;
  printerWidth: '58mm' | '80mm' | 'A4';
  preventNegativeStock: boolean;
  preventConflictingShifts: boolean;
  maxCashierDiscountPct: number;
  allowCreditSales: boolean;
  valuationMethod: 'weighted_avg' | 'fifo';
  fiscalYearStart: string;
  fiscalYearClosedUntil?: string;
  twoFactorEnabled: boolean;
  trustedDeviceId: string;
  lastBackupAt?: string;
  autoSyncEnabled: boolean;
  theme: 'light' | 'dark';
}
