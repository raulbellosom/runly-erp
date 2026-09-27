# RME3 No-Code Module Builder — technical implementation plan

> Execute incrementally. Each task has explicit files, tests, acceptance criteria and dependencies. This plan does not authorize implementing the Web Builder before the platform phases are complete.

**Goal:** evolve existing RME3 into a safe shared compilation, package, upgrade and lifecycle platform that can later support CLI, Web Builder, MirAI and marketplace clients.

**Spec:** `docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md`

**Progress (2026-09-27):** Tasks 3–5 are implemented. The chosen ownership
model is derived inventory; no new registry table or Prisma migration was
needed. The implementation includes strict owned-table validation, centralized
hard purge, route/bundle/Storage/filesystem/cache cleanup, AuditLog and
post-purge residue verification.

## Delivery rules

- Preserve existing `defineRunlyModule`/`defineModel`/`defineView`/`definePage` and legacy aliases.
- Never add RME3 module tables to `prisma/schema.prisma`.
- Use Runly ORM/raw SQL for module tables; Prisma remains core-only.
- All new behavior starts behind adapters/optional metadata until compatibility tests pass.
- Run `pnpm check:privacy` before sharing every phase.
- Every destructive operation must have dry-run, explicit ownership and idempotent retry.

## Dependency graph

```text
T1 contracts
 +-> T2 resource inventory -> T3 complete purge
 +-> T4 staged package publish -> T5 package records/hashes
 +-> T6 schema snapshots -> T7 diff planner -> T8 migration executor
 +-> T9 ModuleDefinition -> T10 compiler -> T11 CLI migration
T3 + T4 + T5 + T8 + T10 -> T12 Package Service integration
T10 -> T13 renderer contracts
T12 + T13 -> T14 Builder projects/preview
T14 -> T15 Web Builder MVP
all -> T16 golden path
```

## Phase 0 — Freeze and test current contracts

### Task 1: Add executable AS-IS contract tests

**Files to inspect/change**

- Inspect: `apps/api/src/routes/modules.js`
- Inspect: `apps/api/src/services/module-{discovery,lifecycle,migration,upload,bundler,root-resolver}-service.js`
- Inspect: `packages/module-engine/src/{constants,define-model,define-view,sql-generator}.js`
- Add/extend tests under `apps/api/src/services/__tests__/`, `apps/api/src/routes/__tests__/`, `packages/module-engine/src/__tests__/`

**Purpose**

Lock current state enum, operation semantics, root resolution, package layout, upload limits and generated migration behavior before refactoring.

**Tests**

- State transitions for install/disable/enable/uninstall/error recovery.
- `RUNLY_MODULES_DIR` precedence and source fallback.
- 50/150 MB limits and normalized duplicate/traversal cases.
- Regression proving v2 `defineModel` with a new field does not currently add the DB column (documented failing capability, not a failing test suite).

**Acceptance criteria**

- Tests encode the observed behavior and pass without production changes.
- Historical `ATLAS_MODULES_DIR` comments are corrected where code uses `RUNLY_MODULES_DIR`.

**Dependencies:** none.

### Task 2: Create machine-readable RME3 capability inventory

**Files to inspect/change**

- Inspect: `packages/module-engine/src/constants.js`, `field-types.js`, `define-view.js`
- Inspect: `packages/ui/src/runly-renderer/*`
- Modify: existing runtime capability exporter under `scripts/lib/rme3-devkit.js`
- Test: `scripts/__tests__/export-rme3-devkit.test.js`

**Purpose**

Expose field support, view kinds, presentations, migration operations and Builder suitability from one registry rather than duplicated lists.

**Tests**

- Every `FIELD_TYPES` value has SQL and declared editor/display capability.
- Every declared blueprint kind has an explicit runtime status.
- Dev Kit snapshot remains deterministic.

**Acceptance criteria**

- CLI/Builder can consume one JSON-compatible capability document.
- Missing renderer support is represented explicitly, never inferred as supported.

**Dependencies:** Task 1.

## Phase 1 — Ownership and hard purge

### Task 3: Implement read-only ModuleResourceInventory

**Files to inspect/change**

- Create: `apps/api/src/services/module-resource-inventory-service.js`
- Modify: `apps/api/src/services/module-upload-service.js` only to delegate read-only inspection later
- Inspect: `prisma/schema.prisma`, bundler, route loader and cache helpers
- Test: `apps/api/src/services/__tests__/module-resource-inventory-service.test.js`

**Purpose**

