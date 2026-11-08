# Goldfish Review Report

**Target:** `E:\CASR\docs\designs\sahl-cashier-feel.md` (`1-246`)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| egm-design | completed |
| egm-structural | completed |
| egm-style | completed |

## Prioritized Findings (Blockers -> Major -> Nits)

### Cost-hiding contract wider than architecture - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Overview, Goals, CUJ 5, Cost visibility
* **Discrepancy Description:** Overview/CUJ 5/Goals promise no cost on cashier API responses including parked resume and `unitCost`. Architecture only omits `costPrice` on three item GETs plus today-summary profit fields. Sales/park/quote/print payloads may still carry `unitCost`.
* **Rationale & Recommendation:** Enumerate every CASHIER-readable payload, or narrow Overview/CUJ 5 to the three item reads plus POS display and explicitly non-goal the rest.

### Missing Risks & Mitigations section - Severity: Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** After Alternatives
* **Discrepancy Description:** Feature-spec standard requires a Risks & Mitigations area. NFR is not that section.
* **Rationale & Recommendation:** Add Risks & Mitigations with failure modes (shift summary fail, old parked ticket with cost, mixed client).

### Rejected by author without links - Severity: Major
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:** Alternatives A–D
* **Discrepancy Description:** Alternatives Rule forbids maintainer attribution without issue/PR link.
* **Rationale & Recommendation:** Drop “Rejected by author.” Let Cons be the rationale.

### Two cashier home layouts - Severity: Major
* **Reviewer Lens:** `egm-design`, `egm-style`
* **Affected Scope:** Home chrome vs CUJ 1
* **Rationale & Recommendation:** Freeze four-button grid, no KPI StatCards, no dashboard GETs.

### Manager KPI still mixes cash numbers - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Rationale & Recommendation:** Non-goal the manager mix, or pin admin cash card to statement only.

### ROUTE_ROLES may revoke VIEWER/ACCOUNTANT access - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Rationale & Recommendation:** State current vs proposed allow-lists.

### Shift summary empty-state and requireRole unspecified - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Rationale & Recommendation:** Specify no-shift payload and that `/shifts` is the caller’s current shift.

### NFR nests Additional Resources / Future Improvements - Severity: Major
* **Reviewer Lens:** `egm-structural`

### Open Questions holds closed decisions - Severity: Major
* **Reviewer Lens:** `egm-style`

### “Feel like Sahl” and “(blocked)” undefined - Severity: Major
* **Reviewer Lens:** `egm-style`

### FinancialSummary “already hidden” uncited - Severity: Major
* **Reviewer Lens:** `egm-style`

### Close-shift “as today” vs day-boundary - Severity: Major
* **Reviewer Lens:** `egm-style`

Nits: header names Problem Statement / Proposed Architecture; role table missing ACCOUNTANT/VIEWER; CASL/`canManage` undefined; i18n key names illustrative; mixed list spacing.
