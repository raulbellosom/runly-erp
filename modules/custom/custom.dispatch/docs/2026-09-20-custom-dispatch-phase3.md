# `custom.dispatch` — Phase 3 Implementation Plan

- Date: 2026-09-20
- Status: In progress
- Design: `docs/2026-08-31-custom-dispatch-design.md` (Section 10.7 data model,
  13.2 API contract, 16.5 UI, 18.3 validation)
- Scope: weighing capture (tare/gross/net, auxiliary volume gross),
  corrections, weighing exceptions, and the `CREATED -> READY_FOR_EXIT`
  transition for `SCALE` tickets.

## Why now

Phase 2 leaves every `SCALE` ticket stuck at `status = CREATED` — nothing in
the module can move it forward. This phase is what makes a `SCALE` voucher
actually usable end to end (short of printing and the gate/exit flow, which
stay deferred).

## Page

One more standalone page, consistent with the "no tabs" rule from Phase 2:
`components/weighing/WeighingCapturePage.jsx` at
`/app/m/custom.dispatch/pesajes`. It searches a ticket by folio or plate (or
opens pre-selected via `?ticket=<id>` from the ticket detail page's "Capturar
pesaje" action), shows the current tare/gross/net summary, and captures the
next reading or an exception. It does not reuse or extend the ticket-creation
pages or the ticket detail page — it is its own screen with its own action.

## Data model

`dispatch_weighing` — append-only, `companyScoped: true`, no soft delete.
Corrections insert a new row with `supersedes_id` pointing at the row being
corrected; the "effective" reading of a type is the latest row that nothing
else supersedes. `weight_kg > 0` and "a superseding row must carry a
correction reason" are enforced as table `CHECK` constraints, not just at the
application layer.

`dispatch_ticket` gains the weighing-exception field group deferred from
Phase 2 (`weighing_exception`, `weighing_exception_reason`,
`weighing_exception_by`, `weighing_exception_at`). This module has not been
synced against any live environment since Phase 2 was written (the
distributable zip is still the pre-migration one), so there is no existing
`dispatch_ticket` table anywhere to migrate — the field group is added
directly to the model rather than via a separate `ALTER TABLE` migration
entry. If this module is ever synced against an environment where
`dispatch_ticket` already exists without these columns, that sync needs an
explicit additive migration in `module.manifest.js`'s `migrations` array —
noted here so it isn't forgotten later.

## Business rules (from the design doc)

- `captureTare` / `captureGross`: `SCALE` tickets only, only while
  `status = CREATED`. `captureGross` requires an existing effective `TARE`
  reading first (tare is captured before the truck is loaded; gross after).
  `gross_weight_kg` must be greater than the effective tare — reject
  otherwise. Once both are present, the ticket transitions to
  `READY_FOR_EXIT` and a `READY_FOR_EXIT` event is written (this event type
  already exists from Phase 2).
- `captureAuxiliaryExit`: `VOLUME` tickets, any non-terminal status. Purely
  informational — never changes ticket status, never relabeled as net
  material weight.
- `correctWeighing` (supersede): requires `dispatch.weighing.override` and a
  reason; rejected for terminal tickets.
- `authorizeException`: requires `dispatch.weighing.override` and a reason;
  `SCALE` tickets only; moves a `CREATED` ticket to `READY_FOR_EXIT` without
  requiring both readings.
- Net weight (`gross - tare`) is a derived value returned by the API and
  recorded in the `GROSS_RECORDED` event's metadata — it is not a column on
  `dispatch_ticket` or `dispatch_weighing`, matching the design doc's
  explicit "not manually editable" rule.

## Deferred (unchanged from the Phase 2 plan)

Branded PDF/print, attachments, gate scan, exit approval, notifications.
