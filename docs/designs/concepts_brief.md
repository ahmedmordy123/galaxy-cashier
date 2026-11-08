# Sahl cashier feel (home, treasury, hide cost)

* **Author:** Nour Soft
* **Date:** 2026-11-05

## Overview

Galaxy Cashier already has sales, shifts, cash statement, and item cost. After login a cashier still sees a KPI dashboard and a long sidebar, can learn item cost from APIs and the POS warning, and can be sent to `/cash-statement` which their role cannot open.

This wave makes daily cashier work closer to Sahl without cloning Sahl. It is three small slices in one spec: a large-button cashier home on the existing `/dashboard` route, a Treasury action that opens the correct existing cash screen per role, and hiding item cost from the CASHIER role on the wire and on screen.

This is not ROADMAP Wave 1 (already marked done). Do not reopen warehouses, item ledger, or sales analysis.

## Analysis

Goldfish review (design, codebase, zoom-out, comprehension, implementation-readiness, structural) agreed on the same failure: the first hypothesis named one Treasury number and one home while the code has two cash engines, three role maps, and cost leaking past the items table.

* Cash statement is store-day (`opening + cashSales + receipts − disbursements − expenses`). CASHIER cannot open `/cash-statement`.
* Shift `expectedCash` is per user (`openingCash + cashIn − cashRefunds + receipts − disbursements − expenses`) from `computeShiftCashBreakdown` in `apps/api/src/services/shift.service.ts`. Route: `GET /api/ops/shifts/current/summary` (ops router is already mounted).
* Dashboard already mixes them: open shift → shift expected cash; no shift → `closingBalanceEGP` and a link to `/cash-statement`. That mix is the bug, not a feature to reuse.
* Item GET list/id/barcode return full Prisma rows including `costPrice` with only `verifyToken`. POS stores cost on every line and prints the number. Items list hides the column but still loads `costPrice`. `GET /api/reports/today-summary` allows CASHIER and returns COGS and profit. STAFF can edit items, so hiding cost from STAFF would block their job.
* Sidebar, dashboard quick links, and `ROUTE_ROLES` already disagree. A fourth copy of the role list would make that worse.
* `/dashboard` already hides profit widgets from CASHIER and has a quick-link grid. A new `/home` route or cashier-only shell duplicates `DashboardShell`.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * CASHIER and STAFF `/dashboard` is a large-button launcher (sell, treasury/shift, customers, items). Keep one `DashboardShell` and the existing Sidebar (already role-filtered).
  * Treasury for CASHIER/STAFF opens `/shifts` and shows shift `expectedCash` only. No open shift → prompt to open a shift. Never call cash-statement APIs. Never link `/cash-statement`.
  * Treasury for ADMIN/MANAGER/ACCOUNTANT opens existing `/cash-statement` (store-day close).
  * CASHIER must not receive `costPrice`, `unitCost`, COGS, or profit on item reads and today-summary. POS must not show the cost number. Below-cost numeric warning is removed for CASHIER only; confirm is not blocked.
  * Extract one nav catalog used by Sidebar and dashboard buttons so Wave 1 does not add a fourth role list.
  * New user-visible strings use i18n keys.

* **Out-of-Scope Non-Goals:**
  * Sales reps, Excel invoice templates, multi-branch sync, expense analysis report, historical inventory valuation.
  * New `/home` or `/treasury` route, cashier-only layout, CASL/capability matrix, new cash table, merging shift and cash-statement into one ledger.
  * Hiding cost from STAFF, MANAGER, ADMIN, ACCOUNTANT.
  * Changing confirm/return/shift formulas or Prisma cost columns.
  * Reopening ROADMAP Wave 1 stock/profit work.
  * Mid-shift cash count widget on the home page (count stays on `/shifts`).

## Alternatives Weighed

* **New `/home` route plus hidden sidebar for cashiers.** Rejected by author: duplicates `DashboardShell` and mobile overlay; cashiers already have a short sidebar.
* **One Treasury page that composes shift + cash statement.** Rejected by author: two different grains (user-shift vs store-day); cashiers cannot be granted statement read without leaking other people's sales.
* **Deep-link cashiers to `/cash-statement`.** Rejected by author: layout already redirects them; widening the role is a data leak.
* **Permissions platform / `canViewCost` flags in the database.** Rejected by author: the app already uses `requireRole` and inline role checks; a new ACL is out of proportion.
* **Client boolean `belowCost` while still letting cashiers edit discount.** Rejected by author: it is an oracle for recovering cost. CASHIER loses the numeric warning instead.
* **Hide cost from STAFF as well.** Rejected by author: STAFF may create/edit items and must see cost.

## Key Decisions & Staging for Next Steps

1. **Name:** Sahl cashier feel. Do not call this ROADMAP Wave 1.
2. **Landing:** Keep `/dashboard`. For CASHIER and STAFF, replace KPI-first layout with large buttons. ADMIN/MANAGER/ACCOUNTANT/VIEWER keep the current KPI dashboard.
3. **Treasury source of truth:**
   * CASHIER/STAFF: `getShiftSummary().expectedCash` from `computeShiftCashBreakdown`. Empty state if no open shift (existing `/shifts` UI).
   * ADMIN/MANAGER/ACCOUNTANT: existing cash-statement `closingBalanceEGP` on `/cash-statement`.
   * Do not add `source: 'shift'`. Dashboard must not fetch `getToday()` for CASHIER/STAFF.
4. **Owner = ADMIN** (shop owner uses admin). Manager = MANAGER. Cashier = CASHIER. STAFF gets the same large-button home as CASHIER but still sees cost.
5. **Cost strip (CASHIER only):** omit `costPrice` on `GET /api/items`, `GET /api/items/:id`, `GET /api/items/barcode/:barcode`. Omit `cogsTotalEGP`, `grossProfitEGP`, `netProfitEGP` from `GET /api/reports/today-summary` when the caller is CASHIER. Do not send `costPrice` from POS. Sales confirm keeps costing from the database.
6. **Nav:** four dashboard buttons are inline on `/dashboard`. Sidebar list stays in `Sidebar.tsx` (no `navCatalog.ts`). Add explicit `ROUTE_ROLES` for `/sales`, `/items`, `/customers`, `/quotes`. No new `/treasury` path.
7. **Sahl, in this spec:** Arabic RTL, few large tap targets on the first screen, treasury as one button that opens the drawer screen, cashier cannot learn cost. Not a visual clone of getsahl.com.
8. **Next:** `egm-draft` into `docs/designs/sahl-cashier-feel.md`.