Return a typed inventory of models, fields, views, blueprints, migrations, permissions/grants, company enablements, dependencies, tables, package files, local/Storage bundles, loaded routes and cache namespaces.

**Tests**

- Fixture with every resource type.
- `Permission.moduleId = null` residue still found by namespaced key/provenance.
- Missing filesystem/Storage is reported without throwing.
- AuditLog classified as historical/non-live.

**Acceptance criteria**

- Inventory is side-effect free.
- Every resource includes ownership evidence and deletion policy.

**Dependencies:** Task 1.

### Task 4: Add `assertNoModuleResourcesRemain`

**Files to inspect/change**

- Modify: `module-resource-inventory-service.js`
- Test: same service test file

**Purpose**

Provide the invariant used by purge and acceptance tests.

**Tests**

- Empty inventory passes.
- Each live residue category fails with machine-readable diagnostics.
- Historical AuditLog can be explicitly allowed.

**Acceptance criteria**

- Error contains no infrastructure paths/secrets.
- Result is stable enough for API/UI rendering.

**Dependencies:** Task 3.

### Task 5: Replace incomplete hard purge with an idempotent purge saga

**Files to inspect/change**

- Create: `apps/api/src/services/module-package-purge-service.js`
- Modify: `apps/api/src/routes/modules.js`
- Modify: `module-upload-service.js` to remove/deprecate `purgeModuleFromDb`
- Modify: bundler/route loader/cache adapters as needed
- Add a core Prisma migration only if a purge journal/tombstone table is approved
- Tests: service and route purge suites

**Purpose**

Unload runtime, delete local/Storage bundle, optionally drop owned tables, remove migrations/views/permissions/grants/company/dependency/metadata records, delete package files, invalidate caches and assert no residue.

**Tests**

- Complete resource fixture is empty after purge.
- Retry after failure at every stage converges safely.
- Incoming required dependency blocks before mutation.
- Storage/filesystem failure is journaled and retryable.
- Audit history remains.

**Acceptance criteria**

- `assertNoModuleResourcesRemain` passes after success.
- API cannot report success while live residue remains.
- Current uninstall modes retain their documented meanings.

**Dependencies:** Tasks 3–4.

## Phase 2 — Staged and atomic packages

### Task 6: Harden archive inspection

**Files to inspect/change**

- Refactor: `apps/api/src/services/module-upload-service.js`
- Add: archive/package fixtures under service tests
- Inspect: `apps/api/src/routes/__tests__/modules-upload-route.test.js`

**Purpose**

Separate inspect/validate from materialization and add entry-count, streaming size, compression-ratio, symlink/device and normalized-name policies.

**Tests**

- Existing valid root/single-folder archives.
- Duplicate after slash/case normalization policy.
- ZIP bomb ratio/count limits.
- symlink/device/absolute/ADS-style paths rejected on supported platforms.

**Acceptance criteria**

- Inspection writes nothing.
- Validation diagnostics are stable codes.

**Dependencies:** Task 1.

### Task 7: Implement staging and atomic active-package swap

**Files to inspect/change**

- Create: `apps/api/src/services/module-package-staging-service.js`
- Modify: root resolver to expose staging/artifact roots safely
- Modify: upload route to stage rather than replace
- Tests: staging service and route integration

**Purpose**

Write to same-volume staging, validate/import/compile before publication, rename active package with backup/journal and recover after interruption.

**Tests**

- Write/validation/compile/swap failures preserve previous package bytes.
- Restart recovery handles each journal state.
- concurrent update for same module serializes/rejects cleanly.

**Acceptance criteria**

- Active directory is never partially written.
- Failed activation restores old routes/bundle/package.

**Dependencies:** Task 6.

### Task 8: Introduce immutable package metadata and hashes

**Files to inspect/change**

- Modify: `prisma/schema.prisma`
- Create: Prisma migration via repository migration conventions
- Create: `apps/api/src/services/module-package-record-service.js`
- Tests: Prisma/service integration

**Purpose**

Persist module/version, definition/source/build/package hashes, storage pointer, previous package and validation result.

**Tests**

- Deduplicate identical package hash.
- Same canonical bytes produce same hash.
- Installed package reference changes only after successful activation.

**Acceptance criteria**

- Exact installed artifact is queryable.
- No real environment addresses are persisted in fixtures/docs.

**Dependencies:** Task 7.

## Phase 3 — Schema Diff Engine

### Task 9: Define canonical schema snapshot and DB introspection

**Files to inspect/change**

