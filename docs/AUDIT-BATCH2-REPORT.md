# الدفعة الثانية — الأمان / النسخ / التزامن / متابعة 28 بند

**تاريخ:** 2026-07-21 (تحديث: إصلاحات 500→404، قفل حساب، فحص قرص)  
**سكربت:** `node scripts/integration-batch2-audit.cjs` (منفذ API **4015**, DB: `data/cashier-batch2-audit.db`)

---

## Priority 1 — صلاحيات API (RBAC)

### منهجية
- كل مسارات `/api/*` (ما عدا `/api/auth/login`) تمر عبر `verifyToken` على مستوى الـ router.
- أدوار مقيدة بـ `requireRole(...)` لكل endpoint حساس.
- اختبار آلي: بدون token، `cashier1`، `manager1`، `admin` على عينة endpoints.

### نتيجة **Critical**
| سؤال | نتيجة |
|--------|--------|
| CASHIER يعدّي على حذف صنف / إعدادات / users / backup / profit / حذف عميل / مشتريات / cancel؟ | **لا — كلها 403 أو 401** ✅ |
| بدون token؟ | **401** ✅ |

**لا يوجد Critical bypass** لدور CASHIER على العينة أعلاه.

### إصلاحات تمت (ليست bypass)
| Endpoint | قبل | بعد |
|----------|-----|-----|
| `DELETE /items/:id` (معرّف غير موجود) | 500 + احتمال تسريب | **404** + رسالة عامة عبر `sendRouteError` |
| `DELETE /customers/:id` | 500 | **404** |
| `DELETE /suppliers/:id` | 500 | **404** |
| `DELETE /expense-categories/:id` | 500 (Prisma P2025) | **404** |

أي **500** متبقٍ في مسارات محدّثة يُرجع `fallbackMessage` فقط (لا stack / مسارات ملفات).

### Auth
| بند | الحالة |
|-----|--------|
| كلمات المرور | **bcrypt** ✅ |
| JWT | Access **15m**، Refresh **7d** ✅ |
| Rate limit | **25** محاولة **فاشلة** / 15 دقيقة **لكل IP** (منفصل عن قفل username) — **423 و401** تُحسب؛ النجاح لا يُحسب ✅ |
| **قفل الحساب** | بعد **5** محاولات فاشلة على **نفس username** → قفل **20 دقيقة** (`User.lockedUntil`, HTTP **423**) ✅ |
| VIEWER في التقارير | مذكور في routes؛ **لا user VIEWER في seed** — لم يُختبر |

---

## Priority 2 — النسخ الاحتياطي والاستعادة

### اختبار فعلي (في السكربت)
1. نسخ `cashier.db` → DB تجريبي + إنشاء عميل/صنف عبر API.
2. Snapshot: counts + `SUM(SalesInvoice.total)`.
3. نسخة `.db` في `Documents\CASR\backups\batch2-test-*.db`.
4. إفساد الملف التجريبي (truncate).
5. استعادة من النسخة.
6. مقارنة — **تطابق 100%** ✅

