# Desactivados v2 — dependents, unlink, automatic purge, Canvas

## 1. Feature title
Desactivados v2: what uses a record, unlink on purge, automatic purge after N days, Canvas boards.

## 2. Status
Owner decisions 2026-10-04: automatic purge configurable per company, **on by default at 90 days**
(30/60/90/180/never); on conflicts **unlink when possible** (nullable reference), otherwise skip and
report; Canvas joins Desactivados, Calendario does not.

## 3. Context
Desactivados (spec 2026-10-03-records-trash-design) lists, restores and purges deactivated records.
A purge blocked by a foreign key answers "otros registros dependen de este" without saying which or
offering a way out, and nothing is ever purged unless a person does it.

## 4. Goals
1. `GET /trash/:provider/items/:id/dependents`: every row that references the record, grouped as
   `cascade` (deleted with it), `setNull` (cleared automatically), `unlinkable` (nullable reference
   with restrict/no action: Runly can clear it), `blocking` (required reference, or a Connections
   "Impedir la eliminación" lock).
2. Manual purge shows them; with `unlink: true` the unlinkable references are cleared in the same
   transaction before deleting. Blocking ones keep the 409, now with the list.
3. Retention per company in `InstanceConfig` `trash.retentionDays.<companyId>` (default 90; `0` =
   never). Editable from the Desactivados screen (`core.records.purge`).
4. Worker job (daily): for each company and provider, purge records deactivated more than N days ago
   (deactivation time = the row's `updated_at`, i.e. the last change, which is the deactivation for
   disabled rows), unlinking when possible and skipping blocked ones; one audit summary
   `core.records.auto_purged` per company. Archivos is excluded from automatic purge in v2 (its delete
   needs a user context and Office history rules); manual purge still works.
5. Canvas: "Eliminar tablero" archives (`archived_at`); boards appear in Canvas > Desactivados; purge
   reuses the existing board deletion (pages, objects, files).

## 5. Non-goals
Cascading user-chosen deletes of dependents; per-provider retention; retention for Calendario events
(they still use the same Desactivados, retention applies to them like any other provider).

## 6. Dependents detection
`pg_constraint` foreign keys whose referenced table is the provider's table, with the referencing
column nullability and the delete action (`c` cascade, `n` set null, `a`/`r` no action/restrict).
Connections FKs (`conn_` prefix) with restrict are always `blocking`. Labels: RME3 tables use their
RunlyModel label; core tables a fixed map; otherwise the table name.

## 7. Acceptance
1. A contact referenced by a Builder relation (nullable) purges with "Desvincular" and the referencing
   row keeps existing with the field empty.
2. A record behind "Impedir la eliminación" is never purged, manually or automatically, and the
   dialog/report names the blocking module.
3. A record deactivated more than N days ago disappears after the job; a newer one stays.
4. Retention "Nunca" disables the job for that company.
5. A deleted Canvas board can be restored from Canvas > Desactivados.