- Create package folder: `packages/module-schema/` or colocate initially under `packages/module-engine/src/schema/`
- Create snapshot normalizer and PostgreSQL introspector
- Modify lifecycle only to capture verified snapshots after install
- Tests: pure snapshot plus PostgreSQL integration

**Purpose**

Represent desired/installed tables, stable IDs, fields, indexes, constraints and ownership independently of executable model files.

**Tests**

- Normalize field ordering/defaults deterministically.
- Introspect real table/column/index/FK state.
- Detect declaration-vs-database drift.

**Acceptance criteria**

- Snapshot hash is deterministic.
- Existing module baselines can be recorded without mutating tables.

**Dependencies:** Task 1.

### Task 10: Implement additive diff planner

**Files to inspect/change**

- Create: schema diff operation definitions/planner
- Extend: module engine validation for optional stable IDs
- Tests: table-driven diff cases

**Purpose**

Produce `ADD_TABLE`, `ADD_COLUMN`, `ADD_INDEX`, conditional unique/FK operations and metadata-only changes while classifying destructive changes.

**Tests**

- Add/label/rename/type/nullability/index/relation cases.
- Stable ID distinguishes rename candidate from drop+add.
- Legacy no-ID definitions use conservative behavior.

**Acceptance criteria**

- Planner emits no SQL.
- Every operation has risk, preconditions, reversibility and diagnostics.

**Dependencies:** Task 9.

### Task 11: Compile, preflight, apply and verify additive plans

**Files to inspect/change**

- Extend: `packages/module-engine/src/sql-generator.js` through new operation compiler APIs
- Modify: `apps/api/src/services/module-migration-service.js`
- Modify: lifecycle install/upgrade orchestration
- Tests: SQL unit tests and PostgreSQL integration

**Purpose**

Compile safe operations, check duplicates/orphans/default feasibility, store plan/checksum, execute transactionally and verify resulting schema.

**Tests**

- Add nullable/default column and indexes/FK.
- Reject unsafe required column and duplicate unique index.
- Failure rolls back migration record and SQL.
- Post-verification catches unexpected drift.

**Acceptance criteria**

- The Vehicle `mileage` scenario produces and applies `ADD COLUMN`.
- Builder policy cannot enable unsafe/manual SQL.

**Dependencies:** Task 10.

## Phase 4 — ModuleDefinition and compiler

### Task 12: Specify and validate ModuleDefinition v1

**Files to inspect/change**

- Create: `packages/module-compiler/package.json`
- Create: definition JSON Schema, normalizer and semantic validator
- Reuse rules from `scripts/scaffold/validate.js`
- Tests: definition fixtures and compatibility cases

**Purpose**

Establish the one serializable input contract with stable IDs, tenant-safe defaults and references.

**Tests**

- Valid blank/template/multi-entity definitions.
- collisions, broken references, routes/permissions outside namespace, non-company scope rejection.
- canonical serialization/hash.

**Acceptance criteria**

- Definition contains no executable values.
- Version upgrades have explicit migrators.

**Dependencies:** Tasks 2 and 9.

### Task 13: Extract pure virtual package compiler

**Files to inspect/change**

- Move/adapt: `scripts/scaffold/templates/*` into `packages/module-compiler`
- Create compiler output `VirtualPackage`
- Keep compatibility re-exports/adapters under `scripts/scaffold/`
- Tests: golden files and package validation

**Purpose**

Generate manifest/models/views/routes/services/validators/ownership/provenance without filesystem writes.

**Tests**

- Current scaffolder fixtures compile equivalently.
- Deterministic ordering/content.
- Every generated service remains company scoped and audited.

**Acceptance criteria**

- Compiler API has no CLI or filesystem dependency.
- Output passes discovery/model/view validation.

**Dependencies:** Task 12.

### Task 14: Migrate CLI to shared compiler

**Files to inspect/change**

- Modify: `scripts/scaffold-module.js`, `scripts/scaffold/{prompts,writer,validate}.js`
- Modify tests under `scripts/scaffold/__tests__/`

**Purpose**

Make prompts/config an adapter while preserving current user workflow and generated package semantics.

**Tests**

- Interactive prompt fixtures.
- config-file path.
- overwrite behavior and golden output.

**Acceptance criteria**

- CLI still works with existing config.
- CLI and direct compiler produce identical virtual files.

**Dependencies:** Task 13.

### Task 15: Add deterministic canonical ZIP writer

**Files to inspect/change**

- Create: package archive module in `packages/module-compiler` or package service
- Tests: deterministic bytes and upload round-trip

**Purpose**

Create the single RME3 ZIP artifact for download and installation.