### نسخ تلقائي
| بند | الحالة |
|-----|--------|
| Scheduler | `startAutoBackupScheduler()` → `runScheduledBackupIfDue` ✅ |
| `POST /api/backup/auto-run` | **200** في الاختبار ✅ |
| `auto_backup_*` / prune | من `Settings` ✅ |
| **فحص مساحة القرص** (#22) | `assertEnoughDiskSpace` قبل `copyFileSync`؛ نقص المساحة → **507** + رسالة عربية ✅ |
| إعادة تشغيل Prisma بعد restore | **غير موثّق/آلي** (#23) ⚠️ |

---

## Priority 3 — التزامن (كاشيران، qty=1)

**✅** طلبان `confirm` متوازيان على فاتورتين لنفس الصنف (مخزون 1):

- نجاح واحد **200**، فشل الثاني **400**
- `stockQty = 0` بعد الاختبار

---

## Priority 4 — جدول كامل الـ 28 بند (`AUDIT-REPORT.md`)

| # | الموديول | المشكلة | السيناريو | الخطورة | الحالة | ملاحظة |
|---|----------|---------|-----------|---------|--------|--------|
| 1 | مبيعات / مخزون | الإرجاع الكامل والجزئي يحدّث `Item.stockQty` فقط دون `StockBalance` أو مخزن الفاتورة | إرجاع بعد بيع من مخزن محدد؛ `stockOut` خصم من `StockBalance` عند التأكيد | **Critical** | ✅ منجز | دفعة 1 — `stockIn`/`stockOut` على مخزن الفاتورة |
| 2 | مبيعات / سيريال | الإرجاع لا يعيد `ItemSerial` إلى `IN_STOCK` | بيع IMEI ثم إرجاع؛ السيريال يبقى `SOLD` | **Critical** | ✅ منجز | دفعة 1 |
| 3 | مبيعات | لا فحص لـ `creditLimit` عند تأكيد CREDIT | عميل تجاوز الحد؛ الفاتورة تُؤكَّد و`balance` يزيد | **Critical** | ✅ منجز | `CREDIT_NOT_ALLOWED` / `CREDIT_LIMIT_EXCEEDED` |
| 4 | مبيعات | احتمال **تأكيد مزدوج** (race): قراءتان لـ `DRAFT` ثم تنفيذ `stockOut` مرتين | دبل-كليك سريع أو طلبان متزامnan | **Critical** | ✅ منجز | claim ذري |
| 5 | كشف الصندوق | مبيعات نقدية = `SUM(total)` وليس `SUM(SalesPayment WHERE method=CASH)` | دفع مختلط (كاش + بطاقة) | **Critical** | ✅ منجز | دفعة 1 |
| 6 | كشف الصندوق | لا خصم **مرتجعات نقدية** من إجمالي اليوم | إرجاع فاتورة CASH؛ الكشف يبقي مبيعات اليوم كاملة | **Critical** | ✅ منجز | REFUND |
| 7 | وردية | `expectedCash` = افتتاح + CASH من فواتير الوردية فقط؛ لا سندات/مصروف/مرتجع | كاشير يسدّد مصروفاً أو يرجع نقداً؛ فرق غير موثّق | **High** | ✅ منجز | دفعة 3 — `computeShiftCashBreakdown` + CASHIER مصروف/سند |
| 8 | وردية | فاتورة تُنشأ بـ `shiftId` عند الإنشاء؛ **لا يُمنع التأكيد بعد إقفال الوردية** | إقفال وردية ثم تأكيد مسودة قديمة تُربَط بوردية مغلقة | **Medium** | ✅ منجز | دفعة 3 — rebind + audit |
| 9 | مشتريات | تأكيد الشراء يزيد `supplier.balance` **دائماً** | شراء نقدي مُسدَّد فوراً يظهر كدين على المورد | **High** | ✅ منجز | CASH/CREDIT |
| 10 | مشتريات | لا حقل/تحقق لـ **رقم فاتورة المورد** | تكرار نفس رقم مورد لدفترين | **Medium** | ✅ منجز | دفعة 3 — `supplierRef` unique |
| 11 | عروض أسعار | `convertQuoteToSale` يحوّل إلى DRAFT **بدون** تحديث أسعار من `Item` | سعر صنف تغيّر بعد العرض؛ الفاتورة تحتفظ بأسعار العرض | **Low/Medium** | ⏳ | سياسة منتج |
| 12 | عروض أسعار | لا **تاريخ صلاحية** للعرض (`status QUOTE` فقط) | عرض قديم يُحوَّل دون تحذير | **Medium** | ⏳ مؤجّل | اتفاق صاحب المشروع |
| 13 | فواتير معلّقة | لا قفل optimist على `PARKED` | جهازان يفتحان نفس المعلّقة؛ آخر حفظ يفوز | **High** | ✅ منجز | دفعة 3 — 409 + `updatedAt` |
| 14 | عملاء | كشف الحساب يعرض قوائم؛ **`customer.balance` لا يُ reconciled** مع مجموع الحركات | رصيد UI ≠ فواتير − سندات بعد تعديل يدوي/خطأ | **High** | ✅ منجز | دفعة 3 — reconcile GET/POST + reconcile-all |
| 15 | منتجات | استيراد Excel يكتب `stockQty` على `Item` **بدون** `StockBalance` | استيراد كميات؛ البيع يخصم من balance فيصبح سالباً | **Critical** | ✅ منجز | دفعة 1 |
| 16 | منتجات | لا تحذير عند سعر بيع < التكلفة | بيع بخسارة صامت | **Low** | ✅ منجز | تحذير في شاشة البيع |
| 17 | مخزون / SQLite | `stockOut`: read qty ثم decrement — **race** بين كاشيرين على نفس الصنف | كمية تُباع مرتين رغم insufficient إذا متزامnan | **High** | ✅ منجز | دفعة 3 — `updateMany` ذرّي |
| 18 | تقارير vs كشف | `reports.service.ts` يخصم `RETURNED`؛ **cashStatement** لا | مقارنة يومية بين dashboard وتقرير وكشف | **High** | ✅ منجز | دفعة 3 — `salesAggregates.ts` |
| 19 | تقارير | فلتر التاريخ `setHours` محلي — خطر timezone على سervers UTC | فاتورة قرب منتصف الليل تظهر في يوم خاطئ | **Medium** | ✅ منجز | `localDayRange` في `salesAggregates` |
| 20 | أمان / صلاحيات | CASHIER يستطيع **partial-return** على API رغم إخفاء UI | دور أوسع من المطلوب تجارياً | **Medium** | ✅ | مسموح + Audit Log (#21) |
| 21 | أمان | لا **Audit Log** في DB | حذف/إلغاء فاتورة بلا أثر من عمل من | **High** | ✅ منجز | دفعة 3 — `GET /api/audit` |
| 22 | نسخ احتياطي | لا فحص **مساحة قرص** قبل `copyFileSync` | قرص ممتلئ؛ نسخة تالفة/ناقصة | **Medium** | ✅ منجز | `diskSpace.ts` |
| 23 | نسخ احتياطي | الاستعادة تستبدل الملف؛ **لا إعادة تشغيل Prisma/API** موثّقة | استعادة while running — سلوك غير محدد | **Medium** | ✅ منجز | رسالة API + واجهة «أعد التشغيل» |
| 24 | واجهة مبيعات | `saveInvoice`: return مبكر عند CREDIT بدون عميل **بعد** `setLoading(true)` | زر يعلق loading | **Low** | ✅ منجز | تحقق قبل `setLoading` |
| 25 | إعدادات | الضريبة **Exclusive فقط** — لا `tax_inclusive` | توقع «السعر شامل ضريبة» | **Medium** | ✅ منجز | inclusive في الإعدادات |
| 26 | إرجاع جزئي | لا يقلل `SalesPayment` CASH في كشف/وردية بشكل متسق | مرتجع جزئي CASH؛ نقد متوقع أعلى من الواقع | **Critical** | ✅ منجز | دفعة 1 |
| 27 | طباعة | لم يُفحص RTL فعلياً (يتطلب Preview) | — | **Medium** | ✅ جزئي | PDF 58/80 |
| 28 | ETA | `EtaDocument` موجود — تكامل غير مُراجع | — | **Low** | ✅ منجز | دفعة 3 — مفتاح `eta_enabled` + طابور + mock |

**رموز:** ✅ منجز (كامل أو دفعة 1) · ⚠️ جزئي/سياسة · ⏳ لم يُنفَّذ أو مؤجّل بقرار

---

## Critical مكتشف أثناء الدفعة الثانية

**لا** — لم يُكتشف تجاوز صلاحيات Critical.  
**Medium سابق (500 على DELETE)** — **مُصلَح** في هذه الجولة.

---

## تشغيل

```bash
npm run db:generate   # بعد تحديث User lock columns
node scripts/integration-batch2-audit.cjs
```

يُنشئ `manager1` / `cashier1` / `locktest1` على DB التجريبي.
