# `custom.dispatch` — Voucher PDF (design Section 15/16.7)

- Date: 2026-09-20
- Status: In progress
- Design: `docs/2026-08-31-custom-dispatch-design.md` (13.1 API contract,
  15 voucher PDF, 16.7 detail screen)

## New dependency

Rendering an actual scannable QR bitmap needs a QR-encoding library; none
existed anywhere in the `runly` repo. Added `qrcode` (`^1.5.4`) to the root
`package.json` and `apps/api/package.json`, alongside the existing `pdfkit`
dependency, and ran `pnpm install`. This is a real dependency change to the
main repo, not just this external module — confirmed with the product owner
before adding it. Deploying it live needs an API image rebuild.

## The QR-rotation problem this design forces

The server only ever stores a SHA-256 hash of the QR token (design Section
12: "Store only a SHA-256 hash"). The raw token is returned once, in the
ticket-creation response, and never persisted. That means **the server
cannot reconstruct the original QR for a reprint** — there is nothing to
reconstruct from.

Design Section 12 already anticipates this: "QR rotation is permitted only
before `USED`. A rotation invalidates the previous token and records an
event." So printing/reprinting a voucher is implemented as: generate a fresh
random token, store only its hash (bumping `qr_version`), render that fresh
token into the PDF, and discard the raw value again once the PDF bytes are
built. Every PDF request is therefore also an implicit QR rotation — which
is exactly the rotate-on-reprint behavior the design calls for, not a
workaround. The practical consequence: an older printed copy's QR stops
being the one the ticket actually validates against as soon as a newer PDF
is generated for the same ticket. That is intentional — a reprint is meant
to replace the physical copy in circulation, not add another valid one.

## Deviation from the design's literal HTTP method

Design 13.1 lists two separate endpoints: `GET /dispatch/tickets/:id/pdf`
and `POST /dispatch/tickets/:id/print-event`. Because generating the PDF now
has a real side effect (it rotates the QR and writes a
`VOUCHER_PRINTED`/`VOUCHER_REPRINTED` event), a plain `GET` is the wrong HTTP
verb — a prefetch or retry could silently invalidate an already-printed
copy. This implementation merges both into a single
`POST /dispatch/tickets/:id/pdf`, guarded by `dispatch.ticket.print`, that
rotates the QR, writes the event, and streams back the PDF in one request.
There is no separate `print-event` endpoint.

## What's in the PDF

Three copies on one PDF (one page each), per design 16.7:
`COPIA BÁSCULA — ARCHIVO`, `COPIA CHOFER`, `COPIA CARGADOR`. Each page:
company name/address/RFC (branding), folio + voucher type, the QR, material,
the primary commercial quantity (m³ for `VOLUME`, tare/gross/net when
already captured for `SCALE`), customer or walk-in identity, plate/driver,
external voucher reference, payment method/reference for `VOLUME`, creation
timestamp, and page footer. Letter size, matching design 15's stated default.

**Not implemented**: the uploaded company logo image. `pdf-branding-service.js`
(the existing branding/PDF helper used by other official modules, e.g.
`apps/api/src/routes/fleet/vehicle-pdf.js`) is not reachable from this module
— it isn't exported through any resolvable package, and reaching into
`apps/api/src/services/*` by relative path from an externally-distributed
module would silently break if that internal file ever moves, which
contradicts this module's own stated goal of validating a real
externally-distributed install. So `voucher-pdf.js` here is self-contained:
it reads `Company`/`BrandingConfig` directly via Prisma (a stable, public
data contract this module already depends on elsewhere — same class of
dependency as `AuditLog`/`Membership`), but always falls back to a
colored initials badge instead of fetching the logo from Supabase Storage.
Revisit this once/if `moduleContext` exposes a stable branding capability to
custom modules.
