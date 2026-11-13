import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErpProvider, useErp } from './context/ErpContext';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { SalesPage } from './pages/SalesPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CustomersPage } from './pages/CustomersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { CashboxPage } from './pages/CashboxPage';
import { AccountingPage } from './pages/AccountingPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { ShiftsPage } from './pages/ShiftsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ReportsPage } from './pages/ReportsPage';
import { OfflineSyncPage } from './pages/OfflineSyncPage';
import { SettingsPage } from './pages/SettingsPage';

import {
  NAV_ITEMS,
  canAccessRoute,
  getDefaultRouteForEmployee,
} from './lib/permissions';
import type { PermissionKey } from './types/erp';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

const NoPermissionsView: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-md mx-auto mt-12 space-y-2">
    <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
      لا توجد صلاحيات مفعّلة لهذا الحساب
    </h2>
    <p className="text-xs text-slate-500 dark:text-slate-400">
      يرجى التواصل مع مدير النظام لتفعيل الصلاحيات المناسبة أو التبديل لحساب آخر من القائمة العلوية.
    </p>
  </div>
);

const RequirePermission: React.FC<{
  required: PermissionKey[];
  children: React.ReactElement;
}> = ({ required, children }) => {
  const { currentEmployee } = useErp();
  if (canAccessRoute(currentEmployee, required)) {
    return children;
  }
  const fallback = getDefaultRouteForEmployee(currentEmployee);
  if (!fallback) {
    return <NoPermissionsView />;
  }
  return <Navigate to={fallback} replace />;
};

const permsFor = (path: string): PermissionKey[] =>
  NAV_ITEMS.find((item) => item.to === path)?.requiredPermissions || [];

const ErpRouter: React.FC = () => {
  const { ready, currentEmployee } = useErp();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-[#0B1F3A] text-teal-400 flex items-center justify-center font-extrabold">
            SP
          </div>
          <div className="text-sm font-bold">جاري تهيئة Smart POS ERP وقاعدة البيانات المحلية...</div>
        </div>
      </div>
    );
  }

  const defaultRoute = getDefaultRouteForEmployee(currentEmployee) || '/pos';

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<RequirePermission required={permsFor('/')}><DashboardPage /></RequirePermission>} />
        <Route path="/pos" element={<RequirePermission required={permsFor('/pos')}><PosPage /></RequirePermission>} />
        <Route path="/products" element={<RequirePermission required={permsFor('/products')}><ProductsPage /></RequirePermission>} />
        <Route path="/inventory" element={<RequirePermission required={permsFor('/inventory')}><InventoryPage /></RequirePermission>} />
        <Route path="/sales" element={<RequirePermission required={permsFor('/sales')}><SalesPage /></RequirePermission>} />
        <Route path="/purchases" element={<RequirePermission required={permsFor('/purchases')}><PurchasesPage /></RequirePermission>} />
        <Route path="/customers" element={<RequirePermission required={permsFor('/customers')}><CustomersPage /></RequirePermission>} />
        <Route path="/suppliers" element={<RequirePermission required={permsFor('/suppliers')}><SuppliersPage /></RequirePermission>} />
        <Route path="/cashbox" element={<RequirePermission required={permsFor('/cashbox')}><CashboxPage /></RequirePermission>} />
        <Route path="/accounting" element={<RequirePermission required={permsFor('/accounting')}><AccountingPage /></RequirePermission>} />
        <Route path="/expenses" element={<RequirePermission required={permsFor('/expenses')}><ExpensesPage /></RequirePermission>} />
        <Route path="/returns" element={<RequirePermission required={permsFor('/returns')}><ReturnsPage /></RequirePermission>} />
        <Route path="/shifts" element={<RequirePermission required={permsFor('/shifts')}><ShiftsPage /></RequirePermission>} />
        <Route path="/employees" element={<RequirePermission required={permsFor('/employees')}><EmployeesPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission required={permsFor('/reports')}><ReportsPage /></RequirePermission>} />
        <Route path="/offline-sync" element={<RequirePermission required={permsFor('/offline-sync')}><OfflineSyncPage /></RequirePermission>} />
        <Route path="/settings" element={<RequirePermission required={permsFor('/settings')}><SettingsPage /></RequirePermission>} />
        <Route path="*" element={<Navigate to={defaultRoute} replace />} />
      </Routes>
    </AppLayout>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErpProvider>
          <ErpRouter />
        </ErpProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
