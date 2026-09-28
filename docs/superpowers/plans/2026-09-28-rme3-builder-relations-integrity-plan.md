# Relation integrity + related tabs — Implementation Plan

> Executed inline. Spec: `docs/superpowers/specs/2026-09-28-rme3-builder-relations-integrity-design.md`

## Tasks

### Task 1 — Compiler contract
- [ ] `relations.js` (new): `resolveLabelField(target)`, `validateRelations(definition, errors)` (label field, onDisable, setNull+required, cascade cycles), `inboundRelations(definition, entityKey)`, `validateRelatedSection` hook used by `layout.js` tree validation (needs entity map → pass `context` with entities).
- [ ] Tests `relations.test.js` for each diagnostic.

### Task 2 — Generated API
- [ ] `templates/relations.js` → `api/<entity>-relations.js` (`assertRelationTargets`, `beforeDisable`).
- [ ] `service.js`: label joins in list/get, relation filters in list, create/update assert, setEnabled transaction + beforeDisable.
- [ ] `routes.js`: relation query filters.
- [ ] Tests: generated modules pass `node --check`; `beforeDisable`/`assertRelationTargets` exercised in-process with a fake db (`$queryRaw` tagged-template recorder).

### Task 3 — Generated views
- [ ] Table/detail `__label`, form `labelField`, related section → `relation-list` (detail only). Tests.

### Task 4 — Builder
- [ ] FieldSheet relation options; layoutHelpers `relatedSources(definition, entityKey)` + `addSection` type `related`; LayoutTree related chip + add menu; previews placeholder. Tests for helpers.

### Task 5 — Verify + docs
- [ ] All suites, build, lint; docs (`rme3-runtime-capabilities.md`, `TASKS.md`).
