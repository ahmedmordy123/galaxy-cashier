# CHANGELOG — Galaxy Cashier (CASR)

---

## 2026-11-08 — v1.1.0

- **تسليم مؤكَّد:** Setup+Portable 1.1.0 smoke 16/16 · حساب مستقل 7/7 · edge أ/ب/ج 14/14 · ترحيل v1.0→v1.1 16/16 — `docs/V1.1.0-DELIVERY-CONFIRMATION.md`.
- **Portable:** مرآة DB تحت `ProgramData\GalaxyCashier` عند وجود مسافة في مسار المستخدم (إصلاح Prisma code 14 من استخراج TEMP).
- **تعديل سعر البيع في الفاتورة:** صلاحية `canEditPrice` · سياسة أقل من التكلفة BLOCK/WARN · Audit `PRICE_OVERRIDE` · الربح على السعر الفعلي − التكلفة.
- **ضريبة القيمة المضافة:** تشغيل/إيقاف · شاملة/مضافة (بعد الخصم) · إعفاء صنف `taxExempt` · لقطة ضريبة على الفاتورة · المرتجع يحترم وقت البيع.
- **تقريب:** إجمالي الفاتورة لقرشين · مجموع المرتجعات الكاملة = الإجمالي الأصلي بالظبط (`allocateExactTotal` + residual).
- **Golden G0 (معتمد):** 2×130 −10% +14% exclusive → **266.76** · ربح **34** · مرتجع قطعة **133.38** · `qa-golden-vat-exclusive-math` 15/15.
- **محاكاة:** `SIMULATION_REPORT_V2.md` — 23/23 على win-unpacked 1.1 + 10 أيام تشغيل.
- **توزيع:** `Galaxy Cashier Setup 1.1.0.exe` · lint/tsc نظيف.

---

## 2026-11-08 — v1.0.0

- توزيع نهائي: `Galaxy-Cashier-Distribution-v1.0.0` (Setup + Portable) بعد `electron:build`.
- **إصلاح:** تقرير الربح يطابق `invoice.total` (خصم الفاتورة) · `qa-profit-discount` 5/5.
- **إصلاح:** توزيع خصم FIXED عند المرتجع الجزئي (`remainingDiscountValue`) · golden G4.
- **Golden tests:** G1–G4 في `docs/GOLDEN-SCENARIOS.md` · `qa-golden-accounting` 22/22.
- **Backup:** مسار نسخة ثانية (فلاشة/خارجي) + مرآة best-effort؛ خروج بمهلة حتى لا يتعطّل الإغلاق.
- EXE suite على التوزيع: 13/13 · تأكيد: `docs/V1.0.0-RELEASE-CONFIRMATION.md`.
- محاكاة عميل: `SIMULATION_REPORT.md`.

---

## 2026-11-08 — مرحلة QA 4 (إصلاح نهائي + توزيع)

### إصلاحات حرجة
- **Restore فوري:** عميل Prisma موحّد + `disconnect`/`reconnect` قبل/بعد استبدال ملف SQLite — الاستعادة تظهر بدون إعادة تشغيل البرنامج.
- **Single-instance `--sales`:** `app.exit(0)` عند فشل القفل؛ الإطلاق الثاني ينتقل فقط إلى `/sales/new` بدون إعادة spawn للـ API.
- **مسار بيانات واحد:** `Documents\CASR\data\cashier.db` لـ Setup و Portable؛ ترحيل AppData **مرة واحدة** مع `.appdata-migrated`.
- **COGS ملخص اليوم:** مرتجع كامل لنفس اليوم كان يصفّر التكلفة بالخطأ — الخصم فقط لمرتجعات أيام سابقة (`docs/COGS-FIX.md` + `qa-cogs-edge-cases` 10/10).

### تحسينات
- **Backup عند إقفال الوردية** + prune لآخر N (مع المجدول كل 5 دقائق / فترة الإعدادات / عند الخروج).
- **Hooks:** مسح رصيد العميل فوراً عند تغيير العميل في شاشة البيع؛ تحليل مبيعات ودفتر صنف بدون بيانات قديمة عند تغيير الفلاتر.

