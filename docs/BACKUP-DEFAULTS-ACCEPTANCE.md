# قبول — افتراضيات النسخ (24 ساعة + عند الإغلاق)

**وقت:** 2026-07-22T06:56:33.886Z

## تركيب جديد (seed client)

- auto_backup_interval_hours: `24` → **✅**
- backup_on_exit: `true` → **✅**
- النتيجة: **✅**

## تركيب قديم (ضبط يدوي 6 ساعات)

- auto_backup_interval_hours: `6` → **✅ بقي 6**

## نسخ عند الإغلاق — الإجابة

- **API/seed الجديد:** `backup_on_exit=true` في seed + fallback API `'true'`.
- **Electron:** `readBackupPathConfig()` — `onExit: true` افتراضياً.
- **الواجهة:** backupOnExit initial state true؛ !== false عند التحميل.
