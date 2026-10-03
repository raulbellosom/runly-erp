# Historial de cambios (audit trail) compartido para todos los módulos

Date: 2026-10-03
Status: Approved (owner: "ok adelante", 2026-10-03)
Spec file: docs/superpowers/specs/2026-10-03-audit-trail-design.md
Plan file: docs/superpowers/plans/2026-10-03-audit-trail.md
Builds on: docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md

## 1. Context and problem

The "Actividad" card on record details (Inventario, Fleet, RR.HH., Contactos,
Compras) reads like a feed, not an audit trail: every edit says "X actualizó
el activo Y" and the field-level diff (`payload.changes`, already computed by
`activity-bridge.computeFieldChanges`) hides behind a small chevron. In
addition:

- RR.HH. passes full raw rows as before/after; the resulting diff (uuids,
  long markdown) can exceed the 4 KB `Activity.payload` cap, and the publish
  fails silently — edits never reach the card.
- Contactos publishes edits with no before/after at all.
- Comments and files on an inventory item are not recorded.
- RME3 modules (Builder output) write `AuditLog` rows with full before/after
  but never publish `Activity`, so their records have no history at all.
- The card shows the last 50 entries with no filters.

## 2. Goals

1. One shared `AuditTrail` component (`@runly/ui`) for record details: each
   entry shows the actor (photo/initials), what happened and when, and the
   changed fields inline ("Ubicación: ~~Casa~~ → **Oficina**", first 3 then
   "N cambios más").
2. Filters by category (Todo, Ediciones, Estado, Asignaciones, Comentarios,
   Archivos, Creación) and by person; "Ver historial completo" opens a Sheet
   with cursor pagination.
3. `GET /activity/entity/:entityType/:entityId` gains `before` (cursor),
   `category`, `actorId`; returns `nextCursor` and a derived `category` per
   entry. Categories derive from the activity `type` suffix via a shared
   helper in `@runly/validators` (`activityCategory`).
4. `activity-bridge` compacts every diff so it always fits the payload cap:
   drops relation-id noise (uuid→uuid on `*Id`/`*_id` fields), objects,
   framework columns; truncates long strings; caps the count.
5. Sources fixed: RR.HH. (via compaction), Contactos (before/after diff),
   Inventario comments and files (new activity types).
6. RME3: the generated service publishes an `Activity` row (with diff) next
   to each `AuditLog` row on create/update/enable/disable; `RunlyDetail`
   gains a `type: "audit"` section that renders `AuditTrail` with labels taken
   from the blueprint fields; generated detail views include it in the aside.
7. Swap `ActivityTimeline` for `AuditTrail` in the entity-scoped history
   sections (Inventario, Fleet, RR.HH., Contactos, Compras).
   `ActivityTimeline` stays for global/actor feeds.

## 3. Non-goals

- No rollback/undo. No migration/backfill of old entries (they render
  without diffs, as today). No new Prisma models or migrations.
- RME3 modules installed before this change need a recompile (re-sync) to
  start publishing record changes (attachments publish without it).

## 3.1 Follow-up (2026-10-03, same session)

- Comments publish from `comments-service` for every commentable entity
  (InvItem, GrowthLead, Task); the task panel's merged feed skips them.
- RME3 attachments publish from the API's module files capability (no
  recompile needed).
- RME3 updates re-read the row so relations diff by `<field>__label`.
- Legacy "<actor> realizó <type>" summaries render with a readable verb.
- `RunlyDetail.jsx` split: relation sections → `detail-relation-sections.jsx`.

## 4. UX

- Spanish UI, no emojis. Entry: avatar, bold actor name, action text,
  relative time (absolute date in `title`), category icon. Changes: label,
  old value muted + struck through, arrow, new value semibold; wraps at 390px.
- Values: "—" for empty, Sí/No for booleans, dates `es-MX`, currency via
  `Intl`, select options by label, uuids as "otro registro".
- Card shows the latest 8 entries; the Sheet loads 25 per page ("Cargar
  más"). Empty/error states use the shared placeholders.

## 5. API

`GET /activity/entity/:entityType/:entityId?limit=&before=&category=&actorId=`
→ `{ data: [...entries with category, actor.avatarUrl], nextCursor }`.
Permission unchanged (`activity.read`), company-scoped as today.
Categories: `created` (`.create`, `.created`), `updated` (`.update`,
`.updated`), `status` (`.enable`, `.disable`, `.deleted`, `.delete`,
`.status`, `admin.*`), `assignment` (`.assign*`, `.return*`), `comment`
(`.comment.*`), `file` (`.file.*`, `.document.*`).

## 6. Verification

- Unit: `compactChanges`, `activityCategory`, RME3 service template output.
- API: router tests + `node --check`; existing activity/inventory suites.
- UI: lint + `pnpm build:web`. Browser check pending (owner).
