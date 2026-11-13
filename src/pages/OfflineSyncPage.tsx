import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { dbLocal } from '../db/dexie';
import { useErp } from '../context/ErpContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { exportFullBackupJson, restoreFullBackupJson } from '../services/erpEngine';
import { encryptSensitivePayload, decryptSensitivePayload } from '../lib/crypto';

export const OfflineSyncPage: React.FC = () => {
  const { settings, triggerSyncNow, notify, refreshAll } = useErp();
  const isOnline = useOnlineStatus();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [backupPass, setBackupPass] = useState('SmartPos2026');
  const [encryptBackup, setEncryptBackup] = useState(true);

  const { data: queue = [] } = useQuery({
    queryKey: ['syncQueue'],
    queryFn: () => dbLocal.syncQueue.orderBy('createdAt').reverse().toArray(),
    refetchInterval: 3000,
  });

  const pendingCount = queue.filter((q) => q.status === 'pending' || q.status === 'error').length;

  const handleExportBackup = async () => {
    const raw = await exportFullBackupJson();
    const content = encryptBackup ? await encryptSensitivePayload(raw, backupPass) : raw;
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart_pos_backup_${new Date().toISOString().slice(0, 10)}.${encryptBackup ? 'enc' : 'json'}`;
    a.click();
    URL.revokeObjectURL(url);
    await refreshAll();
    notify('تم إنشاء النسخة الاحتياطية بنجاح', 'success');
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const plain = file.name.endsWith('.enc')
        ? await decryptSensitivePayload(text, backupPass)
        : text;
      await restoreFullBackupJson(plain);
      await refreshAll();
      notify('تمت استعادة البيانات من النسخة الاحتياطية بنجاح', 'success');
    } catch {
      notify('فشل فك تشفير أو استعادة النسخة الاحتياطية', 'error');
    }
    e.target.value = '';
  };

  const handleResolveConflict = async (id: string) => {
    await dbLocal.syncQueue.update(id, { status: 'pending', errorMsg: undefined });
    await refreshAll();
    notify('تمت إعادة جدولة العنصر للمزامنة', 'info');
  };

  return (
    <div className="space-y-5">
      {!isOnline && pendingCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-4 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <strong>تنبيه تباين أرصدة الأجهزة:</strong> توجد {pendingCount} عمليات محلية غير متزامنة بسبب انقطاع الإنترنت؛ قد تختلف الأرصدة اللحظية عن الأجهزة الأخرى لحين إتمام المزامنة.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">قائمة انتظار المزامنة (Offline Sync Queue)</h3>
            <button onClick={triggerSyncNow} className="flex items-center gap-1.5 rounded-lg bg-teal-600 text-white px-3.5 py-1.5 font-bold">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>مزامنة يدوية الآن</span>
            </button>
          </div>
          <p className="text-slate-500">
            معرف الجهاز الموثوق: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{settings?.trustedDeviceId}</span> · المزامنة التلقائية: {settings?.autoSyncEnabled ? 'مفعلة' : 'معطلة'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldCheck className="w-4 h-4 text-teal-600" />
            <span>النسخ الاحتياطي المشفر (AES-GCM) والاستعادة</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              value={backupPass}
              onChange={(e) => setBackupPass(e.target.value)}
              placeholder="كلمة مرور التشفير"
              className="rounded-lg border px-3 py-1.5 font-mono bg-slate-50 dark:bg-slate-800"
            />
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={encryptBackup} onChange={(e) => setEncryptBackup(e.target.checked)} />
              <span>تشفير النسخة محلياً</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleExportBackup} className="flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] text-white px-4 py-2 font-bold">
              <Download className="w-3.5 h-3.5" />
              <span>تصدير نسخة احتياطية</span>
            </button>
            <input ref={fileRef} type="file" accept=".json,.enc" onChange={handleRestore} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border px-4 py-2 font-semibold">
              <Upload className="w-3.5 h-3.5" />
              <span>استعادة من ملف</span>
            </button>
          </div>
          {settings?.lastBackupAt && (
            <div className="text-[11px] text-slate-500 font-mono">آخر نسخة: {new Date(settings.lastBackupAt).toLocaleString('ar-EG')}</div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">العملية</th>
              <th className="py-3 px-3">Idempotency Key</th>
              <th className="py-3 px-3">الإصدار / المراجعة</th>
              <th className="py-3 px-3">الحالة</th>
              <th className="py-3 px-4 text-left">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {queue.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">قائمة المزامنة نظيفة — جميع العمليات متزامنة.</td>
              </tr>
            ) : (
              queue.map((q) => (
                <tr key={q.id}>
                  <td className="py-2.5 px-4 font-semibold">{q.entityType} · {q.action}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">{q.idempotencyKey}</td>
                  <td className="py-2.5 px-3 font-mono">v{q.version} · rev {q.revision}</td>
                  <td className={`py-2.5 px-3 font-bold ${q.status === 'synced' ? 'text-emerald-600' : q.status === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
                    {q.status === 'synced' ? 'متزامن' : q.status === 'error' ? 'خطأ' : 'قيد الانتظار'}
                  </td>
                  <td className="py-2.5 px-4 text-left">
                    {q.status !== 'synced' && (
                      <button onClick={() => handleResolveConflict(q.id)} className="rounded border px-2.5 py-1 font-semibold">
                        إعادة المحاولة
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
