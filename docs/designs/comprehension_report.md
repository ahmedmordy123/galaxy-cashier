# Comprehension Report

**Target:** `E:\CASR\docs\designs\sahl-cashier-feel.md`
**FeatureRange:** 1–246
**DetailedRange:** 247–end

## Feature specification paraphrase

This change keeps the existing `/dashboard` landing page and turns it into a cashier launcher for CASHIER and STAFF only: four large buttons (new sale → `/sales/new`, treasury → `/shifts`, customers → `/customers`, items → `/items`) instead of a KPI-first screen. Treasury for those roles is the current shift page and the only cash figure is that user’s open-shift `expectedCash` from `computeShiftCashBreakdown` via `GET /api/ops/shifts/current/summary`. If no shift is open, the shift page tells them to open one; the app must not fetch or link the store-day cash statement. ADMIN, MANAGER, and ACCOUNTANT keep today’s KPI dashboard and use `/cash-statement` (`closingBalanceEGP`) as Treasury; VIEWER keeps KPIs/reports and does not get Treasury. CASHIER must not see item cost on screen or in the named item GET and today-summary JSON (`costPrice` omitted entirely, not nulled; COGS/profit fields dropped); confirm/return/shift still cost from the database. STAFF shares the large-button home but still receives cost because they edit items. Sidebar stays. New strings go through i18n. No new `/home` or `/treasury` route.

## Detailed implementation paraphrase

Create `navCatalog.ts`; Sidebar imports it. `/dashboard` branches CASHIER/STAFF to large buttons and skips cash-statement/low-stock fetches. Layout adds `ROUTE_ROLES` prefixes. Item reads drop `costPrice` for CASHIER. Today-summary omits COGS/profit for CASHIER. Shift summary gains `source: 'shift'`. POS hides cost for CASHIER. Items page hides add/edit/import for CASHIER.

## Findings

### Goals vs Cost visibility vs CUJ 5 (unitCost) - Severity: Major
Item GET omit list disagrees on whether `unitCost` is in item JSON or only on sales lines.

### Cashier home is two layouts - Severity: Major
Home chrome uses “hide StatCards or replace some of them” plus an optional GET.

### canManage is undefined - Severity: Major
Items-page rule extends `canManage` without defining it.

### Sahl never defined in-document - Severity: Nit
### Parked invoice unexplained - Severity: Nit
### homeButtons vs cashierHomeButtons - Severity: Nit
### Close-shift snapshot columns - Severity: Nit
### Verification users assumed - Severity: Nit
### VIEWER cash tile destination omitted - Severity: Nit