### جودة وتوزيع
- lint/tsc API نظيف؛ web lint بدون أخطاء حرجة.
- `electron:build` ناجح؛ `Galaxy-Cashier-Distribution-v1.0.0` محدّث (Setup + Portable).
- اختبارات EXE النهائية **13/13** (`docs/QA-PHASE4-FINAL-EXE.json`).

### لم يُنفَّذ / لم يُختبر
- طباعة حرارية على طابعة حقيقية.
- تثبيت Setup على جهاز نضيف بالكامل (VM).

---

## المرحلة 0 — الفحص والقرارات (بدون تنفيذ كود)

- **Discovery + Audit Report** (`docs/DISCOVERY.md`, `docs/AUDIT-REPORT.md`): خريطة الموديولات، مخاطر الضريبة/الخصم/الشراء/الائتمان/المخزون/الورديات.
- **قرارات معتمدة لاحقاً:** ضريبة **Inclusive**، خصم **نسبة + مبلغ ثابت**، شراء **CASH/CREDIT**، `creditLimit=0` = **منع الآجل**، منع تجاوز حد الائتمان عند التأكيد/الإنشاء.
- **مؤجّل بالاتفاق:** تاريخ صلاحية **عرض السعر (Quote expiry)** — لم يُنفَّذ.

---

## المرحلة 1 — منطق الأعمال والـ API

| المجال | ما تم |
|--------|--------|
| **ضريبة شاملة** | `salesTotals.ts` — أسعار شامل الضريبة؛ تطبيق في مبيعات، عروض، إرجاعات؛ واجهة البيع تعرض الض.ق.م المستخرجة لا المضافة. |
| **خصم الفاتورة** | `discountType` PERCENT/FIXED في schema + `ensureSqliteSchema` + validators. |
| **إرجاع مبيعات** | كامل/جزئي: `stockIn`، سيريالات، `REFUND` للنقد؛ الجزئي يبقي `CONFIRMED` ويحدّث `total`. |
| **تأكيد فاتورة** | claim ذري `DRAFT/PARKED → CONFIRMED` قبل `stockOut`. |
| **ائتمان** | `creditErrors.ts`: `CREDIT_NOT_ALLOWED` @ limit≤0؛ `CREDIT_LIMIT_EXCEEDED` مع المتاح والفاتورة؛ JSON `code` من الـ controller. |
| **كشف الصندوق** | `cashSalesEGP` من CASH − REFUND في `SalesPayment`. |
| **مشتريات** | `paymentType` CASH/CREDIT؛ النقدي لا يزيد `supplier.balance`. |
| **استيراد Excel** | مزامنة `StockBalance` مع الكمية. |
| **تقرير اليوم** | `netSalesEGP` = مجموع CONFIRMED (بدون طرح مزدوج بعد جزئي)； إرجاع كامل: gross − returns. |

---

## المرحلة 2 — الواجهة (Web)

- **بيع:** inclusive totals، خصم %/مبلغ، F2/F4/Esc، تنبيه ائتمان، تحذيرات متوافقة مع API.
- **ورديات:** إقفال أوضح (متوقع vs فعلي).
- **مشتريات:** اختيار نقدي/آجل.
- **تقارير:** بطاقات يوم + مخطط 7 أيام؛ حقول API `*EGP`.
- **طباعة حرارية:** `?paper=58|80`، `thermalReceiptStyles.ts`، ت layout مضغوط 58مم؛ معاينة PDF: `scripts/generate-invoice-preview-pdf.cjs` → `docs/invoice-preview-{58,80}mm.pdf`.

---

## المرحلة 3 — إصلاحات P0/P1 (ما قبل/أثناء الدفعة)

- مصروفات: `categoryId` + coerce مبلغ + رسائل عربية مع `details`.
- QuickAdd / أصناف: `name_en` فارغ، validator.
- تواريخ ومعرفات اختيارية: empty→null، coerce أرقام في sales/voucher/stock/item.
- **Schema تلقائي عند تشغيل API:** `ensureSqliteSchema.ts` (`discountType`, `paymentType`, …).

---

## المرحلة 4 — تسمية العملة (EGP)

- استبدال حقول/متغيرات المبالغ `*IQD` → `*EGP` في التطبيق والاختبارات (`netSalesEGP`, `cashSalesEGP`, …).
- **SQLite:** أعمدة legacy `*IQD` محفوظة عبر Prisma `@map` — **لا تغيير في دقة الحساب**؛ كانت تسمية legacy (قيم فعلية جنيه مصري). قبول `IQD` في validators للبيانات القديمة فقط.

