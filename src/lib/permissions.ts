import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  FileText,
  Truck,
  Users,
  Building2,
  Landmark,
  BookOpen,
  Receipt,
  RotateCcw,
  Clock,
  UserCheck,
  BarChart3,
  RefreshCw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Employee, PermissionKey, UserRole } from '../types/erp';

export interface NavItemConfig {
  to: string;
  label: string;
  icon: LucideIcon;
  requiredPermissions: PermissionKey[];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  system_admin: 'مدير النظام',
  store_manager: 'مدير المحل',
  accountant: 'محاسب',
  warehouse_keeper: 'مسؤول المخزن',
  cashier: 'كاشير',
};

export const PERMISSION_LABELS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'pos.sell', label: 'البيع (الكاشير)' },
  { key: 'pos.edit_price', label: 'تعديل الأسعار بالبيع' },
  { key: 'pos.discount', label: 'منح الخصومات' },
  { key: 'pos.cancel_invoice', label: 'إلغاء الفواتير' },
  { key: 'pos.returns', label: 'إدارة المرتجعات' },
  { key: 'products.view', label: 'عرض المنتجات' },
  { key: 'products.manage', label: 'إدارة المنتجات والأسعار' },
  { key: 'inventory.manage', label: 'إدارة المخازن والجرد' },
  { key: 'purchases.manage', label: 'إدارة المشتريات' },
  { key: 'customers.manage', label: 'إدارة العملاء' },
  { key: 'suppliers.manage', label: 'إدارة الموردين' },
  { key: 'cashbox.manage', label: 'إدارة الخزينة والبنوك' },
  { key: 'accounting.view', label: 'عرض المحاسبة والتقارير المالية' },
  { key: 'accounting.manage', label: 'تسجيل القيود وإقفال الفترة' },
  { key: 'expenses.manage', label: 'إدارة المصروفات' },
  { key: 'shifts.manage', label: 'إدارة الورديات' },
  { key: 'employees.manage', label: 'إدارة الموظفين والصلاحيات' },
  { key: 'reports.view', label: 'لوحة التحكم والتقارير' },
  { key: 'reports.export', label: 'تصدير التقارير' },
  { key: 'settings.manage', label: 'الإعدادات والمزامنة والنسخ' },
];

export const NAV_ITEMS: NavItemConfig[] = [
  { to: '/', label: 'لوحة التحكم', icon: LayoutDashboard, requiredPermissions: ['reports.view'] },
  { to: '/pos', label: 'نقطة البيع (الكاشير)', icon: ShoppingCart, requiredPermissions: ['pos.sell'] },
  { to: '/products', label: 'المنتجات والباركود', icon: Package, requiredPermissions: ['products.view', 'products.manage'] },
  { to: '/inventory', label: 'المخازن والجرد', icon: Warehouse, requiredPermissions: ['inventory.manage'] },
  { to: '/sales', label: 'المبيعات وعروض الأسعار', icon: FileText, requiredPermissions: ['pos.sell', 'reports.view'] },
  { to: '/purchases', label: 'المشتريات والموردين', icon: Truck, requiredPermissions: ['purchases.manage'] },
  { to: '/customers', label: 'العملاء والولاء', icon: Users, requiredPermissions: ['customers.manage'] },
  { to: '/suppliers', label: 'إدارة الموردين', icon: Building2, requiredPermissions: ['suppliers.manage'] },
  { to: '/cashbox', label: 'الخزينة والبنوك', icon: Landmark, requiredPermissions: ['cashbox.manage'] },
  { to: '/accounting', label: 'المحاسبة والقيود', icon: BookOpen, requiredPermissions: ['accounting.view', 'accounting.manage'] },
  { to: '/expenses', label: 'المصروفات', icon: Receipt, requiredPermissions: ['expenses.manage'] },
  { to: '/returns', label: 'المرتجعات', icon: RotateCcw, requiredPermissions: ['pos.returns'] },
  { to: '/shifts', label: 'الورديات', icon: Clock, requiredPermissions: ['shifts.manage'] },
  { to: '/employees', label: 'الموظفين والرواتب', icon: UserCheck, requiredPermissions: ['employees.manage'] },
  { to: '/reports', label: 'التقارير والتحليلات', icon: BarChart3, requiredPermissions: ['reports.view'] },
  { to: '/offline-sync', label: 'المزامنة والأمان', icon: RefreshCw, requiredPermissions: ['settings.manage'] },
  { to: '/settings', label: 'الإعدادات والضرائب', icon: Settings, requiredPermissions: ['settings.manage'] },
];

export function canAccessRoute(
  employee: Employee | null,
  requiredPermissions: PermissionKey[]
): boolean {
  if (!employee || !employee.active) return false;
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.some((perm) => employee.permissions.includes(perm));
}

export function getAllowedNavItems(employee: Employee | null): NavItemConfig[] {
  return NAV_ITEMS.filter((item) => canAccessRoute(employee, item.requiredPermissions));
}

export function getDefaultRouteForEmployee(employee: Employee | null): string | null {
  const allowed = getAllowedNavItems(employee);
  return allowed.length > 0 ? allowed[0].to : null;
}

export function getRequiredPermissionsForPath(pathname: string): PermissionKey[] | null {
  const match = NAV_ITEMS.find((item) => item.to === pathname);
  return match ? match.requiredPermissions : null;
}
