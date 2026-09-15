# Decision Log — Inventory Modification History

Date: 2026-09-15
Feature: Historial de modificaciones (diffs por campo)
Spec: docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md

---

## Decision

Fleet's vehicle detail now has the same field-diff "Actividad" capability Inventory just got, built the same session as Inventory's rather than deferred to a separate future project.

## What the spec said

Section 6 (Non-goals), item 1: "No se adopta esta capacidad en Fleet, HR, ni ningún otro módulo en esta funcionalidad — solo se construye de forma genérica en activity-bridge.js/ActivityTimeline y se adopta en Inventario. Otros módulos quedan para trabajo futuro." Section 28 (Future enhancements), item 1 named Fleet explicitly as a future candidate.

## What was implemented instead

The user asked directly for Fleet to also be "solucionado" after seeing Inventory's version. Investigation found Fleet's `fleet-service.js` had its own `logAudit()` that wrote straight to `prisma.auditLog.create`, bypassing the `Activity` table/`ActivityTimeline` entirely — Fleet had no visible activity feed of any kind before this, not even the generic un-diffed sentences Inventory had before its own fix. Implemented:

- `logAudit()` now routes through `activity-bridge.js`'s `logAndPublish` (self-constructing a bridge the same way `inventory-service.js` does), gaining the same auto-diff capability for free.
- Five new Spanish translators (`fleet.vehicle.create/update/disable/document.add/document.remove`) in `activity-bridge.js`.
- A curated `toFleetVehicleSnapshot()` in `fleet-service.js`, and a fix to `updateVehicle` so its "after" snapshot is re-fetched through the same rich `getVehicle()` join "before" already uses (the raw `UPDATE...RETURNING *` row was missing every joined column, which would have made every joined field show as a false diff).
- `FleetVehicleHistorySection.jsx` + a Fleet-specific field-label map, registered as `runly.fleet:HistorySection`, added as a new "Actividad" aside section on `VEHICLE_DETAIL`.
- A real bug found along the way: `RunlyCrudView`'s page-mode `RunlyDetail` call never forwarded `componentRegistry` at all — fixed, since it directly blocked the new section from resolving.

## Reason

Direct user request, made after seeing the Inventory version working — not a technical necessity discovered during implementation, but the same class of "the plan changed once the user saw it live" as the DetailActionBar reversal earlier in this session. Fleet already had 90% of the groundwork in place (`getVehicle()`'s rich join, `logAudit`'s existing before/after capture pattern), which is why this was a same-session extension rather than a separate spec cycle — the generic architecture the spec called for was already built and tested; adopting it in Fleet required no new design decisions, only new field data and wiring.

## Impact on spec

Spec update required: Yes

Updated: Section 6 (Non-goals) item 1 and Section 28 (Future enhancements) item 1 of `2026-09-15-inventory-modification-history-design.md` should be read as partially superseded — Fleet is done, not future work. HR remains future work as originally scoped (HR still needs its own migration to `RunlyDetail`/blueprints before any activity feed can be added to it at all). This document stands in for that spec edit rather than editing the already-approved spec file after the fact.