**Tests**

- Same VirtualPackage yields identical hash/bytes.
- Archive is accepted by upload inspection.
- executable/binary component assets preserve supported modes/content.

**Acceptance criteria**

- No Builder-specific archive format exists.

**Dependencies:** Tasks 6 and 13.

## Phase 5 — Unified Package Service

### Task 16: Implement `ModulePackageService`

**Files to inspect/change**

- Create: `apps/api/src/services/module-package-service.js`
- Compose staging, record, compiler, bundler, diff, lifecycle, route loader and purge services
- Tests: orchestration with failure injection

**Purpose**

Expose inspect/validate/stage/compile/plan/publish/install/export/delete/rollback-package operations as the sole domain entrypoint.

**Tests**

- Failure at every stage preserves/reconciles invariants.
- Idempotency keys prevent duplicate publication/install.
- lifecycle and audit events contain package hashes.

**Acceptance criteria**

- No route implements package orchestration directly.
- Builder/CLI/upload can share identical methods.

**Dependencies:** Tasks 5, 8, 11, 15.

### Task 17: Route existing upload/sync/install/export through Package Service

**Files to inspect/change**

- Modify: `apps/api/src/routes/modules.js`
- Modify: `packages/sdk/src/index.js`
- Modify: `UploadModuleSheet.jsx` only for new dry-run/status output
- Add export/download route and SDK method
- Tests: route/SDK/UI contract tests

**Purpose**

Preserve current endpoints while unifying behavior; add canonical ZIP export.

**Tests**

- Existing upload callers remain compatible.
- export -> upload on isolated second root.
- install uses the stored artifact hash.

**Acceptance criteria**

- Upload cannot mutate active package before plan approval.
- Exported ZIP round-trips without special handling.

**Dependencies:** Task 16.

## Phase 6 — Renderer vNext

### Task 18: Formalize Cards as a TABLE presentation

**Files to inspect/change**

- Modify: `define-view.js`, renderer adapters, `RunlyTable.jsx`, `RunlyCardView.jsx`
- Modify docs/runtime capability registry
- Tests: module engine and renderer behavior

**Purpose**

Stabilize `presentations`, `defaultPresentation` and card field mapping without adding a kind.

**Tests**

- table-only, cards-only and switchable modes.
- mobile and stored mode fallback.

**Acceptance criteria**

- Existing table blueprints retain current default.

**Dependencies:** Task 2.

### Task 19: Implement limited declarative Dashboard

**Files to inspect/change**

- Create: `packages/ui/src/runly-renderer/RunlyDashboard.jsx`
- Add authorized aggregate endpoint/runtime contract in API
- Extend view validation and `BlueprintCrudScreen`
- Tests: widget schema, authorization, aggregates and renderer

**Purpose**

Support stat, grouped count, recent list, progress and basic charts without JSX or SQL.

**Tests**

- company scoping and permission checks.
- invalid source/field/aggregate rejected.
- empty/error/loading states.

**Acceptance criteria**

- Dashboard definition is fully JSON-compatible.
- No arbitrary query text is accepted.

**Dependencies:** Tasks 2 and 12.

### Task 20: Design and implement Kanban, then Calendar separately

**Files to inspect/change**

- New renderer/schema/API files selected after focused sub-specs
- Extend constants only when renderer and persistence contract are ready

**Purpose**

Add Kanban with authorized group/order mutation; add Calendar read-only first with explicit timezone/all-day semantics.

**Tests**

- Kanban optimistic conflict, permission and mobile alternative.
- Calendar timezone/all-day/range query and click-through.

**Acceptance criteria**

- Each renderer has its own approved sub-spec and capability entry.

**Dependencies:** Tasks 2, 12, 19. Not required for initial Builder MVP unless explicitly pulled in.

## Phase 7 — Builder projects and Web MVP

### Task 21: Persist Builder projects and immutable revisions

**Files to inspect/change**

- Modify Prisma schema/migration for `BuilderProject`/`BuilderRevision`
- Create API service/routes/validators
- Add AuditLog events
- Tests: tenancy, revision immutability and state transitions

**Purpose**

Save drafts without touching production module roots.

**Acceptance criteria**

- Draft/validated/published transitions enforced.
- every revision has definition hash and actor.

**Dependencies:** Tasks 12 and 16.

### Task 22: Implement declarative preview backend/frontend seam

**Files to inspect/change**

- Create definition-to-preview adapters
- Reuse current Runly renderers with synthetic/sample data
- Tests: preview never calls publication/root writer

**Purpose**

