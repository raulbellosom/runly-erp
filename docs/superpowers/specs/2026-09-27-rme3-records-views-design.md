# RME3 records views — Tarjetas, Calendario, Línea de tiempo y Reporte

Date: 2026-09-27
Status: Approved (requested by the product owner in the Module Builder session)
Plan: `docs/superpowers/plans/2026-09-27-rme3-records-views-plan.md`

## 1. Goal

Add four declarative view kinds to RME3 and the No-Code Module Builder, next
to the existing DASHBOARD and KANBAN:

| Kind | UI name | Shows | Requires |
|---|---|---|---|
| `CARDS` | Tarjetas | Grid of record cards (title, subtitle, description, badge, image) | any entity |
| `CALENDAR` | Calendario | Month grid of records placed on a date field, navigable by month | a `date`/`datetime` field |
| `TIMELINE` | Línea de tiempo | Records ordered by a date field on a vertical timeline, grouped by day | a `date`/`datetime` field |
| `REPORT` | Reporte | Records grouped by one field with 1–6 aggregate measures and a totals row | any entity |

Out of scope: editing records from these views (clicking opens the entity's
detail page, like Kanban), drag-to-reschedule in the calendar, multi-level
grouping, charts inside reports (dashboards already cover charts).

## 2. Contract (`@runly/module-engine`)

New `BLUEPRINT_KINDS`: `CARDS`, `CALENDAR`, `TIMELINE`, `REPORT`.
`validateRecordsViewSchema(kind, schema)` in `records-view-schema.js`.

Common schema (all four): `title` (required), `description?`, `path`
(required, inside `/app/m/<moduleKey>`), `entity` (identifier), `apiPath?`,
`permissionKey?`, `filters?` and `orderBy?` (same rules as Kanban),
`limit?` (1–500, default 200). Forbidden keys: `sql`, `query`, `table`,
`companyId`, `company_id`, `companyScoped`.

Kind-specific:

- `CARDS`: `card.titleField` (required); `card.subtitleField`,
  `card.descriptionField`, `card.badgeField`, `card.imageField` optional.
- `CALENDAR`: `dateField`, `titleField` required; `colorField?`.
- `TIMELINE`: `dateField`, `titleField` required; `descriptionField?`,
  `badgeField?`.
- `REPORT`: `groupBy` required; `measures` 1–6 of
  `{ key, label, aggregate: count|sum|avg|min|max, field? }`, unique keys,
  `field` required unless `count`.

## 3. Compiler (`@runly/module-compiler`)

- Builder input views of the four kinds are normalized to
  `{ key, kind, version, generated: false, schema }`; default path is
  `/app/m/<moduleKey>/<entity>-<cards|calendar|timeline|report>`.
- Validation: schema validator + references (fields exist on the entity;
  `dateField` must be `date`/`datetime`; `imageField` must be `file`;
  `sum`/`avg` need a numeric field; relation fields are not displayable).
- Emitted as `views/<leaf>.<kind>.js` via `defineView`, listed in the manifest.

## 4. API

`POST /modules/:key/records-view/query` with `{ viewKey, range? }`:

- Loads the enabled `runly_view` row of one of the four kinds, re-validates
  the schema, requires `schema.permissionKey ?? <slug>.<entity>.read`.
- Record kinds return `{ records, fields, truncated, limit }`, where `fields`
  is display metadata (`name`, `label`, `type`, `options`) for referenced
  fields only. `CALENDAR` accepts `range: { from, to }` (ISO dates, max
  93 days) applied as `dateField >= from AND dateField < to`.
- `REPORT` returns `{ groups: [{ value, label, measures }], totals, fields }`
  (max 100 groups).
- Same safety model as the Kanban query: owned model only, company scope,
  soft-delete filter, identifier whitelist, parameterized values.

## 5. Runtime UI (`@runly/ui` + desktop shell)

New renderers `RunlyCardsView`, `RunlyCalendarView`, `RunlyTimelineView`,
`RunlyReportView` behind one `RunlyRecordsView` (query, loading, error,
empty, header). `BlueprintCrudScreen` routes these kinds by `schema.path`
exactly like KANBAN; clicking a record opens the entity detail page.

## 6. Builder

Vistas tab: "Nueva vista" offers the six kinds; each has a labeled editor.
Navigation tab lists them as menu targets. Preview renders all of them with
sample rows.

## 7. Verification

Unit tests: schema validator, compiler normalization/validation, query
service SQL/permissions shape, builder helpers. `pnpm lint`, `vite build`.
