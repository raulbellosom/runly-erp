# Desactivados — see, restore and permanently delete deactivated records

## 1. Feature title
Desactivados (per-module trash for soft-deleted records), platform-wide.

## 2. Status
Approved by the owner 2026-10-03 ("ok adelante"). Implementation in progress.

## 3. Context
Runly soft-deletes almost everything (`enabled = false`). A deactivated record disappears from lists and
details and there is no way to see it, reactivate it or delete it for good. The owner hit this testing
Calibraciones: a deactivated 1:1 calibration keeps blocking a new one and cannot be removed. The need
applies to every module, not one screen.

## 4. Problem
No module manages its deactivated records; permanent deletion is impossible from the UI.

## 5. Goals
1. A "Desactivados" entry in the sidebar of every module that has deactivated-record support, added by
   the shell (no manifest edits, no regeneration of installed packages).
2. One screen per module: pick the entity, search, list deactivated records (name, deactivated when),
   **Reactivar** and **Eliminar definitivamente** (two-step confirmation).
3. Server-side provider registry: each provider lists, restores and purges one entity, enforcing
   company scope and permissions, writing the audit log.
4. Coverage now: every soft-delete entity of installed RME3/Builder modules (one generic provider),
   `runly.inventory` items, `runly.contacts` contacts, `runly.hr` employees. Other modules join with
   the same contract later.
5. Purge never breaks integrity: foreign keys (including Connections "Impedir la eliminación") turn
   into 409 with a Spanish message naming what blocks it; nothing is deleted.

## 6. Non-goals
Bulk purge; scheduled auto-purge; restoring hard-deleted data (backups cover that); files of a purged
record are not deleted (runly.files lifecycle owns them).

## 7. Permissions
- Restore: the entity's own deactivate/update permission (provider-declared).
- Purge: the provider permission **and** new `core.records.purge` ("Eliminar definitivamente
  registros desactivados"); admins have it through the admin path.

## 8. API
- `GET /trash/providers?moduleKey=` → `[{ id, moduleKey, label, pluralLabel, count, canPurge }]` the user can access.
- `GET /trash/:providerId/items?search=&page=` → `{ items: [{ id, label, deactivatedAt }], total }`.
- `POST /trash/:providerId/items/:id/restore`.
- `DELETE /trash/:providerId/items/:id` with `{ confirmation: "ELIMINAR" }` → 200, or 409 `{ error, code: 'in_use' }`.
- SDK domain `trash`.

## 9. Provider contract (apps/api/src/services/trash/)
`{ id, moduleKey, label, pluralLabel, permissions: { restore }, count(ctx), list(ctx, { search, page, pageSize }),
restore(ctx, id), purge(ctx, id) }` where `ctx = { companyId, actorId, prisma }`. Purge runs in a
transaction; Postgres 23503 / Prisma P2003 map to `TrashInUseError`.

Generic RME3 provider: one per `RunlyModel` of an INSTALLED module whose schema has `softDelete` and
`companyScoped`; label column = the first text-like field; restore = `UPDATE ... SET enabled = true`;
purge = `DELETE ... RETURNING id` (connection triggers clean the index; FKs enforce restrict).

## 10. UI
- `RunlyApp` asks `GET /trash/providers?moduleKey=<active>` and appends a "Desactivados" item to the
  active module's navigation when at least one provider is available.
- `ModuleOutlet` renders `TrashScreen` for `/<moduleKey>/desactivados` before the navigation guard.
- `TrashScreen`: `PageHeader`, entity selector (`SelectField`) when several providers, search, `DataTable`
  rows with Reactivar / Eliminar; `ConfirmDialog` twice for purge; `EmptyState` when nothing is deactivated.

## 11. Audit
`core.records.restored` and `core.records.purged` with provider id, record id and label.

## 12. Acceptance
1. A deactivated Builder record shows in its module's Desactivados, restores, and purges.
2. Purging a contact with "Impedir la eliminación" connections returns 409 and keeps it.
3. A purged 1:1 calibration frees the item for a new one.
4. Users without `core.records.purge` see Reactivar but not Eliminar.
5. Company isolation: another company's deactivated records never appear.

## 13. Verification
Unit tests for the generic provider SQL and error mapping; backend E2E in the E2E company; Playwright
walkthrough of the screen.
