import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Sun,
  Moon,
  Lock,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  Cloud,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertCircle,
  KeyRound,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import { BusinessTypeModal } from './BusinessTypeModal';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useQuery } from '@tanstack/react-query';
import { dbLocal } from '../db/dexie';
import {
  NAV_ITEMS,
  ROLE_LABELS,
  canAccessRoute,
  getAllowedNavItems,
  getDefaultRouteForEmployee,
} from '../lib/permissions';
import type { Employee } from '../types/erp';

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    settings,
    currentEmployee,
    theme,
    toggleTheme,
    isLocked,
    lockScreen,
    unlockScreen,
    toasts,
    dismissToast,
    firebaseUser,
    handleGoogleLogin,
    handleGoogleLogout,
    triggerSyncNow,
    switchEmployee,
    hasPermission,
  } = useErp();

  const isOnline = useOnlineStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [bizModalOpen, setBizModalOpen] = useState(false);
  const [empMenuOpen, setEmpMenuOpen] = useState(false);
  const [switchTargetEmp, setSwitchTargetEmp] = useState<Employee | null>(null);
  const [switchPinInput, setSwitchPinInput] = useState('');
  const [switchPinError, setSwitchPinError] = useState('');
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    setLogoError(false);
  }, [settings?.storeLogoUrl]);

  const { data: pendingSyncCount = 0 } = useQuery({
    queryKey: ['pendingSyncCount'],
    queryFn: async () => dbLocal.syncQueue.where('status').anyOf(['pending', 'error']).count(),
    refetchInterval: 3000,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => dbLocal.employees.toArray(),
  });

  const activeEmployees = employees.filter((emp) => emp.active);
  const allowedNavItems = getAllowedNavItems(currentEmployee);
  const currentNav = NAV_ITEMS.find((n) => n.to === location.pathname) || allowedNavItems[0] || NAV_ITEMS[0];

  const completeEmployeeSwitch = async (emp: Employee, pin?: string) => {
    const ok = await switchEmployee(emp.id, pin);
    if (!ok) return false;
    setEmpMenuOpen(false);
    setSwitchTargetEmp(null);
    setSwitchPinInput('');
    setSwitchPinError('');
    const currentItem = NAV_ITEMS.find((n) => n.to === location.pathname);
    if (!currentItem || !canAccessRoute(emp, currentItem.requiredPermissions)) {
      const nextRoute = getDefaultRouteForEmployee(emp);
      if (nextRoute) {
        navigate(nextRoute, { replace: true });
      }
    }
    return true;
  };

  const handleSelectEmployee = async (emp: Employee) => {
    if (emp.id === currentEmployee?.id) {
      setEmpMenuOpen(false);
      return;
    }
    if (currentEmployee?.role !== 'system_admin') {
      setEmpMenuOpen(false);
      setSwitchTargetEmp(emp);
      setSwitchPinInput('');
      setSwitchPinError('');
      return;
    }
    await completeEmployeeSwitch(emp);
  };

  const handleConfirmSwitchPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!switchTargetEmp) return;
    const ok = await completeEmployeeSwitch(switchTargetEmp, switchPinInput);
    if (!ok) {
      setSwitchPinError('رمز PIN غير صحيح');
    }
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockScreen(pinInput)) {
      setPinInput('');
      setPinError('');
    } else {
      setPinError('رمز PIN غير صحيح (الافتراضي للمدير: 1234)');
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden no-print"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Collapsible Navy Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 right-0 z-40 h-screen bg-[#0B1F3A] text-slate-100 flex flex-col border-l border-slate-800 transition-all duration-200 no-print ${
          collapsed ? 'lg:w-[72px]' : 'lg:w-[256px]'
        } ${mobileOpen ? 'translate-x-0 w-[256px]' : 'translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
          {!collapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              {settings?.storeLogoUrl && !logoError ? (
                <img
                  src={settings.storeLogoUrl}
                  alt={settings.storeName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-teal-500 text-[#0B1F3A] flex items-center justify-center font-extrabold text-sm shrink-0">
                  SP
                </div>
              )}
              <span className="font-display font-extrabold text-base text-white truncate">
                {settings?.storeName || 'Smart POS ERP'}
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
          >
            {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-teal-600 text-white font-semibold'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {!collapsed && settings && (
          <div className="p-3 border-t border-white/10 text-xs">
            {hasPermission('settings.manage') ? (
              <button
                onClick={() => setBizModalOpen(true)}
                className="w-full text-right rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 transition-colors"
              >
                <div className="text-slate-400 text-[11px]">النشاط التجاري</div>
                <div className="font-semibold text-teal-300 mt-0.5 truncate">
                  {settings.businessType === 'none'
                    ? 'بدون نشاط محدد'
                    : settings.businessType === 'custom'
                    ? settings.customBusinessType || 'نشاط مخصص'
                    : settings.businessType === 'pharmacy'
                    ? 'صيدلية ومستحضرات'
                    : settings.businessType === 'retail'
                    ? 'محل تجاري وإلكترونيات'
                    : 'سوبر ماركت وبقالة'}
                </div>
                {settings.businessType === 'none' && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    اضغط لإضافة أو كتابة النشاط
                  </div>
                )}
              </button>
            ) : (
              <div className="w-full text-right rounded-lg bg-white/5 px-3 py-2">
                <div className="text-slate-400 text-[11px]">النشاط التجاري</div>
                <div className="font-semibold text-teal-300 mt-0.5 truncate">
                  {settings.businessType === 'none'
                    ? 'بدون نشاط محدد'
                    : settings.businessType === 'custom'
                    ? settings.customBusinessType || 'نشاط مخصص'
                    : settings.businessType === 'pharmacy'
                    ? 'صيدلية ومستحضرات'
                    : settings.businessType === 'retail'
                    ? 'محل تجاري وإلكترونيات'
                    : 'سوبر ماركت وبقالة'}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract) */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 no-print">
          {/* Zone 1: Page Title & Mobile Menu */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              aria-label="فتح القائمة"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base lg:text-lg font-extrabold text-[#0B1F3A] dark:text-white truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          {/* Zone 2: Sync & Connectivity Controls */}
          <div className="hidden md:flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <button
              onClick={triggerSyncNow}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              title="مزامنة الآن"
            >
              <Cloud className={`w-3.5 h-3.5 ${isOnline ? 'text-teal-600' : 'text-amber-500'}`} />
              <span>{isOnline ? 'متصل' : 'غير متصل'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">معلق: {pendingSyncCount}</span>
            </button>

            {firebaseUser ? (
              <button
                onClick={handleGoogleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                title={firebaseUser.email || ''}
              >
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
                <span className="max-w-[140px] truncate">{firebaseUser.displayName || firebaseUser.email}</span>
              </button>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5 text-teal-600" />
                <span>ربط السحابة (Google)</span>
              </button>
            )}
          </div>

          {/* Zone 3: Primary Actions & User Switcher */}
          <div className="flex items-center gap-2 shrink-0 relative">
            <PWAInstallButton />

            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري'}
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              onClick={lockScreen}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="قفل الشاشة"
            >
              <Lock className="w-4 h-4" />
            </button>

            <button
              onClick={() => setEmpMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg bg-[#0B1F3A] text-white px-3 py-1.5 text-xs font-semibold hover:bg-[#133159] transition-colors whitespace-nowrap shrink-0"
            >
              <span>{currentEmployee?.name?.split(' ')[0] || 'المستخدم'}</span>
            </button>

            {empMenuOpen && (
              <div className="absolute left-0 top-12 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-2 z-50">
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 border-b border-slate-100 dark:border-slate-800 mb-1">
                  تبديل الموظف النشط (RBAC)
                </div>
                {activeEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => handleSelectEmployee(emp)}
                    className={`w-full text-right px-2.5 py-2 rounded-lg text-xs flex items-center justify-between gap-2 ${
                      emp.id === currentEmployee?.id
                        ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-bold'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{emp.name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0">{ROLE_LABELS[emp.role]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Toast Notifications */}
      <div className="fixed top-20 left-4 z-50 space-y-2 max-w-sm no-print">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={`cursor-pointer flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-xs font-semibold shadow-lg border ${
              t.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-700'
                : t.type === 'error'
                ? 'bg-rose-600 text-white border-rose-700'
                : 'bg-[#0B1F3A] text-white border-slate-700'
            }`}
          >
            {t.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {/* Lock Screen Overlay */}
      {isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F3A]/95 p-4">
          <form
            onSubmit={handleUnlock}
            className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center"
          >
            <div className="w-12 h-12 mx-auto rounded-xl bg-teal-600 text-white flex items-center justify-center mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              الشاشة مقفلة
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              أدخل رمز PIN للموظف: {currentEmployee?.name}
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="رمز PIN (الافتراضي 1234)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-center font-mono text-base tracking-widest mb-2"
            />
            {pinError && <p className="text-xs text-rose-600 mb-2">{pinError}</p>}
            <button
              type="submit"
              className="w-full rounded-lg bg-teal-600 py-2.5 text-sm font-bold text-white hover:bg-teal-700 transition-colors"
            >
              فتح القفل
            </button>
          </form>
        </div>
      )}

      {/* Employee Switch PIN Verification Modal */}
      {switchTargetEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 no-print">
          <form
            onSubmit={handleConfirmSwitchPin}
            className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-3"
          >
            <div className="w-11 h-11 mx-auto rounded-xl bg-[#0B1F3A] text-teal-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                تأكيد رمز التحقق (PIN)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                أدخل رمز PIN للتبديل إلى: <strong className="text-slate-800 dark:text-slate-200">{switchTargetEmp.name}</strong> ({ROLE_LABELS[switchTargetEmp.role]})
              </p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              required
              value={switchPinInput}
              onChange={(e) => {
                setSwitchPinInput(e.target.value);
                setSwitchPinError('');
              }}
              placeholder="أدخل رمز PIN"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-center font-mono text-base tracking-widest"
            />
            {switchPinError && <p className="text-xs text-rose-600">{switchPinError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSwitchTargetEmp(null);
                  setSwitchPinInput('');
                  setSwitchPinError('');
                }}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-teal-600 py-2 text-xs font-bold text-white hover:bg-teal-700 transition-colors"
              >
                تبديل الحساب
              </button>
            </div>
          </form>
        </div>
      )}

      <OfflineIndicator />
      {hasPermission('settings.manage') && (
        <BusinessTypeModal open={bizModalOpen} onClose={() => setBizModalOpen(false)} />
      )}
    </div>
  );
};
