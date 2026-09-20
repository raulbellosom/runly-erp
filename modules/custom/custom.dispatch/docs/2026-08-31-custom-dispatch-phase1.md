# `custom.dispatch` — Phase 1 Implementation Plan

- Date: 2026-08-31
- Status: Completed
- Design: `docs/superpowers/specs/2026-08-31-custom-dispatch-design.md`
- Scope: RME3 foundation and operational catalogs only

## Outcome

Deliver an installable `custom.dispatch` module with a PWA identity, granular
permissions, company-scoped catalog tables, authenticated Hono APIs, audit logging,
and a polished setup workspace for sites, stations, operator assignments, materials,
and folio series.

## Tasks

1. Create the module manifest from the installer Dev Kit golden path.
2. Define five Runly ORM models:
   - `dispatch_site`
   - `dispatch_station`
   - `dispatch_station_assignment`
   - `dispatch_material_profile`
   - `dispatch_folio_series`
3. Add Zod validators for every catalog resource and enabled toggle.
4. Implement a company-scoped catalog service with factory-closure functions only.
5. Add authenticated, permission-guarded routes under `/dispatch/catalog`.
6. Write AuditLog entries for every catalog mutation.
7. Build a CUSTOM setup view using `@runly/ui`, TanStack Query, and the token supplied
   by `BlueprintCrudScreen`.
8. Cover loading, empty, error, success, disabled, create, edit, and deactivate states.
9. Add Node tests for validation, company isolation, resource mapping, and audit.
10. Validate manifests/models, syntax-check JS, bundle the module UI, run tests, then
    run React Doctor.

## Explicitly deferred

- Voucher/ticket tables and workflows
- Atomic folio assignment to vouchers
- Weighing capture
- QR generation and scanning
- Exit approval and notifications
- PDFs, Website, external email, municipal reporting, hardware and offline behavior