Preview Table/Cards/Form/Detail/Dashboard without installation.

**Acceptance criteria**

- Preview cannot execute custom code or SQL.
- errors point to definition paths.

**Dependencies:** Tasks 18–19 and 21.

### Task 23: Build Web Module Builder MVP

**Files to inspect/change**

- New desktop module/screens/components using `@runly/ui`
- API/SDK endpoints from Builder project service
- Run `react-doctor` after React changes

**Purpose**

Template/blank creation; entity/field/many-to-one editors; CRUD views; navigation; permissions; review; preview; ZIP download; local install; detach.

**Tests**

- component/unit flows, API integration and Playwright/equivalent end-to-end if repository standard exists.
- accessibility and responsive behavior.

**Acceptance criteria**

- Nontechnical user completes golden module without code/AI.
- install/download use the same package hash.
- unsupported/destructive edits are blocked with explanation.

**Dependencies:** Tasks 17, 19, 21–22.

## Phase 8 — End-to-end proof and rollout

### Task 24: Implement the cross-instance golden-path acceptance test

**Files to inspect/change**

- Create integration harness under existing module rehearsal/integration test conventions
- Add fixtures for v1/v1.1 ModuleDefinition

**Purpose**

Prove compile, ZIP, upload, install, CRUD, additive upgrade, table purge and residue-free package purge.

**Tests**

- Exact flow from SPEC section 29 on two isolated roots/databases or transactionally isolated schemas as approved.

**Acceptance criteria**

- new column is physically verified;
- routes/renderers work;
- final residue assertion is empty;
- no real infrastructure values enter fixtures/logs.

**Dependencies:** Tasks 5, 11, 17, 19, 23.

### Task 25: Compatibility rollout and operational docs

**Files to inspect/change**

- Update `docs/ai-context/rme3-modules.md`, runtime capabilities, installer Dev Kit snapshot and deployment docs
- Add feature flags/metrics where needed
- Run full relevant test/build/privacy suites

**Purpose**

Adopt package service/diff/compiler gradually and document recovery procedures.

**Tests**

- existing custom fixture install/enable/disable/uninstall;
- installer external root;
- cold-boot bundle restore;
- CLI golden output;
- `pnpm check:privacy`.

**Acceptance criteria**

- Legacy/advanced modules remain operable.
- automatic diff is enabled only for verified Builder-managed packages initially.
- rollback/recovery runbook is tested.

**Dependencies:** Task 24.

## Atomic/staged package publishing progress

The second bounded increment is implemented. ZIP transport delegates to
same-volume staging; inspection, semantic validation and component compilation
finish before publication; package, bundle and runtime publication use a
temporary backup and compensating rollback. A filesystem lock directory
serializes each module key. Schema evolution remains detection-only through
`requiresSchemaMigration` and is intentionally deferred.

## Additive Schema Diff Engine progress

The third bounded increment is implemented. Model definitions normalize to a
database-only schema, installed metadata is compared against PostgreSQL and the
staged definition, and a declarative MigrationPlan classifies `CREATE_TABLE`,
`ADD_COLUMN` and non-unique `ADD_INDEX`. Safe plans compile and apply inside one
transaction with post-DDL verification and deterministic ModuleMigration
identity. Drift and destructive/unsupported changes block package publication
before swap. Builder/compiler work remains deferred.

## Recommended first implementation PR

## Shared RME3 Module Compiler progress

El cuarto incremento extrae definición, validación, normalización y templates
del scaffolder a `@runly/module-compiler`. El CLI conserva prompts y escritura
como adapters, mientras `compileModule(definition)` produce en memoria artifacts
RME3 deterministas. Los presets, lifecycle ownership y un self-hosting test con
loaders reales quedan cubiertos. Builder, preview y nuevos renderers siguen
diferidos.

## Declarative Dashboard Renderer progress

El quinto incremento convierte `DASHBOARD` en un blueprint validado y
renderizable. ModuleDefinition v1 compila views declarativas; el runtime usa
`RunlyDashboard` con registry de widgets stat/chart/list y un endpoint batch
tenant-aware. La query layer sólo acepta modelos/fields owned y aplica ACL,
company scope, soft-delete y límites de costo. CUSTOM permanece compatible;
Kanban, Calendar y Builder siguen diferidos.


Implement Tasks 3–5 only: **ModuleResourceInventory + complete hard purge + residue assertion**. It is narrowly bounded, fixes a current correctness/privacy risk, creates the ownership contract needed by staging and Builder, and can be proven independently before package and schema refactors begin.
