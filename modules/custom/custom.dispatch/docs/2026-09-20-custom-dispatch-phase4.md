# `custom.dispatch` — Phase 4 Implementation Plan

- Date: 2026-09-20
- Status: In progress
- Design: `docs/2026-08-31-custom-dispatch-design.md` (Section 6.3 gate
  behavior, 7.2 exit-attempt status, 10.8 data model, 11 concurrency,
  12 QR contract, 13.3 API contract, 14 notifications, 16.6 UI, 17 security)
- Scope: gate QR scan, exit attempts, the scale operator's approval queue,
  and the `PENDING_APPROVAL -> USED / CORRECTION_REQUIRED` transitions.

## Pages

Two standalone pages, same rule as Phases 2–3:

- `components/kiosk/DispatchKiosk.jsx` (existing, `/kiosco`) — was a
  client-only QR format checker with no backend call. It now actually calls
  `POST /dispatch/gate/scan`. It gains a gate-station selector (the physical
  device is pinned to one gate for the session) since the scan endpoint needs
  to know which `GATE` station is scanning.
- `components/exits/ExitApprovalQueuePage.jsx` (new, `/salidas`) — the scale
  operator's queue, per design section 16.6: newest pending scan first,
  approve/reject actions, prior rejected attempts visible before deciding.

## Security constraint that shapes the API

Per design section 6.3 / 17.3, the guard-facing scan response must reveal
nothing beyond whether the scan was accepted — no customer, material,
quantity, or ticket status. `POST /dispatch/gate/scan` therefore returns only
`{ accepted: boolean }`. The service resolves ticket/attempt/recipient detail
internally (to persist the attempt and to publish the approval-required
notification), but the route never puts that detail in the HTTP response.

## Data model

`dispatch_exit_attempt` — append-only per design 10.8. The design calls for a
partial unique constraint ("only one pending attempt per ticket") but
`defineModel` indexes don't support a `WHERE` clause, so — per the design
doc's own fallback — this is enforced in the service with `SELECT ... FOR
UPDATE` on the ticket row before checking for an existing pending attempt.

## Business rules

- Scan accepts only `READY_FOR_EXIT` or `CORRECTION_REQUIRED` tickets;
  everything else (`CREATED`, terminal, unknown/malformed QR) is a plain
  rejection with no further detail.
- Re-scanning the same QR while an attempt is pending returns the existing
  attempt instead of creating a second one (idempotent by construction, not
  by a client-supplied key).
- A successful scan moves the ticket to `PENDING_APPROVAL` and publishes an
  `dispatch.exit.approval_required` notification (`priority: high`,
  `channels: ['in_app']`) to every enabled `dispatch_station_assignment` with
  `receives_exit_alerts = true` at a `SCALE` station of the ticket's site,
  via `moduleContext.notifications.publishFromContext` (the Route Loader
  injects this — see `apps/api/src/services/route-loader-service.js`).
  Notification failures never roll back the scan.
- `approve`/`reject` lock both the attempt and ticket rows. Approve sets the
  ticket to `USED` (terminal). Reject sets it to `CORRECTION_REQUIRED` (still
  active — the same QR can be scanned again, creating attempt N+1). Acting on
  an attempt that is no longer `PENDING_APPROVAL` is idempotent: the current
  row is returned rather than re-decided or rejected with an error.

## Deferred (unchanged)

Branded PDF/print, attachments, the guard acknowledging the decision inside
Runly (the design's MVP says the scale operator communicates the decision
externally by radio/phone — `guard-notified` just records that it happened).
