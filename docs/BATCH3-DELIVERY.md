# دفعة 3 — تسليم كامل (A → D)

**تاريخ:** 2026-07-21  
**اختبار شامل:** `npm run test:integration-batch3` (منفذ **4016**, DB: `data/cashier-batch3-audit.db`) — **9/9 ✅**

---

## ما تم تنفيذه

### المرحلة A — الفلوس
| بند | ملخص |
|-----|------|
| **#14** | تسوية رصيد العميل: `GET/POST /api/customers/:id/reconcile`, `GET /api/customers/reconcile-all` |
| **#7** | `expectedCash` في الوردية = افتتاح + CASH − REFUND + سندات − مصروفات + `cashBreakdown` |
| **#18** | `utils/salesAggregates.ts` — Dashboard / كشف / تقارير نقد موحّد |

### المرحلة B — سلامة البيانات
| بند | ملخص |
|-----|------|
| **#21** | جدول `AuditLog` + `GET /api/audit` (ADMIN) + تسجيل confirm/cancel/return/delete/reconcile/restore |
| **#13** | Optimistic lock: `updatedAt` في `PATCH /sales/:id` → **409** عند تعارض |
| **#17** | `stockOut` ذرّي: `updateMany` where `qty >= need` |

### المرحلة C — سريعة
| بند | ملخص |
|-----|------|
| **#19** | سياسة اليوم المحلي عبر `localDayRange` في `salesAggregates` (تقارير/كشف) |
| **#8** | تأكيد فاتورة على وردية **CLOSED** → ربط بوردية OPEN أو `null` + audit `SHIFT_REBIND` |
| **#10** | `supplierRef` + unique per supplier + **409** عند التكرار |
| **#23** | رسالة استعادة + audit؛ **يُفضَّل إعادة تشغيل API/Electron** بعد الاستعادة |
| **#16** | تحذير «سعر أقل من التكلفة» في شاشة البيع |
| **#24** | إصلاح `saveInvoice`: تحقق CREDIT **قبل** `setLoading(true)` |

### المرحلة D — ETA (#28)
| بند | ملخص |
|-----|------|
| **مفتاح** | `eta_enabled=false` افتراضياً — **صفر تأثير** على البيع |
| **Queue** | `EtaDocument` + enqueue عند التأكيد/المرتجع (عند التفعيل فقط) |
| **Worker** | `startEtaScheduler()` كل 60ث + `POST /api/eta/process` |
| **Mock** | `ETA_MOCK_SUBMIT=true` في الاختبار → `SUBMITTED` بدون شبكة |
| **API** | `GET /api/eta/status`, `GET /api/eta/documents`, retry |

**قرار #20:** الإرجاع الجزئي للكاشير **مسموح** — يُسجَّل في Audit Log.

**مؤجّل:** #11, #12 (عروض أسعار).

---

## تشغيل الاختبارات

```bash
npm run test:integration-batch3
npm run test:integration-batch2
npm run test:integration-batch1
```

---

## ETA للإنتاج (مصر)

1. من الإعدادات: فعّل `eta_enabled` بعد إدخال `eta_client_id`, `eta_rin`, `eta_pos_serial`, `eta_doc_type` (`receipt` لـ B2C / `invoice` لـ B2B).
2. جرّب `preprod` ثم `prod`.
3. **فشل الإرسال لا يمنع البيع** — الطابور يعيد المحاولة.

---

## Git

ملفات الدفعة 3 جاهزة للـ commit. إذا فشل الـ commit سابقاً بسبب `user.name/email`، نفّذ محلياً:

```powershell
cd E:\CASR
git add docs/BATCH3-* apps/api packages/db scripts/integration-batch3-audit.cjs
git commit -m "Batch 3 complete: audit, shift, ETA module, phases A-D"
```
