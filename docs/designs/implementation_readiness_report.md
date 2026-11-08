# Implementation Readiness Report

**Target:** `E:\CASR\docs\designs\sahl-cashier-feel.md` (`247-end`)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| egm-implementation-readiness | completed |
| egm-codebase-details | completed |
| egm-style | completed |

## Prioritized Findings

### Cashier home still a set of alternatives - Severity: Blocker
Four-button home vs KPI hybrid vs optional GET is not frozen. STAFF still gets profit widgets today (`!isCashier` only).

### canManage reuse vs STAFF keeps add/edit - Severity: Blocker
`canManage` is ADMIN||MANAGER. Extending it hides STAFF add/edit.

### No phases - Severity: Major
### getItems envelope vs `?limit=1` test - Severity: Major
### Sidebar i18n unused; keys undecided - Severity: Major
### /shifts not in file list for open-shift CTA - Severity: Major
### Reports handler ignores req - Severity: Major
### POS cost assignment sites unnamed - Severity: Major
### Create/Modify optional files (FinancialSummary, smoke script) - Severity: Major
### navCatalog create step does not enumerate rows - Severity: Blocker (style)
### ROUTE_ROLES “as specified” without arrays in the plan section - Severity: Blocker (style)

Nits: tsc vs lint; VIEWER cash card; source:shift unused.
