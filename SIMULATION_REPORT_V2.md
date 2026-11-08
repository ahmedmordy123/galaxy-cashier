# تقرير محاكاة عميل v1.1 — SIMULATION_REPORT_V2

- **البدء:** 2026-11-08T12:50:27.900Z
- **الانتهاء:** 2026-11-08T12:50:39.932Z
- **الوضع:** win-unpacked-1.1 · health 2046ms
- **القاعدة:** `C:\Users\Nour Soft\Documents\CASR\data\cashier.db`
- **القرارات:** 1أ exclusive بعد الخصم · 2أ أنواع أسعار موجودة · تقريب قرشين · مرتجع = إجمالي بالظبط

## نتائج الفحوص

| فحص | نتيجة | تفاصيل |
|------|--------|--------|
| health ok | ✅ | win-unpacked-1.1 2046ms |
| admin login | ✅ | — |
| settings exclusive VAT | ✅ | EXCLUSIVE |
| create cashier canEditPrice | ✅ | 201 |
| catalog seeded | ✅ | +exempt cmw7tymi1000f11brsdrak2qw |
| shift open | ✅ | 201 |
| G0 sale ok | ✅ | — |
| G0 total 266.76 | ✅ | 266.76 |
| G0 tax 32.76 | ✅ | 32.76 |
| G0 netOfTax 234 | ✅ | 234 |
| G0 profit 34 | ✅ | 34 |
| G0 partial return ok | ✅ | 200 |
| G0 remaining ≈133.38 | ✅ | 133.38 |
| G0 second return (residual) ok | ✅ | 200 |
| G0 fully returned total 0 | ✅ | 0 |
| price override sale | ✅ | 17.1 |
| exempt mix sale ok | ✅ | — |
| exempt mix tax≈18.2 | ✅ | 18.2 |
| exempt mix total≈228.2 | ✅ | 228.2 |
| reports sales ok | ✅ | — |
| reports profit ok | ✅ | — |
| profit ≤ sales (VAT out) | ✅ | p=9424.55 s=10732.799999999992 |
| audit endpoint | ✅ | 200 |

**المجموع:** 23/23

## الأيام العشرة (حركة خفيفة)

| يوم | مبيعات ناجحة | هدف | فشل |
|-----|--------------|-----|-----|
| 2026-10-30 | 12 | 12 | 0 |
| 2026-10-31 | 15 | 15 | 0 |
| 2026-11-01 | 18 | 18 | 0 |
| 2026-11-02 | 21 | 21 | 0 |
| 2026-11-03 | 24 | 24 | 0 |
| 2026-11-04 | 12 | 12 | 0 |
| 2026-11-05 | 15 | 15 | 0 |
| 2026-11-06 | 18 | 18 | 0 |
| 2026-11-07 | 21 | 21 | 0 |
| 2026-11-08 | 24 | 24 | 0 |

## ملاحظات

- Golden G0: 2×130 −10% +14% exclusive = 266.76 · ربح 34 · مرتجع قطعة 133.38.
- الربح من الصافي بدون ضريبة؛ تقارير الربح ≤ إجمالي المبيعات عند وجود VAT.
- EXE: `apps/desktop/dist/Galaxy Cashier Setup 1.1.0.exe`.
