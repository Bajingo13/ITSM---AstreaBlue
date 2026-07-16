# AstreaBlue Codebase Refactor Audit

Date: 2026-07-16

## Refactor rules

- Preserve API contracts, route order, authentication, RBAC, branch scope, consent rules, and database behavior.
- Delete code only when its active replacement and all references are verified.
- Keep changes small enough to validate with focused tests and the complete backend suite.
- Treat existing uncommitted demo tooling and documentation as user-owned work.
- Do not combine structural cleanup with UI or workflow redesign.

## Current structure

- `backend/server.js` remains the largest concentration of legacy code. It contains application setup, schema compatibility checks, and inline routes alongside newer modular routers.
- Backend route modules are organized under `backend/src/routes`, but migration is incomplete: some resource endpoints remain inline while others have both an active modular implementation and an unreachable legacy copy.
- The largest backend feature modules are Endpoint Monitoring, Consent, Tickets, and RA 10173 compliance.
- The largest frontend views are Assets, Tickets, CMDB, Change Management, Consent, and Endpoint Monitoring.
- Frontend route-level code splitting is already enabled through `frontend/src/routes/lazyViews.js`; converting routes to lazy loading is not an outstanding task.

## Confirmed findings

### 1. Duplicate ticket attachment implementation

`backend/server.js` registered the ticket attachment GET, POST, and DELETE endpoints after `backend/src/routes/attachments.js` had already been mounted on the same paths. Express always reached the modular router first, making the inline copy unreachable.

The inline copy also maintained a second Multer storage configuration. The duplicate handlers and configuration were removed. The active API paths and response behavior remain owned by `backend/src/routes/attachments.js`.

### 2. Duplicate attachment schema work during startup

The attachment router performed table creation as a side effect of being imported while the centralized legacy schema sequence performed the same DDL. This could cause concurrent schema locks during application startup. The route-level duplicate was removed; `init-db.js` migrations and the `/api/v1` schema readiness gate remain responsible for availability.

### 3. Change number generation was not import-safe

Change, release, and rollback numbering assumed every prefixed record ended in a numeric sequence. Imported or demo identifiers could therefore produce `NaN`. Number generation now considers only canonical identifiers such as `CHG00001`, preserving the existing format while allowing noncanonical historical/imported records to coexist.

### 4. Schema ownership is still distributed

Some route modules still perform idempotent schema repair. Those routines must be compared with `init-db.js` before removal because several contain feature-specific columns not present in the legacy compatibility block. Moving them blindly would risk production startup.

### 5. Large frontend files need component extraction, not deletion

The large React views contain intertwined state, API calls, modals, tables, and filters. The safe next step is to extract presentational components and hooks one feature at a time while keeping the page's API calls and state transitions intact. File size alone is not evidence that code is unused.

## Refactor phases

### Phase A — Dead duplicate removal (in progress)

- Remove only exact route duplicates whose active modular router is mounted first.
- Remove imports and helpers referenced exclusively by those unreachable handlers.
- Validate the matching resource tests after every removal.

### Phase B — Complete backend route modularization

- Move remaining inline resources out of `server.js` one domain at a time.
- Preserve the current mount order and middleware placement.
- Start with low-coupling resources; migrate tickets, users, and branches only with dedicated RBAC regression coverage.

### Phase C — Centralize database bootstrap

- Make `init-db.js` migrations the authoritative schema path.
- Retain a lightweight readiness check in the running server.
- Remove route-import DDL only after its migration equivalent and deployment order are verified.

### Phase D — Frontend feature decomposition

- Extract API hooks, modal components, filters, and tables from the largest views.
- Preserve route components and user-visible behavior.
- Add component-level tests before changing complex consent, ticket, or endpoint workflows.

### Phase E — Performance verification

- Measure API duration and database query plans before changing queries.
- Verify that the existing asset-query indexes are deployed.
- Add pagination to large unbounded lists after confirming frontend compatibility.
- Track module navigation time separately from API response time to distinguish frontend rendering from Railway/database latency.

## Areas requiring extra protection

- Ticket visibility and external-ticket SuperAdmin exclusivity.
- Admin, Technician, and Employee branch scoping.
- Mandatory onboarding and consent approval reconciliation.
- Endpoint enrollment credentials and heartbeat authentication.
- Change approval, release verification, and rollback state transitions.
- Integration API key authentication and idempotency.

## Validation baseline

- Backend syntax/build checks.
- Full backend test suite.
- Frontend production build.
- Frontend lint, with pre-existing findings reported separately from refactor regressions.
- `git diff --check` and a final review confirming no secrets or generated artifacts were introduced.
