# Goldfish Review Report

**Target:** `E:\CASR\docs\designs\sahl-cashier-feel.md` (full file)

**Stage:** 5 Initial Zoom Out

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| egm-zoom-out | completed |

## Prioritized Findings (Blockers -> Major -> Nits)

### Shared nav catalog is extra machinery - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Goals, Home chrome, Target Files 1–2, Future Improvements
* **Discrepancy Description**: Four cashier buttons do not need a shared `{ href, icon, labelKey, roles }[]` module. Sidebar already owns `navItems`. Layout `ROUTE_ROLES` stays a second list. The catalog is not a single source of truth.
* **Rationale & Recommendation**: Put four buttons on `/dashboard`. Add missing `ROUTE_ROLES` prefixes. Leave Sidebar’s list in `Sidebar.tsx`.

### `source: "shift"` on getShiftSummary - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Cash source of truth, Target File 8
* **Discrepancy Description**: Discriminator does not stop a client from calling `getToday()`. It forces an unnecessary shift.service edit.
* **Rationale & Recommendation**: Drop the field. Fix the cashier dashboard by not calling cash-statement.

### Optional shift-summary fetch on home - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Home chrome, CUJ 1, Data flow, Target File 3
* **Discrepancy Description**: Optional GET plus KPI/button hybrid keeps the first screen a dashboard.
* **Rationale & Recommendation**: CASHIER/STAFF `/dashboard` is four static buttons, zero GETs. Counts stay on `/shifts`.

### Extending canManage hides STAFF add/edit - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Cost visibility, Target File 10
* **Discrepancy Description**: `canManage` is ADMIN||MANAGER. Reusing it for add/edit/import would hide those from STAFF, contradicting the spec.
* **Rationale & Recommendation**: Hide those controls when `role === 'CASHIER'` only.

### Prefer existing nav.* i18n keys - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** i18n
* **Discrepancy Description**: `home.*` duplicates existing `nav.*` / `dashboard.*` keys.
* **Rationale & Recommendation**: Reuse existing keys; add only what is missing.

### Named helper in architecture - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Cost visibility
* **Discrepancy Description**: `stripItemCostForRole` is an implementation detail.
* **Rationale & Recommendation**: State omit-keys on CASHIER item JSON; omit helper name from the high-level plan.
