# Galaxy Cashier (CASR) — Features Audit (نهائي)

> **آخر تحديث:** 2026-11-08 — بعد المرحلة 4  
> **قاعدة:** `شغال` = إثبات بتشغيل/اختبار. التفاصيل: `TEST_REPORT.md`

**Stack:** Next.js 14 · Express · Prisma/SQLite · Electron

---

## ملخص سريع

| المجال | الحالة |
|--------|--------|
| مبيعات (إنشاء/تأكيد/مرتجع/خصم/ضريبة/آجل) | شغال |
| مخزون + منع السالب + concurrency | شغال |
| RBAC API | شغال |
| Restore فوري / Backup تلقائي / وردية | شغال |
| `--sales` single-instance | شغال |
| تقارير يوم + ربح vs SQLite | شغال |
| Portable + Setup (نفس مسار Documents) | شغال |
| طباعة حرارية ورق حقيقي | **لم يُجرَّب** |
| Setup على جهاز نضيف كامل | **لم يُجرَّب** |
| ETA إرسال حي | مش مكتمل (stub) |

---

## 1. المبيعات

| الاسم | الملفات | الحالة | ملاحظات |
|------|---------|--------|---------|
| إنشاء/تعديل DRAFT·PARKED | `sales.service` · `sales/new` | شغال | |
| تأكيد + خصم مخزون | `confirmInvoice` · `stockOut` | شغال | |
| Park / إلغاء / مرتجع كامل·جزئي | sales routes | شغال | cancel+return في COGS tests |
| خصم PERCENT/FIXED + ضريبة inclusive | `salesTotals.ts` | شغال | |
| آجل + تسديد | customer balance · vouchers | شغال | |
| `--sales` فاتورة جديدة | `main.js` | شغال | cold + warm |

## 2. أصناف / مخزون / عملاء / مشتريات / ورديات

| الاسم | الحالة |
|------|--------|
| أصناف+باركود+variants | موجود بالكود؛ smoke جزئي |
| مخزون/مخازن/جرد | شغال أساسي عبر API |
| عملاء+موردين+مشتريات | شغال (smoke شراء) |
| ورديات+سلف+صندوق | شغال؛ backup عند إقفال وردية |

## 3. تقارير

| الاسم | الحالة | ملاحظات |
|------|--------|---------|
| today-summary | شغال | COGS أصلح — edge tests 10/10 |
| sales / profit | شغال | مطابقة SQLite |
| باقي التقارير UI | مش متجرب بالكامل | endpoints موجودة |

## 4. Backup / Desktop

| الاسم | الحالة |
|------|--------|
| Backup يدوي + list | شغال |
| Restore فوري | شغال |
| Auto (مجدول + خروج + إقفال وردية) + keep N | شغال |
| DB في Documents (مش asar) | شغال |
| Portable/Setup يتشاركان DB | شغال |

## 5. Auth / جودة

| الاسم | الحالة |
|------|--------|
| Login JWT + bcrypt | شغال |
| RBAC backend | شغال |
| tsc/lint API | شغال |
| ETA حي | مش مكتمل |

---

## لم يُجرَّب (صريح)

1. **الطباعة الحرارية** على طابعة ورق فعلية (حوار النظام).  
2. **Setup على جهاز نضيف** بدون أي ملفات CASR سابقة (VM نظيف).

---

## مراجع

- `TEST_REPORT.md` — نتائج الاختبارات  
- `docs/COGS-FIX.md` — شرح مشكلة التكلفة  
- `docs/QA-PHASE4-FINAL-EXE.json` — EXE 13/13  
- `CHANGELOG.md` — ملخص 2026-11-08  
