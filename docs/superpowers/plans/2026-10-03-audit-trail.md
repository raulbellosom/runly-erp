# Plan: Historial de cambios compartido

Spec: docs/superpowers/specs/2026-10-03-audit-trail-design.md

## Tasks

- [x] 1. `@runly/validators`: `ACTIVITY_CATEGORIES`, `activityCategory(type)`, `activityCategoryWhere(category)` patterns + unit test.
- [x] 2. `activity-bridge`: `compactChanges(changes)` (uuid-id noise, objects, framework cols, truncation, count/size cap) used by `publishFromAudit`; unit test.
- [x] 3. `activity-service.listForEntity`: `before`, `category`, `actorId`, `nextCursor`, per-entry `category`; route parses query.
- [x] 4. Contactos: effects `afterUpdate(c, contact, before)` with compacted diff; routes + MirAI pass `before`.
- [x] 5. Inventario: activity for comment create/delete and file add/remove.
- [x] 6. RME3 compiler: `recordActivity` helper in service-helpers template; create/update/setEnabled call it; detail views get an `audit` section. Compiler tests.
- [x] 7. `@runly/ui`: `AuditTrail` (+ Sheet "Ver historial completo"), export, docs table.
- [x] 8. `RunlyDetail` `type: "audit"` section (labels from field map).
- [x] 9. Swap history sections (Inventario, Fleet, RR.HH., Contactos, Compras) to `AuditTrail`.
- [x] 10. Developer docs (`docs/developers`) + regenerate ZIP docs; lint, tests, `pnpm build:web`.

Verified: 2026-10-03 (unit tests: activity-categories, activity-bridge compactChanges, audit-trail-format, module-compiler suite incl. generated-service syntax check; API test files 249 pass, 3 pre-existing unrelated failures — support-report-service, call-transcript-analysis-service, contacts-proposal-module — fail identically without these changes; eslint clean; `vite build` OK). Pending: browser check by the owner; RME3 modules installed earlier need a re-sync to start publishing.

## Follow-up tasks

- [x] 11. Comments → Activity in `comments-service` (all commentable entities); remove inventory route duplicate; projects task feed filter.
- [x] 12. RME3 attachments → Activity in `module-files-service`.
- [x] 13. RME3 relation diffs by label (re-read after update; skip raw id when `__label` exists).
- [x] 14. Readable legacy summaries in `listForEntity`.
- [x] 15. Split `RunlyDetail.jsx` (1313 → 801) into `detail-relation-sections.jsx`.

Verified: 2026-10-03 (activity-service incl. readableSummary, compiler suite, renderer suites, inventory router tests; generated relation service syntax-checked; eslint clean; `vite build` OK).
