import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { dbLocal, seedDatabaseIfEmpty } from '../db/dexie';
import {
  auth,
  ensureUserAndStoreInFirestore,
  signInWithGoogle,
  signOutFirebase,
  testConnection,
} from '../lib/firebase';
import { getOrCreateDeviceId } from '../lib/crypto';
import { syncQueueToFirestore } from '../services/erpEngine';
import type { Employee, PermissionKey, StoreSettings } from '../types/erp';

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface ErpContextValue {
  ready: boolean;
  firebaseUser: User | null;
  firebaseConnected: boolean;
  currentEmployee: Employee | null;
  settings: StoreSettings | null;
  isLocked: boolean;
  theme: 'light' | 'dark';
  toasts: ToastMessage[];
  notify: (text: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;
  toggleTheme: () => Promise<void>;
  switchEmployee: (employeeId: string, pinCode?: string) => Promise<boolean>;
  unlockScreen: (pinCode: string) => boolean;
  lockScreen: () => void;
  hasPermission: (perm: PermissionKey) => boolean;
  refreshAll: () => Promise<void>;
  handleGoogleLogin: () => Promise<void>;
  handleGoogleLogout: () => Promise<void>;
  triggerSyncNow: () => Promise<void>;
}

const ErpContext = createContext<ErpContextValue | null>(null);

export const ErpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadLocalState = useCallback(async () => {
    await seedDatabaseIfEmpty();
    const s = await dbLocal.settings.get('main');
    const emps = await dbLocal.employees.toArray();
    if (s) {
      setSettings(s);
      setTheme(s.theme);
      document.documentElement.classList.toggle('dark', s.theme === 'dark');
    }
    const savedEmpId = localStorage.getItem('smart_pos_active_employee') || 'emp-admin';
    const found =
      emps.find((e) => e.id === savedEmpId && e.active) ||
      emps.find((e) => e.active) ||
      null;
    if (found && found.id !== savedEmpId) {
      localStorage.setItem('smart_pos_active_employee', found.id);
    }
    setCurrentEmployee(found);
    setReady(true);
  }, []);

  const refreshAll = useCallback(async () => {
    await loadLocalState();
    await queryClient.invalidateQueries();
  }, [loadLocalState, queryClient]);

  useEffect(() => {
    loadLocalState();
    testConnection().then(setFirebaseConnected);

    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user && user.emailVerified) {
        const s = await dbLocal.settings.get('main');
        if (s) {
          await ensureUserAndStoreInFirestore(
            user,
            `store_${user.uid}`,
            s.storeName,
            s.businessType,
            s.taxNumber,
            s.commercialRegister,
            s.customBusinessType
          );
          if (s.autoSyncEnabled && navigator.onLine) {
            await syncQueueToFirestore();
            await queryClient.invalidateQueries();
          }
        }
      }
    });

    return () => unsub();
  }, [loadLocalState, queryClient]);

  useEffect(() => {
    const handleOnlineSync = async () => {
      const s = await dbLocal.settings.get('main');
      if (s?.autoSyncEnabled && auth.currentUser) {
        const res = await syncQueueToFirestore();
        if (res.synced > 0) {
          notify(`تمت مزامنة ${res.synced} عملية معلقة مع السحابة`, 'success');
          await queryClient.invalidateQueries();
        }
      }
    };
    window.addEventListener('online', handleOnlineSync);
    return () => window.removeEventListener('online', handleOnlineSync);
  }, [notify, queryClient]);

  const toggleTheme = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    await dbLocal.settings.update('main', { theme: next });
    setSettings((prev) => (prev ? { ...prev, theme: next } : prev));
  };

  const switchEmployee = async (employeeId: string, pinCode?: string): Promise<boolean> => {
    const emp = await dbLocal.employees.get(employeeId);
    const deviceId = getOrCreateDeviceId();
    if (!emp || !emp.active) {
      await dbLocal.loginAttempts.put({
        id: `la-${Date.now()}`,
        identifier: employeeId,
        deviceId,
        success: false,
        reason: 'موظف غير نشط',
        createdAt: new Date().toISOString(),
      });
      return false;
    }
    if (pinCode !== undefined && emp.pinCode !== pinCode) {
      await dbLocal.loginAttempts.put({
        id: `la-${Date.now()}`,
        identifier: emp.email,
        deviceId,
        success: false,
        reason: 'رمز PIN غير صحيح',
        createdAt: new Date().toISOString(),
      });
      notify('رمز التحقق PIN غير صحيح', 'error');
      return false;
    }
    await dbLocal.loginAttempts.put({
      id: `la-${Date.now()}`,
      identifier: emp.email,
      deviceId,
      success: true,
      reason: 'دخول ناجح',
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('smart_pos_active_employee', emp.id);
    setCurrentEmployee(emp);
    notify(`تم التبديل إلى حساب ${emp.name}`, 'success');
    return true;
  };

  const unlockScreen = (pinCode: string): boolean => {
    if (!currentEmployee) return false;
    if (currentEmployee.pinCode === pinCode) {
      setIsLocked(false);
      return true;
    }
    return false;
  };

  const lockScreen = () => setIsLocked(true);

  const hasPermission = useCallback(
    (perm: PermissionKey) => {
      if (!currentEmployee) return false;
      return currentEmployee.permissions.includes(perm);
    },
    [currentEmployee]
  );

  const handleGoogleLogin = async () => {
    try {
      const user = await signInWithGoogle();
      notify(`تم تسجيل الدخول السحابي: ${user.email}`, 'success');
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل تسجيل الدخول', 'error');
    }
  };

  const handleGoogleLogout = async () => {
    await signOutFirebase();
    notify('تم تسجيل الخروج من الحساب السحابي', 'info');
  };

  const triggerSyncNow = async () => {
    if (!auth.currentUser) {
      notify('يرجى تسجيل الدخول بحساب Google أولاً للمزامنة السحابية', 'info');
      return;
    }
    if (!navigator.onLine) {
      notify('أنت غير متصل بالإنترنت — ستبقى العمليات في قائمة الانتظار بأمان', 'info');
      return;
    }
    const res = await syncQueueToFirestore();
    notify(`تمت المزامنة: ${res.synced} ناجحة، ${res.failed} أخطاء`, res.failed > 0 ? 'error' : 'success');
    await queryClient.invalidateQueries();
  };

  return (
    <ErpContext.Provider
      value={{
        ready,
        firebaseUser,
        firebaseConnected,
        currentEmployee,
        settings,
        isLocked,
        theme,
        toasts,
        notify,
        dismissToast,
        toggleTheme,
        switchEmployee,
        unlockScreen,
        lockScreen,
        hasPermission,
        refreshAll,
        handleGoogleLogin,
        handleGoogleLogout,
        triggerSyncNow,
      }}
    >
      {children}
    </ErpContext.Provider>
  );
};

export function useErp() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error('useErp must be used within ErpProvider');
  return ctx;
}
