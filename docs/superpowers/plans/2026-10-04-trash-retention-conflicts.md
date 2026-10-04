# Desactivados v2 — plan

Spec: `docs/superpowers/specs/2026-10-04-trash-retention-conflicts-design.md`

1. `apps/api/src/services/trash/trash-dependents.js`: FK introspection + counts + classification; `unlinkDependents(tx, ...)`. Providers expose `table`. Unit tests (classification) + E2E.
2. Routes: `GET .../dependents`, purge body `unlink`; provider purge runs unlink + delete in one transaction.
3. UI: purge dialog lists dependents (cascade / clears / unlink / blocking), "Desvincular y eliminar"; retention selector in TrashScreen header.
4. Retention: `trash-retention.js` (get/set per company, default 90), `GET/PUT /trash/retention`; worker daily `runTrashRetentionTick` with `autoPurge` over providers (skip files), audit summary.
5. Canvas: DELETE archives; provider `runly.canvas:board` (restore = archived_at null, purge = board deletion as owner).
6. Docs/help/TASKS; backend E2E + Playwright.
