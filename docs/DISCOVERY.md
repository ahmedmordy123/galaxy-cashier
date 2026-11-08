# Galaxy Cashier (CASR) — Phase 1 Discovery

> مرجع مختصر للفحص التفصيلي. مبني على قراءة الكود في `E:\CASR` (يوليو 2026).

## 1. البنية العامة

| طبقة | المسار | التقنية |
|------|--------|---------|
| Monorepo | `E:\CASR` | npm workspaces + Turbo |
| API | `apps/api` | Express, TypeScript, port افتراضي **4000** (Desktop **4001**) |
| Web UI | `apps/web` | Next.js 14, port **3001** |
| Desktop | `apps/desktop` | Electron يشغّل API محلياً + يفتح الواجهة |
| DB package | `packages/db` | Prisma + **SQLite** |
| Shared types | `packages/types` | أدوار المستخدم `@ims-pro/types` |

**تشغيل:** `DATABASE_URL=file:../../data/cashier.db` (تطوير)، Desktop: `%AppData%\CASR\cashier.db`.

**نسخ احتياطي:** `Documents\CASR\backups` — `apps/api/src/services/backup.service.ts` + `jobs/autoBackup.scheduler.ts` (فحص كل 5 دقائق).

**عند بدء API:** `ensureSqliteSchema()` (`apps/api/src/db/ensureSqliteSchema.ts`) لمزامنة جداول/أعمدة ناقصة على قواعد قديمة.

## 2. قاعدة البيانات (Prisma / SQLite)

**24 نموذجاً** في `packages/db/prisma/schema.prisma`:

User, Category, Supplier, Warehouse, Item, StockBalance, Customer, SalesInvoice, SalesInvoiceItem, SalesPayment, PurchaseInvoice, PurchaseInvoiceItem, ExpenseCategory, Expense, StockTransfer, StockCount, StockCountLine, ItemSerial, CashierShift, PaymentVoucher, CashStatement, ExchangeRateHistory, Settings, EtaDocument.

**قيود مهمة (مُتحقق من Schema):**

- `Item.barcode` — `@unique` (SQLite).
- `StockBalance` — `@@unique([itemId, warehouseId])`.
- `ItemSerial` — `@@unique([itemId, serial])`.
- `SalesInvoice.invoiceNumber`, `PurchaseInvoice.invoiceNumber` — `@unique`.

**حالات الفاتورة (نص في `status`):** مبيعات: `DRAFT | PARKED | CONFIRMED | CANCELLED | RETURNED | QUOTE`. مشتريات: `DRAFT | CONFIRMED | CANCELLED | RETURNED`.

## 3. نقاط الدخول (API)

كل المسارات تحت `/api/*` ما عدا `/health`. Routers في `apps/api/src/index.ts`:

| Prefix | ملف routes |
|--------|------------|
| `/api/auth` | `auth.routes.ts` |
| `/api/items` | `item.routes.ts` |
| `/api/customers` | `customer.routes.ts` |
| `/api/suppliers` | `supplier.routes.ts` |
| `/api/sales` | `sales.routes.ts` |
| `/api/purchases` | `purchase.routes.ts` |
| `/api/expenses`, `/api/expense-categories` | `expense.routes.ts` |
| `/api/vouchers` | `voucher.routes.ts` |
| `/api/stock` | `stock.routes.ts` |
| `/api/cash-statement` | `cashStatement.routes.ts` |
| `/api/settings` | `settings.routes.ts` |
| `/api/reports` | `reports.routes.ts` |
| `/api/quotes` | `quotes.routes.ts` |
| `/api/backup` | `backup.routes.ts` |
| `/api/ops` | `ops.routes.ts` (ورديات، إلخ) |

**Web:** Next.js `apps/web/src/app/(dashboard)/*` — حماية الصفحات عبر `middleware.ts` (وجود cookie `__refresh_token` فقط، **بدون** فحص دور على مستوى الواجهة).

**Background:** مجدول النسخ الاحتياطي فقط (لا Cron jobs أخرى في الكود).

## 4. المصادقة والأدوار

- **JWT:** access 15m + refresh cookie — `auth.service.ts` (bcrypt لـ `passwordHash`).
- **Middleware:** `verifyToken` على routers؛ `requireRole(...)` per-route.
- **الأدوار في النوع:** `ADMIN`, `MANAGER`, `CASHIER`, `VIEWER`, `ACCOUNTANT`, `STAFF`.
- **Login brute-force:** rate limit 5 محاولات / 15 دقيقة **لكل IP** (`auth.routes.ts`) — ليس قفل حساب per-user.

**ملاحظة:** `VIEWER` يظهر أساساً في `reports.routes.ts`; باقي الموديولات غالباً `ADMIN | MANAGER | CASHIER | STAFF` (أو أضيق للإلغاء/الإرجاع الكامل).

## 5. تدفقات مالية/مخزون (مرجع سريع)

| عملية | خدمة رئيسية | تأثير مخزون |
|--------|-------------|-------------|
| إنشاء فاتورة بيع | `sales.service.ts` `createSalesInvoice` | لا (DRAFT) |
| تأكيد بيع | `confirmInvoice` | `stockOut` + سيريال + رصيد عميل (CREDIT) |
| إرجاع / جزئي | `returnInvoice` / `partialReturnInvoice` | **زيادة `Item.stockQty` مباشرة** (انظر التقرير) |
| شراء | `purchase.service.ts` | مخزون عند **CONFIRM** + `supplier.balance += total` |
| تحويل مخازن | `stock-ops.service.ts` `transferBetweenWarehouses` | OUT ثم IN في transaction |
| جرد | `warehouse.service.ts` `confirmStockCount` | تسوية عبر stockIn/stockOut |
| وردية | `shift.service.ts` | ربط `shiftId` عند **إنشاء** الفاتورة؛ إقفال يحسب نقد من `SalesPayment` CASH |

**إعدادات الضريبة:** مفتاح `tax_rate` في `Settings` — تُقرأ عند **إنشاء/تحديث** الفاتورة وتُخزَّن `tax` و`total` على السجل (لا إعادة حساب تلقائي للقديم عند تغيير الإعداد).

## 6. سكربتات مساعدة للفحص

- `scripts/phase1-audit.js`, `scripts/stress-audit.js` — اختبارات/ضغط (لم تُشغَّل في هذه الجولة).

---

**الخطوة التالية:** تقرير الفحص الموحّد `docs/AUDIT-REPORT.md` — **لا تنفيذ إصلاحات قبل الموافقة.**