---

## المرحلة 5 — اختبارات آلية

| سكربت | المنفذ | الغرض |
|--------|--------|--------|
| `scripts/integration-batch1.cjs` | 4012 | **12** سenario: كاش/مرتجع/ائتمان/شراء/خصم/سيريال/quote/وردية/migration/**تقرير جزئي #12** |
| `scripts/integration-smoke-e2e.cjs` | 4014 | يوم عمل: وردية → بيع → شراء → إرجاع → إقفال → تقرير |
| `npm run test:integration-batch1` / `test:smoke-e2e` | — | أوامر package.json |

**ملاحظة تشغيل:** تحرير المنفذ قبل API الاختبار (`killListenersOnPort`)؛ نسخ DB مع `ensureTestDbSchema` + تنظيف `CashStatement` اليوم في batch1.

---

## مراجع سريعة

- معاينة طباعة: `docs/PRINT-PREVIEW-AR.md`
- تقرير الفحص الأصلي: `docs/AUDIT-REPORT.md`
- بيانات تجريبية API: `admin` / `admin123`؛ DB: `E:\CASR\data\cashier.db`؛ API dev: **4001**

---

---

## 2026-07-21 — الدفعة الثانية (أمان / backup / تزامن)

- **RBAC:** سكربت `integration-batch2-audit.cjs` — لا bypass لـ CASHIER على endpoints إدارية (401/403).
- **Backup/Restore:** نسخ فعلي + إفساد DB + استعادة — تطابق counts 100%.
- **Concurrency:** confirm متوازي qty=1 → نجاح واحد فقط.
- **تقرير:** `docs/AUDIT-BATCH2-REPORT.md` + متابعة 28 بند.
- **npm:** `test:integration-batch2`.

## 2026-07-21 — دفعة 3 المرحلة A (فلوس)

- **#14:** `computeCustomerBalance` + `GET/POST /customers/:id/reconcile` + `GET /customers/reconcile-all`.
- **#7:** `expectedCash` = افتتاح + CASH − REFUND + سندات − مصروفات (فترة الوردية) + `cashBreakdown`.
- **#18:** `utils/salesAggregates.ts` — كشف اليوم و`today-summary` يتشاركان نفس نقد المبيعات.
- **RBAC:** CASHIER يقدر يسجّل مصروف/سند صرف للدرج.
- **اختبار:** `npm run test:integration-batch3` (منفذ **4016**).


- **DELETE وهمي:** items / customers / suppliers / expense-categories → **404** + `sendRouteError` (لا stack في 500).
- **قفل حساب:** `User.failedLoginAttempts` + `lockedUntil` — 5 فشل → 20 دقيقة (**423**).
- **Backup #22:** `assertEnoughDiskSpace` قبل النسخ → **507** عند نقص المساحة.
- **Rate limit login:** **IP فقط** — max **25** محاولة فاشلة / 15 دقيقة (`skipSuccessfulRequests`؛ **423** في العداد). قفل الحساب **5/username** منفصل في DB.
- **تقرير:** جدول **28/28** في `docs/AUDIT-BATCH2-REPORT.md`؛ batch2 **exit 0**.

## 2026-07-21 — دفعة 3 كاملة (B → D)

- **#21 Audit Log:** `GET /api/audit` + شاشة `/settings/audit`.
- **#13:** قفل optimist + واجهة تمرّر `updatedAt` وتعيد التحميل عند 409.
- **#17:** `stockOut` ذرّي.
- **#8 / #10 / #19 / #23 / #28:** rebind وردية، `supplierRef`، `localDayRange`، رسالة إعادة تشغيل بعد الاستعادة، موديول ETA + تبويب إعدادات + شارة على الفاتورة.
- **#16 / #24:** تحذير بيع بخسارة + إصلاح loading على الآجل.
- **تسليم:** `docs/BATCH3-DELIVERY.md` + جدول 28 بند محدّث.
- **اختبار:** `npm run test:integration-batch3` (9/9).

*آخر تحديث: 2026-07-21 — دفعة 3 كاملة + تسليم.*
