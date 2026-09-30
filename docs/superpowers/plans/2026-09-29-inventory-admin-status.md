# Plan: inventory administrative status (alta / baja) and physical condition

Spec: `docs/superpowers/specs/2026-09-28-inventory-admin-status-design.md` (approved 2026-09-29).

## Tasks

### 1. Data (forward migration `20260929120000_inventory_admin_status`)
- [x] `InvItem`: `adminStatus` (default `registered`), `registeredAt`, `deregisteredAt`, `deregistrationReason`, `conditionId`; index `[companyId, adminStatus]`.
- [x] `InvCondition` (location-shaped + `color`, `sortOrder`), `InvItemAdminEvent` (nullable `actorId` for migrated rows).
- [x] Data migration: legacy `retired|lost|stolen|disposed` -> `deregistered` + reason + `migrated` event; others `registeredAt = created_at::date`.
- [x] `pnpm db:generate` (applying the migration is left to the operator: `pnpm db:migrate`).

### 2. API
- [x] `inventory-admin-service.js`: state machine (`confirm_registration`, `propose_deregistration`, `approve_deregistration`, `reject_deregistration`, `revert_deregistration`), per-action permission, bulk (max 200, per-id result), `listEvents`, `summary`; approve closes active assignment; audit + event row; notify `inventory.item.deregister` holders on proposal.
- [x] Conditions catalog in `inventory-catalog-service.js` (default set seeded on first list) + catalog routes (`conditions`).
- [x] Guards in `inventory-service.js`: `assignItem` rejects `registration_pending|deregistered`; `updateItem` ignores `adminStatus`, only `available|maintenance` status, rejects edits on `deregistered`; create accepts `adminStatus` (`registered|registration_pending`) + `conditionId`.
- [x] `GET /inventory/items`: `adminStatus` (CSV, default `registered,deregistration_proposed`, `all`) and `conditionId` filters; list rows expose `conditionName`.
- [x] Routes: `POST /inventory/items/:id/admin-transition`, `POST /inventory/items/admin-transition/bulk`, `GET /inventory/items/:id/admin-events`, `GET /inventory/summary`.
- [x] Permissions `inventory.item.register`, `inventory.item.deregister` in `permission-catalog.js` + manifest.
- [x] Import: `adminStatus` column (Alta / Pendiente de alta), `condition` by name; legacy baja statuses rejected. Intake validators accept `adminStatus`/`conditionId`. Query/assistant schemas drop legacy statuses, gain `adminStatus`/`conditionId`.

### 3. UI
- [x] Constants + `InventoryAdminStatusBadge`.
- [x] `InventoryScreen`: KPI strip (click filters), Situación filter + column, Condición filter + column, bulk actions.
- [x] Detail: status badge + action menu, `InventoryAdminTransitionDialog`, "Situación administrativa" record section.
- [x] Form: condition picker, "Registrar como pendiente de alta" (create only); status options narrowed.
- [x] Catálogos: "Condiciones" tab.
- [x] "Resumen" screen + navigation entry.
- [x] Help content.

### 4. Verification
- [x] Lean service tests (transitions, permission refusal, bulk, migration mapping).
- [ ] Tests for the `inventory-service` guards (assign/update on pending or deregistered items) and `summary` — not written yet.
- [x] `node --test` inventory suites, lint, `vite build`.

Verified: 2026-09-29 (node --test inventory suites 169/169 incl. new inventory-admin-service tests; full services suite 677/678, the one failure is support-report-service with pre-existing uncommitted changes; eslint clean on changed files; vite build OK; API module imports resolve). Not verified: migration applied to a database and a live UI walkthrough — run `pnpm db:migrate` first.
