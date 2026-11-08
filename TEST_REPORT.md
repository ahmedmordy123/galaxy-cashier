# TEST_REPORT — Galaxy Cashier (CASR) — الحالة النهائية

**آخر تحديث:** 2026-11-08 (المرحلة 4)  
**القاعدة:** لا يُعلَّم شيء «شغال» بدون تشغيل/اختبار فعلي.

---

## قنوات الاختبار

| القناة | المعنى |
|--------|--------|
| **DEV/API** | سكربتات Node ضد API معزول |
| **EXE / Setup** | `win-unpacked` + تثبيت `Galaxy Cashier Setup 1.0.0.exe` من التوزيع |
| **PORTABLE** | `Galaxy Cashier 1.0.0.exe` من مجلد TEMP |

التوزيع النهائي: `Galaxy-Cashier-Distribution-v1.0.0\`

---

## 1) منطق المبيعات / المخزون / الآجل (DEV)

| السيناريو | النتيجة |
|-----------|---------|
| Smoke يوم عمل كامل | PASS 12/12 |
| بيع+خصم+ضريبة+مرتجع جزئي+آجل+RBAC+race | PASS 22/22 (`qa-phase2-api`) |
| COGS: مرتجع نفس اليوم / تغيّر تكلفة / بيع+إلغاء | PASS 10/10 (`qa-cogs-edge-cases`) |
| تقارير vs SQLite | PASS 16/16 (`qa-reports-vs-sqlite`) |
| Restore فوري بدون restart | PASS (`qa-fix-restore`) |
| ترحيل AppData مرة واحدة | PASS (`qa-fix-appdata-migrate`) |

---

## 2) EXE النهائي (المرحلة 4) — 13/13 PASS

ملف: `docs/QA-PHASE4-FINAL-EXE.json`

| السيناريو | نتيجة |
|-----------|--------|
| Setup + Portable في مجلد التوزيع | PASS |
| win-unpacked healthy + login | PASS |
| Restore فوري (packaged) | PASS |
| auto-backup config (enabled, interval, keepCount=30) | PASS |
| `--sales` single-instance بدون spawn | PASS |
| Portable من TEMP → Documents DB، بلا تكرار | PASS |
| Setup `/S` + تشغيل من Program Files + نفس مسار DB | PASS |

---

## 3) إصلاح COGS (ملخص)

انظر `docs/COGS-FIX.md`.  
حساب التقرير فقط؛ لا تأثير على مخزون/فواتير مخزّنة. لا سكربت تصحيح (لا عملاء إنتاج).

---

## 4) النسخ الاحتياطي التلقائي

موجود ويعمل:

- مجدول كل 5 دقائق يفحص الاستحقاق (`autoBackup.scheduler`) — افتراضي كل **6 ساعات**، يحتفظ بآخر **30** (`auto_backup_keep_count`)
- عند **إغلاق التطبيق** (`backup_on_exit`)
- عند **إقفال الوردية** (أُضيف في المرحلة 4 + prune)
- قابل للضبط من الإعدادات

---

## 5) لم يُجرَّب

| البند | السبب |
|------|--------|
| **طباعة حرارية على طابعة ورق حقيقية** | يحتاج طابعة/قبول حوار Windows يدوياً؛ تم التحقق من RTL + أنماط 58/80مم فقط |
| **Setup على جهاز نضيف تماماً (بدون AppData/Documents سابقة)** | الجهاز الحالي فيه بيانات/تثبيت سابق؛ أول تشغيل+seed اُختبر بإخفاء DB مؤقتاً على نفس الجهاز، وليس VM نظيف |

---

## 6) الجودة

| فحص | نتيجة |
|-----|--------|
| `tsc` API | 0 errors |
| lint API | 0 errors |
| lint Web | warnings hooks فقط (CameraScanner) — شاشات البيع/التقارير ذات الصلة اصلحت |
| `electron:build` | EXIT 0 — Setup (13:36) + Portable (13:45، نفس staging) في التوزيع؛ `package.json` يستهدف الاثنين معاً |

---

## 7) الخلاصة

النظام جاهز للتسليم من `Galaxy-Cashier-Distribution-v1.0.0` بعد إثبات Restore وsingle-instance وPortable وSetup على هذا الجهاز. المتبقي اليدوي فقط: تجربة طباعة ورق، واختياري جهاز نضيف كامل.
