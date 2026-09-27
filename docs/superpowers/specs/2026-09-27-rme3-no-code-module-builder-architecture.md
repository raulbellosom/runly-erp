# RME3 No-Code Module Builder — auditoría y arquitectura

Date: 2026-09-27
Status: Proposed
Scope: auditoría AS-IS y arquitectura TO-BE; no implementa el Web Builder
Plan: `docs/superpowers/plans/2026-09-27-rme3-no-code-module-builder-architecture.md`

Implementation note (2026-09-27): the first recommended increment is now
implemented using a **derived resource inventory**, not a persisted
`ModuleResource` table. Ownership is derived from `moduleKey`, Prisma relations,
RME3 model metadata, `lifecycleConfig.ownedTables`, route-loader state, bundler
state, Supabase Storage and the custom module root. Hard purge is centralized in
`module-package-purge-service.js` and ends with a residue assertion.

## 1. Executive summary

RME3 ya es una base útil para un Builder: tiene paquetes autocontenidos, discovery desde filesystem, contratos declarativos, metadata, lifecycle, permisos, dependencias, route loader, bundles React dinámicos, migraciones registradas, ZIP upload y un scaffolder bastante completo. La recomendación es evolucionarlo, no reemplazarlo.

Sin embargo, hoy RME3 es principalmente un sistema de instalación inicial y authoring técnico. No es todavía una plataforma segura de publicación y actualización. Los bloqueadores son:

1. **BLOCKER — no existe schema evolution automático.** Un cambio de `defineModel` genera otro checksum y vuelve a ejecutar `CREATE TABLE IF NOT EXISTS`; PostgreSQL no agrega las columnas nuevas a una tabla existente.
2. **BLOCKER — el ZIP update no es atómico ni staged.** Se borra el paquete vigente antes de escribir el nuevo, sin validar import, compilar bundle, planear schema ni poder volver atrás.
3. **BLOCKER — hard purge no prueba ni elimina toda la propiedad.** Puede dejar views, migraciones, permisos huérfanos, bundles locales/remotos, rutas/cachés y tablas owned.
4. **HIGH — no existe un artifact/package service unificado ni export ZIP.** Upload, sync, install, bundling y purge son operaciones coordinadas desde rutas, no un único dominio transaccional.
5. **HIGH — el scaffolder mezcla contrato, templates y escritura directa.** Es reutilizable, pero debe extraerse como compiler puro antes de tener un segundo cliente web.
6. **HIGH — no hay snapshot canónico versionado del schema/ModuleDefinition.** Sin identidades estables no se distingue rename de drop+add.

El siguiente PR no debe ser el Builder. Debe ser **RME3 Package Ownership & Purge Hardening**: inventario central de recursos, purge idempotente, `assertNoModuleResourcesRemain`, descarga de bundle/Storage, unload/caches y pruebas de residuos. Después debe implementarse staging/atomic publish y, a continuación, el Schema Diff Engine aditivo.

## 2. Método y fuente de verdad

La auditoría se hizo contra el código y tests actuales. La documentación se usó para contrastar contratos, no para inferir que una capacidad existe. En particular se revisaron:

- `packages/module-engine/src/*`
- `apps/api/src/services/module-*-service.js`, route loader y cleanup registry
- `apps/api/src/routes/modules.js`
- `prisma/schema.prisma`
- `packages/ui/src/runly-renderer/*`
- `apps/desktop/src/shell/BlueprintCrudScreen.jsx`
- `scripts/scaffold-module.js` y `scripts/scaffold/*`
- tests de discovery, upload, lifecycle, migration, bundling, route loading y scaffolder
- configuración installer/Docker y resolución de roots

Esta SPEC describe el working tree actual de 2026-09-27. Hay cambios de usuario no relacionados en catálogo/UI compartida; no forman parte de esta propuesta.

## 3. AS-IS architecture

```text
host custom-modules/                       source repo modules/custom/
          |                                           |
          +-- Docker mount / RUNLY_MODULES_DIR --------+
                              |
                    module-root-resolver
                              |
          modules/official/ + authoritative custom root
                              |
                    module-discovery-service
             manifest + models + views/pages + migrations
                              |
                       POST /modules/sync
                              |
             metadata sync + lifecycle reconciliation
                              |
       +----------------------+---------------------+
       |                      |                     |
 RunlyModel/Field/View   ModuleMigration       RunlyModule
       |                 generated/manual      permissions/deps
       |                      |                     |
       +---------- Runly ORM SQL -------------------+
                              |
             route-loader + esbuild module bundler
                              |
             Hono runtime + dynamic React registry
```

La fuente de verdad para código de módulos es el filesystem. `RUNLY_MODULES_DIR` selecciona el root custom externo; si no existe, se usa `<projectRoot>/modules/custom`. Los módulos oficiales permanecen en `<projectRoot>/modules/official`. El nombre histórico `ATLAS_MODULES_DIR` todavía aparece en comentarios/documentación, pero el resolver y los tests actuales usan `RUNLY_MODULES_DIR`.

En installer, el mapping esperado es:

```text
host/custom-modules
  -> volume mount
  -> RUNLY_MODULES_DIR=/app/modules/custom
  -> discovery/route loader/bundler
```

## 4. Component inventory

| Component | Location | Status | Responsibility | Builder readiness | Main problem |
|---|---|---:|---|---:|---|
| Module contracts | `packages/module-engine` | Implemented | `defineRunlyModule`, model/view/page validation | Medium | no stable IDs or canonical definition |
| SQL generator | `packages/module-engine/src/sql-generator.js` | Implemented, initial-create only | additive-safe create/index/RLS/revoke SQL | Low | no diff/introspection |
| Discovery/root resolver | `apps/api/src/services/module-discovery-service.js`, `module-root-resolver.js` | Implemented | filesystem source discovery | High | source/package identity not versioned |
| Metadata sync | `module-metadata-service.js` | Implemented | upsert models, fields, views | Medium | removal semantics and DB schema are separate |
| Migration service | `module-migration-service.js` | Partial | plan/apply generated and manifest SQL | Low | checksum is not schema evolution |
| Lifecycle service | `module-lifecycle-service.js` | Implemented with gaps | install/retry/enable/disable/uninstall/reset/sync | Medium | orchestration is not package-atomic |
| Cleanup registry | `module-cleanup-registry.js` | Partial | per-module core-data count/purge | Low for Builder | custom modules do not get generic cleanup handlers |
| Upload service | `module-upload-service.js` | Partial | validate/extract ZIP, DB purge helper | Low | destructive replacement; incomplete hard purge |
| Route loader | `route-loader-service.js` | Implemented | mount/unmount module Hono routes | High | must join atomic publish/rollback |
| Dynamic bundler | `module-bundler-service.js` | Implemented | esbuild, local artifact, Supabase Storage restore | Medium | not staged with package publication |
| Scaffolder | `scripts/scaffold*` | Implemented | interactive/config-driven RME3 generation | Medium-high | direct filesystem writer, no formal library contract |
| Blueprint CRUD shell | `BlueprintCrudScreen.jsx` | Implemented | page routing and generic CRUD composition | Medium-high | only current view families are resolved |
| Table/Form/Detail | `packages/ui/src/runly-renderer` | Implemented | declarative CRUD UI | High | field support is uneven |
| Cards | `RunlyCardView.jsx`, `RunlyTable.jsx` | Implemented as presentation | same dataset in grid/cards | High | contract should be normalized/documented |
| Dashboard/Kanban/Calendar | constants/runtime | Declared/absent | future declarative renderers | Low | no complete generic contract/runtime |
| Export package ZIP | none | Not implemented | portable package creation | None | upload has no inverse |

## 5. Current package format

The runtime package is a directory, normally:

```text
<moduleKey>/
  module.manifest.js
  models/*.model.js
  views/*.table.js
  views/*.form.js
  views/*.detail.js
  views/*.page.js
  api/index.js
  api/*-routes.js
  api/*-service.js
  validators/*.js
  components/index.js            optional
  components/*.jsx               optional
  migrations/*.sql               optional, manifest-declared
```

`module.manifest.js` is executable ESM, not JSON. Upload accepts either this structure at ZIP root or under one root folder. The manifest key is checked with a literal regex before extraction; discovery later imports and validates the real manifest.

There is no formal package manifest containing artifact hash, source hash, build hash, definition hash, package format version or compatibility range. There is also no server-side export ZIP endpoint. The ZIP accepted by upload is therefore a transport convention around the directory, not yet a versioned package artifact.

## 6. Discovery and source of truth

- `RUNLY_MODULES_DIR` is authoritative for custom modules when configured.
- Source-mode fallback is `<projectRoot>/modules/custom`.
- Official modules are resolved separately from `<projectRoot>/modules/official`.
- Boot discovery and `POST /modules/sync` reconcile filesystem declarations into core metadata.
- Route loading and bundling resolve the same roots, including external installer roots.
- Discovery validates namespace ownership: custom/community cannot claim reserved `runly.`, `atlas.`, `core.`, `system.` or `identity.` prefixes.
- Declared files must stay inside the module root; absolute paths, `..`, missing targets and realpath escapes are rejected.

Recommendation: preserve filesystem packages as the deployable source, but add an immutable published-package store and record which exact artifact produced the installed state.

## 7. Current lifecycle and state machine

The Prisma enum has four states: `UNINSTALLED`, `INSTALLED`, `DISABLED`, `ERROR`.

```text
discovered only
    -> sync row: UNINSTALLED/disabled
    -> install: INSTALLED/enabled
         -> disable: DISABLED/disabled
         -> enable: INSTALLED/enabled
         -> uninstall: UNINSTALLED/disabled
    -> install failure: ERROR/disabled + lifecycle.lastError
         -> retry-install
         -> cleanup/clear-error
```

Supported operations include sync, install, retry install, clear failed install, enable, disable, uninstall dry-run, uninstall, reset dry-run/reset, migration listing and destructive owned-table purge. Routes explicitly unload/reload runtime routes, delete bundles on uninstall, and invalidate selected caches.

Important semantics:

- **Disable**: deactivates permissions, marks `DISABLED`, unloads routes; files, tables, rows, metadata and installation record remain.
- **Uninstall / preserve-data**: deactivates permissions and marks `UNINSTALLED`; tables/data and package files remain, bundle is removed by the route orchestration.
- **Uninstall / purge-data**: invokes a registered cleanup handler. This is useful mainly for core modules with explicit Prisma handlers; it is not a generic RME3 table purge.
- **Uninstall / purge-owned-tables**: uses `lifecycle.ownedTables`, dry-runs existence/row counts, requires `ACEPTO`, runs teardown, drops existing owned tables with `CASCADE`, deletes the module's `ModuleMigration` rows if at least one table was dropped, and marks the module uninstalled.
- **Delete / purge endpoint**: deletes selected metadata and filesystem files, but is not a complete ownership purge today.

`purge-owned-tables` is the closest operation to complete removal of custom module SQL data. It drops the declared tables and dependent constraints/objects reachable by `CASCADE`, but completeness depends entirely on an accurate `ownedTables` declaration. It does not itself remove the package or every core metadata resource.

## 8. Current database migration model

```text
defineModel
  -> validateModel
  -> generateCreateTableSql(model)
  -> createChecksum(model)
  -> <table>__<checksum-prefix>.sql
  -> ModuleMigration(moduleKey, filename, checksum)
  -> execute safe statements in transaction
```

The generated SQL includes:

- `CREATE TABLE IF NOT EXISTS`
- implicit `id UUID PRIMARY KEY DEFAULT uuidv7()`
- implicit `company_id` when `companyScoped`
- implicit `enabled` when `softDelete`
- declared checks and foreign keys
- `CREATE [UNIQUE] INDEX IF NOT EXISTS`
- RLS enablement and revocation from `PUBLIC`, `anon`, `authenticated`

Manual manifest migrations may contain additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; the SQL safety gate explicitly permits this form. No automatic code currently derives those statements from a model change.

RME3 tables are deliberately absent from `prisma/schema.prisma`. Module services use parameterized `prisma.$queryRaw` or carefully parameterized unsafe raw SQL; Prisma typed accessors are only for core tables.

## 9. Schema evolution gap analysis

### Exact behavior today

Given installed v1:

```text
Vehicle: plate, brand
```

and v2:

```text
Vehicle: plate, brand, mileage
```

the model checksum changes, producing a new migration filename. The SQL is regenerated as `CREATE TABLE IF NOT EXISTS fleet_vehicle (...)`. Because the table already exists, PostgreSQL performs no column reconciliation. The new `ModuleMigration` is recorded successfully, metadata may show `mileage`, but the physical column is absent. Generated CRUD code can then fail at runtime when it references the field.

No current implementation performs:

- previous schema snapshot lookup;
- `information_schema.columns` introspection for planning;
- model-to-model diff;
- generated `ADD COLUMN`;
- rename detection;
- type/nullability change planning;
- constraint/index data preflight.

This is the principal Builder blocker because editing a published visual model cannot be trusted.

### Proposed RME3 Schema Diff Engine

```text
previous canonical schema snapshot + desired canonical schema
                         |
                   identity-aware diff
                         |
                    MigrationPlan
                         |
              preconditions + risk + warnings
                         |
                     SQL compiler
                         |
              safe SQL + ModuleMigration record
                         |
                 verified schema snapshot
```

Initial safe operations:

- `ADD_TABLE`
- `ADD_COLUMN` nullable
- `ADD_COLUMN` required only with safe immutable/default backfill plan
- `ADD_INDEX`
- `ADD_UNIQUE_INDEX` after duplicate preflight
- `ADD_FOREIGN_KEY` after orphan preflight
- metadata/UI-only changes

Deferred/explicitly destructive operations:

- `DROP_COLUMN`, `DROP_TABLE`
- `RENAME_COLUMN`
- `TYPE_CHANGE`
- nullable to required
- drop index/constraint

Each operation needs stable resource ID, old/new representation, SQL preview, preconditions, row counts, reversibility, risk and required confirmation. Builder v1 rejects destructive plans rather than compiling arbitrary SQL.

## 10. Stable identities

Names are not identities. The canonical definition should add persistent opaque IDs to module, entity, field, view, action and automation resources:

```json
{
  "id": "fld_01K...",
  "key": "mileage",
  "dbName": "mileage",
  "label": "Kilometraje",
  "type": "number"
}
```

Rules:

- IDs never change after creation.
- `key` is the logical API identifier; `dbName` is physical SQL identity; `label` is freely editable.
- Existing RME3 modules without IDs remain valid and are classified as declarative/advanced legacy.
- Import into Builder may deterministically synthesize IDs only for an initial one-way adoption snapshot; future edits use persisted IDs.
- A changed label is metadata-only. Changed key/dbName with the same ID is a rename candidate, not silently drop+add.

## 11. Purge/lifecycle gap analysis

`purgeModuleFromDb()` currently deletes `RunlyField`, `RunlyModel`, `Blueprint` and `RunlyModule`. Consequences of the actual Prisma relationships and orchestration:

| Resource | Current outcome |
|---|---|
| `RunlyView` | remains; it has `moduleKey` but no FK to `RunlyModule`; model delete sets `modelName` null |
| `ModuleMigration` | remains unless owned-table uninstall deleted it |
| `Permission` | remains with `moduleId = null` because FK is `onDelete: SetNull` |
| `RolePermission`, `UserPermissionGrant` | remain because the Permission remains |
| `CompanyModule` | cascades from `RunlyModule` |
| module dependencies | outgoing cascade; incoming required dependency may restrict deletion |
| owned SQL tables/data | remain unless separately purged |
| local bundle | remains |
| Supabase Storage bundle | remains |
| loaded routes | remain until explicit unload/restart |
| caches | only `modules:list` is cleared by hard purge route |
| filesystem package | deleted after DB transaction, non-atomically |
| AuditLog/activity history | remains intentionally; should be classified historical, not owned residue |

Required hardening:

1. Introduce a central `ModuleResourceInventory`/ownership resolver.
2. Make purge an orchestrated, idempotent saga: disable ingress, unload routes/jobs, delete bundle local+Storage, drop owned tables if explicitly requested, delete migrations/views/grants/permissions/metadata, delete package, invalidate all caches.
3. Use staging/tombstones and compensating actions across DB/filesystem/Storage; one ACID transaction cannot span them.
4. Add `assertNoModuleResourcesRemain(moduleKey, { allowHistoricalAudit: true })` returning a typed residue list and fail purge if nonempty.
5. Preserve AuditLog as immutable history with a tombstoned module key unless retention policy explicitly permits erasure.

## 12. ZIP/upload gap analysis

### Implemented protections

- ZIP extension and parse validation;
- 50 MB compressed limit;
- 150 MB declared uncompressed limit;
- duplicate normalized entry detection;
- root or single-folder structure validation;
- mandatory `module.manifest.js`;
- literal manifest key must match route key;
- slash/backslash normalization;
- path traversal containment checks;
- validation of all entries before writes;
- partial-write cleanup.

### Production gaps

The existing comment calls replacement atomic, but the algorithm is:

```text
validate archive in memory
-> rm existing directory
-> mkdir target
-> write entries one by one
```

A write failure deletes the partially written target and also loses the previous working package. Discovery/import validation, dependency validation, component compilation, route load and schema dry-run occur after publication or in separate operations. There is no rollback artifact, fsync/durable rename protocol, symlink rejection policy, entry-count/ratio limits, or package signature/provenance.

Target pipeline:

```text
receive ZIP
-> content-addressed staging directory
-> structural + semantic manifest validation
-> import models/views/routes in isolated validation context
-> compile bundle
-> dependency and schema dry-run
-> create immutable package record/artifact
-> atomic same-volume rename/swap
-> lifecycle upgrade/install
-> route/cache activation
-> health verification
-> mark published
-> retain previous artifact for rollback
```

On Windows/Linux, staging and destination must be on the same volume. Swap should use rename with a backup/tombstone directory and recovery journal. A failed post-swap activation restores the previous package and its bundle/routes, while DB migrations are restricted to forward-safe operations in v1.

## 13. Scaffolder assessment

The scaffolder already accepts module identity/PWA, preset, entities, 17 field types, required/options/relations, `companyScoped` and `softDelete`. It generates manifest, models, TABLE/FORM/DETAIL/PAGE views, API routes/services, validators, helpers and optional CUSTOM dashboard/components. Defaults are tenant-safe (`companyScoped` and soft delete true), and it has unit/e2e template tests.

Reusable value is high: validation rules, naming, defaults, permission generation, schema declarations, CRUD templates and tests should be retained. What should not be reused as the core abstraction is direct synchronous filesystem writing and JS-string templates coupled to CLI config.

Recommendation: create `packages/module-compiler` with pure APIs:

```text
normalizeDefinition(definition)
validateDefinition(definition)
compileDefinition(definition) -> VirtualPackage
materializePackage(virtualPackage, targetDir)
archivePackage(virtualPackage) -> ZIP
inspectCompiledPackage(package)
```

The existing CLI becomes an adapter: prompts/config -> ModuleDefinition -> compiler -> filesystem. Golden outputs must remain byte/semantics compatible where possible.

## 14. Renderer and view assessment

### Blueprint kinds

| Kind | Declared | Persistable/validated | Renderer | Status |
|---|---:|---:|---:|---|
| ENTITY | yes | generic | metadata, not screen | Implemented for metadata |
| FORM | yes | specialized validation | `RunlyForm` | Implemented |
| TABLE | yes | specialized validation | `RunlyTable` | Implemented |
| DETAIL | yes | specialized validation | `RunlyDetail` | Implemented |
| PAGE | discovery conversion | page validation/routing | shell composition | Implemented |
| DASHBOARD | yes | only generic | no generic `RunlyDashboard` | Declared, not implemented |
| ACTION | yes | generic | no standalone renderer | Partial/metadata |
| RELATION | yes | generic | sections/relations exist, no standalone renderer | Partial |
| CUSTOM | yes | specialized validation | dynamic component registry | Implemented |
| KANBAN | no | no | no | Not implemented |
| CALENDAR | no | no | no | Not implemented |

`RunlyCrudView` composes the implemented CRUD family. `BlueprintCrudScreen` resolves route/page/blueprint presentation and dynamic component references.

### Cards

`RunlyCardView` is already consumed by `RunlyTable`, including card-grid rendering and presentation switching. Cards are therefore a presentation of the same collection, not a new blueprint kind. Formalize:

```json
{
  "kind": "TABLE",
  "schema": {
    "presentations": ["table", "cards"],
    "defaultPresentation": "table",
    "card": { "titleField": "name", "subtitleField": "status" }
  }
}
```

### Renderer priority

1. Formalize Cards contract (small cost, existing runtime).
2. Implement `RunlyDashboard` declaratively (high demo/value, existing `StatCard` and Recharts).
3. Implement Kanban (high workflow value, requires mutation/order contract).
4. Implement generic Calendar (valuable but time-zone/recurrence UX raises cost).

MVP should include Table, Cards, Form, Detail and a limited Dashboard. Kanban is a strong v1.1 candidate. Calendar should follow after date/time semantics are hardened.

## 15. Field type assessment

All 17 declared types have SQL mappings. Renderer support is uneven and sometimes falls back to generic text.

| Type group | Model/SQL | Form | Table | Detail | Builder v1 |
|---|---:|---:|---:|---:|---:|
| text, textarea | yes | yes | yes | yes | yes |
| number, decimal | yes | yes | formatted | formatted | yes |
| boolean | yes | yes | yes | yes | yes |
| select | yes | yes | option labels | option labels | yes |
| multiselect | `TEXT[]` | control exists | limited/generic | limited/generic | yes with tests |
| date, datetime | yes | yes | yes | yes | yes |
| email, phone | yes | yes | generic | generic | yes |
| relation | UUID | relation loader | usually pre-joined/generic | relation sections possible | yes, many-to-one only |
| file | UUID | upload paths vary by schema | limited | attachments/component patterns | defer polished support |
| json | JSONB | generic JSON | generic | generic | advanced/defer |
| markdown | TEXT | yes | stripped/preview | rendered | yes |
| color | varchar | yes | swatch | swatch | yes |
| richtext | TEXT | partial/generic editor semantics | generic | partial | defer until contract test |

Validation exists at model/scaffolder/Zod-template layers but is not one canonical field capability registry. The Builder must consume a machine-readable registry defining SQL type, editor, display support, validation options and allowed migrations. Future friendly types (`currency`, `percentage`, `status`, `image`, `user`, `company`, auto-number, barcode/QR, location, computed/formula, signature) should be layered semantic types, not added ad hoc before that registry exists.

## 16. Relations, CRUD, multi-tenancy, permissions and navigation

### Relations

`relation` maps to UUID and model definitions can declare foreign keys; form relations can load options. The scaffolder's `relatedModel` is enough for a basic many-to-one UI but does not fully derive FK constraints, inverse one-to-many collections, many-to-many junctions, deletion policies or cross-module dependency ownership.

Builder v1 supports explicit many-to-one. One-to-many is a derived read-only inverse view. Many-to-many waits for an explicit junction-entity contract.

### Generic CRUD runtime

Do not block the MVP on a full generic CRUD backend. First compile the existing proven route/service/validator templates from ModuleDefinition. A generic CRUD runtime is worthwhile later to reduce generated code, but it expands authorization, audit, relation, filtering, soft-delete and compatibility risk. The compiler creates a stable seam so generated CRUD can later be replaced behind the same package contract.

### Multi-tenant defaults

Generated entities are `companyScoped: true` by default and SQL adds non-null `company_id`. Generated services scope queries by the validated tenant context. Builder-managed modules must not expose an opt-out in normal UI; global entities require an advanced/admin policy. RLS is enabled and direct Data API roles are revoked, so authorized backend routes remain the intended access path.

### Permissions

Manifest permissions are upserted and activated/deactivated through lifecycle; admin permissions are synchronized. Builder derives collision-safe keys under the module namespace, e.g. `<slug>.<entity>.<read|create|update|delete>`. The first UI exposes CRUD toggles; role assignment remains the existing Runly administration concern.

### Navigation

The manifest supports label, path, icon, permission and layout. The Builder needs an ordered tree with stable IDs and groups, but compiled paths must remain inside `/app/m/<moduleKey>` and permission references must resolve within the definition.

## 17. Target architecture

```text
CLI prompts/config        Web Builder UI          MirAI tools
        \                     |                     /
         +------------ ModuleDefinition -----------+
                              |
                    validation/capabilities
                              |
                       Module Compiler
                              |
                  Virtual RME3 Package + hashes
                              |
                       Package Service
       inspect -> stage -> validate -> compile -> publish/export
                              |
                   Lifecycle Upgrade Planner
                  /                         \
          Schema Diff Engine           metadata/UI diff
                  \                         /
                     RME3 lifecycle runtime
             discovery + migrations + permissions
              route loader + bundler + caches
```

Builder must not have a separate installer. ZIP upload, Builder local install, CLI publication and future marketplace all call the same Package Service and lifecycle planner.

## 18. Proposed canonical ModuleDefinition

```json
{
  "schemaVersion": 1,
  "id": "mod_01K...",
  "management": "builder",
  "key": "custom.vehicles",
  "name": "Vehículos",
  "version": "1.0.0",
  "description": "Control de vehículos",
  "identity": {
    "icon": "Truck",
    "color": "#2563EB",
    "pwa": { "shortName": "Vehículos", "startPath": "/vehicles" }
  },
  "entities": [
    {
      "id": "ent_01K...",
      "key": "vehicle",
      "dbName": "vehicles_vehicle",
      "label": "Vehículo",
      "pluralLabel": "Vehículos",
      "companyScoped": true,
      "softDelete": true,
      "crud": { "read": true, "create": true, "update": true, "delete": "soft" },
      "fields": [
        {
          "id": "fld_01K...",
          "key": "plate",
          "dbName": "plate",
          "label": "Placa",
          "type": "text",
          "required": true,
          "validation": { "maxLength": 32 }
        }
      ],
      "indexes": []
    }
  ],
  "views": [
    {
      "id": "view_01K...",
      "key": "vehicle.list",
      "kind": "TABLE",
      "entityId": "ent_01K...",
      "presentations": ["table", "cards"],
      "schema": {}
    }
  ],
  "navigation": [],
  "permissions": [],
  "automations": [],
  "settings": { "locale": "es-MX" }
}
```

The JSON document is data only: no functions, imports, SQL or JSX. JSON Schema plus semantic validators enforce stable IDs, namespace ownership, referential integrity, tenant defaults, route containment and capability compatibility. The compiled package may include `module.definition.json` as provenance for Builder-managed modules; advanced modules need not have one.

## 19. Proposed Module Compiler

The compiler is deterministic and side-effect free until materialization:

```text
ModuleDefinition
-> normalize defaults
-> validate structural and semantic rules
-> derive names/permissions/navigation/ownership
-> emit VirtualPackage(files, manifest, ownership, hashes)
-> package validation
-> materialize directory or canonical ZIP
```

Compiler output must be stable for the same normalized definition. Generated timestamps are excluded from source hashes. Templates are internal implementation details; consumers use APIs. The compiler emits lifecycle `ownedModels`/`ownedTables`, definition provenance and a package metadata file containing format version and hashes.

## 20. Proposed Module Package Service

Suggested responsibilities:

- `inspectPackage(input)` — enumerate safe files and package metadata without execution.
- `validatePackage(staged)` — manifest, imports, declarations, namespaces, dependencies and policy.
- `stagePackage(input)` — content-addressed temporary storage on destination volume.
- `compilePackage(staged)` — component bundle and compiler diagnostics.
- `planInstall/planUpgrade(staged)` — metadata and schema diff with risk.
- `publishPackage(staged)` — immutable artifact record and atomic active-pointer swap.
- `installPackage(packageId)` — invoke existing lifecycle pipeline.
- `exportPackage(packageId)` — canonical ZIP consumable by current upload contract.
- `deletePackage(moduleKey)` — ownership-aware hard purge.
- `rollbackPackage(moduleKey, version)` — restore artifact; DB rollback only where explicitly supported.

The canonical ZIP uses deterministic path ordering, normalized timestamps/modes and one root directory or root contents accepted by upload. “Download ZIP” returns this artifact; “Install in this instance” passes the same stored artifact to `installPackage` without rebuilding it.

## 21. Draft/version/publish model and Builder backend

Proposed core models (names may be adjusted during implementation):

- `BuilderProject`: module identity, ownership/company, current draft, management mode.
- `BuilderRevision`: immutable ModuleDefinition JSON, revision number, hashes, author, validation status.
- `ModulePackage`: immutable artifact metadata, module/version, package/source/definition/build hashes, storage location, validation result.
- `ModuleInstallation`: installed package ID, previous package ID, lifecycle result and timestamps; alternatively extend `RunlyModule` minimally plus an installation history table.

States:

```text
DRAFT -> VALIDATED -> PUBLISHED
                    -> INSTALLED (instance-specific installation record)
```

Editing a published module creates a new draft revision and requires a semver bump at publish time. Validation creates a diff against the installed package/schema snapshot. Publishing creates one immutable artifact; it does not mutate production filesystem while the user edits.

### Preview

Use direct declarative preview first: render ModuleDefinition-derived view schemas against synthetic/in-memory sample data. It is fast and does not execute arbitrary server code. API/schema integration preview can later use an ephemeral staged package sandbox. Do not install temporary drafts into the production namespace.

## 22. Upgrade, versions and rollback

An upgrade plan compares the installed package/definition snapshot with the desired package:

```text
custom.vehicles 1.2.0 -> 1.3.0
Database: ADD_COLUMN vehicle.mileage; ADD_INDEX vehicle_status_idx
UI: UPDATE vehicle.form; ADD vehicle.kanban
Permissions: unchanged
Risk: LOW
Reversible: package yes; database forward-only
```

Hashes:

- `definitionHash`: canonical normalized ModuleDefinition.
- `sourceHash`: generated source tree before bundle artifacts.
- `buildHash`: compiled bundle/output.
- `packageHash`: canonical ZIP bytes.

The installed state references `packageHash` and schema snapshot. Package rollback can be added after immutable artifacts exist. Builder v1 should not promise database down-migrations; rollback restores code/UI only when schema compatibility checks prove the older package tolerates the forward schema.

## 23. Builder-managed versus Advanced

Classification:

- **Legacy custom**: filesystem package without sufficient RME3 provenance.
- **RME3 declarative**: manifests/models/views within standard contracts, but not owned by Builder.
- **RME3 advanced**: custom React/Hono/manual migrations or arbitrary supported code.
- **Builder-managed**: compiled from a stored ModuleDefinition and matching definition/source hashes.

`Convert to Advanced` / `Detach from Builder` creates a final package/revision snapshot, changes management mode irreversibly by default, and allows code editing. If generated files drift from the recorded source hash, the module is automatically treated as advanced/read-only in Builder. No promise is made for Code -> Builder round-trip. MirAI can assist advanced authoring separately.

## 24. Declarative renderer expansion

### Dashboard

Highly viable. `RunlyDashboard` can start with `stat`, grouped count, recent records, list, progress and basic bar/line/donut widgets using existing UI/Recharts. Data sources must be declarative aggregates served through an authorized backend query contract, not arbitrary SQL. This is the first genuinely new renderer recommended.

### Kanban

Viable after the CRUD mutation contract supports atomic group/order updates. Contract includes `groupBy`, card field mapping, allowed lanes, permission checks, optimistic concurrency/version, mobile non-drag alternative and ordering key. Do not ship drag UI before server-side authorization and conflict behavior exist.

### Calendar

Viable but more expensive: start/end/title fields are easy; timezone, all-day, recurrence, overlap, drag-resize and mobile views are not. A read-only generic calendar with click-through can arrive before mutation. It is unrelated to ownership of the official `runly.calendar` module.

Later: timeline, gallery, charts/reporting, wizard, map and specialized reports.

## 25. Automations and MirAI

Automations are not MVP. Later, add a declarative `Trigger -> Condition -> Action` model backed by a central event/job runtime and strict module/company scope. Do not generate arbitrary handlers from Builder.

MirAI is another ModuleDefinition client. It may suggest fields, views, sample data or generate a draft from text, but all output passes the same validators and review flow. The complete Builder remains usable without AI.

## 26. Security model

Builder-managed policy denies:

- arbitrary SQL and unsafe migration flags;
- imports or free-form Node/React/Hono code;
- routes outside the module namespace;
- access to undeclared/core tables;
- non-owned destructive DDL;
- PostgreSQL extensions;
- filesystem/network access;
- permission keys outside module namespace;
- cross-company queries or normal UI opt-out from `companyScoped`;
- package paths outside root and symlink/device entries.

Additional controls:

- compile from declarative capabilities, not user source;
- RLS enabled and Data API roles revoked for module tables;
- dependency allowlist and bundle external allowlist;
- ZIP entry count, compression ratio and streaming byte limits;
- package hashes, provenance and audit trail;
- explicit destructive confirmation and backups in later phases;
- ownership prefixes remain preferred over PostgreSQL schemas for compatibility with current raw SQL, PostgREST/Supabase expectations and existing modules.

Advanced packages retain current RME3 power under an administrator/developer trust policy and receive stronger warnings/signing provenance.

## 27. Backward compatibility and migration strategy

1. Keep all existing `defineRunlyModule`, `defineModel`, `defineView`, `definePage`, `atlas.*` keys and aliases.
2. Add optional IDs/package metadata first; absence means legacy behavior, not invalid package.
3. Record baseline schema snapshots for installed modules by combining declared models with verified DB introspection; flag drift rather than silently rewriting it.
4. Route the current upload and lifecycle endpoints through Package Service adapters without changing external SDK shapes initially.
5. Move scaffolder internals behind `module-compiler`; keep CLI prompts and outputs compatible.
6. Only Builder-managed modules are subject to restricted declarative policy.
7. Existing manual migrations continue for advanced modules; automatic diff is opt-in until proven.
8. Introduce new blueprint kinds only with Prisma/runtime compatibility migrations and old-client graceful handling.

## 28. Observability and audit

Emit structured events with request ID, actor, module key, package hash/version, previous package, stage, duration and result:

- `module.package.created`, `validated`, `staged`, `published`, `exported`
- `module.install.started/succeeded/failed`
- `module.upgrade.planned/succeeded/failed`
- `module.migration.planned/applied/rejected`
- `module.disabled/enabled/uninstalled/purged`
- `module.rollback.started/succeeded/failed`

Do not put secrets, infrastructure addresses or production payloads in logs. AuditLog history should survive purge as a historical record while owned live resources must not.

## 29. Testing strategy

### Package

Valid/root-folder ZIP, malformed ZIP, traversal with slash/backslash, absolute/device/symlink entries, duplicate normalized names, wrong/dynamic manifest key, file/entry/count/ratio limits, failed write, failed compile, failed swap and recovery of previous artifact.

### Schema

First install, add table, nullable column, safe-default column, index, unique preflight failure, relation/FK preflight, metadata-only rename, stable-ID rename candidate, destructive rejection, drift detection and schema snapshot verification.

### Lifecycle/purge

Install/retry/disable/enable; uninstall all three modes; dependency blocking; teardown failure; owned table drop; hard purge with views/migrations/permissions/grants/company rows/bundles/routes/caches/files; idempotent retry; `assertNoModuleResourcesRemain` returning empty.

### Builder/compiler

Definition validation, deterministic compiler, golden package fixtures, tenant-safe generated CRUD, preview, ZIP export/import across two roots, Builder detachment and hash-drift classification.

### Golden path acceptance test

```text
ModuleDefinition -> compile -> canonical ZIP -> upload/stage -> sync/install
-> table/routes/views -> create record
-> edit definition -> schema diff -> upgrade -> column verified
-> uninstall purge-owned-tables -> tables/data gone
-> hard purge -> metadata/files/bundles/routes/caches absent
-> assertNoModuleResourcesRemain == []
```

## 30. Roadmap

### Phase 0 — Contract audit closure

- encode current lifecycle/package/view contracts in tests;
- establish capability registry and current field/view matrix;
- add residue-reporting diagnostics without deletion;
- correct stale terminology (`ATLAS_MODULES_DIR` comments vs `RUNLY_MODULES_DIR`).

### Phase 1 — Ownership, purge and package hardening

- central ownership inventory;
- complete/idempotent hard purge and residue assertion;
- staged upload, compile/validation dry-run, same-volume atomic swap and recovery journal;
- package hashes/provenance and immutable artifact record;
- route/bundle/cache coordination.

### Phase 2 — Schema Diff Engine

- canonical schema snapshots and DB introspection;
- stable resource IDs;
- additive plans and preconditions;
- dry-run/risk output;
- migration application and post-verify.

### Phase 3 — ModuleDefinition and compiler extraction

- JSON Schema/semantic validation;
- pure virtual package compiler;
- migrate scaffolder to compiler adapter;
- deterministic ZIP output and golden compatibility tests.

### Phase 4 — Unified Package Service

- inspect/stage/validate/compile/publish/install/export;
- current upload and CLI use the service;
- local install and download consume the same artifact;
- installation/package history.

### Phase 5 — Renderer vNext

- formal Cards presentation contract;
- limited declarative Dashboard;
- Kanban contract/runtime;
- read-only then interactive generic Calendar.

### Phase 6 — Builder projects and preview

- projects/revisions/statuses;
- direct declarative preview and sample data;
- compare/validate/publish APIs;
- Builder/Advanced classification.

### Phase 7 — Web Module Builder

- templates/blank start;
- entities, fields, many-to-one relations;
- Table/Cards/Form/Detail/Dashboard editors;
- navigation and CRUD permissions;
- review, preview, ZIP download and local install.

### Phase 8 — Advanced capabilities

- Kanban/Calendar polish;
- automations;
- MirAI definition tools;
- template catalog/community/marketplace;
- package signing and rollback;
- selected destructive schema operations with backup.

## 31. MVP definition

MVP includes:

- create/edit drafts from blank or ModuleDefinition templates;
- tenant-scoped entities and safe field subset;
- many-to-one relations;
- generated CRUD routes/services/validators;
- Table, Cards, Form, Detail and limited Dashboard;
- navigation and CRUD permissions;
- direct preview with sample data;
- additive schema upgrades only;
- validation and upgrade dry-run;
- one canonical package artifact;
- ZIP download and install into current instance;
- complete purge with residue assertion;
- detach to Advanced.

MVP excludes:

- arbitrary code/SQL;
- destructive schema migrations and DB rollback;
- many-to-many visual modeling;
- generic CRUD runtime rewrite;
- Kanban/Calendar unless Phase 5 completes cheaply;
- automations, marketplace/community, package signing and AI dependency;
- Advanced -> Builder round-trip.

## 32. Acceptance criteria

1. Existing RME3 modules install unchanged.
2. Current CLI produces valid packages through the shared compiler.
3. Same normalized definition produces identical source/package hashes.
4. Exported ZIP is accepted by the same upload pipeline without special flags.
5. Failed upload/compile/schema dry-run leaves active package, routes and bundle unchanged.
6. Adding a field produces `ADD_COLUMN`, applies it and verifies the physical column.
7. Destructive diff is rejected in Builder v1 with explicit diagnostics.
8. Installed state records exact package and schema snapshot hashes.
9. Disable preserves files, data, metadata and package while removing runtime availability.
10. Purge-owned-tables deletes all declared owned SQL tables and migration records.
11. Hard purge removes every live owned resource; residue assertion is empty.
12. Audit history remains queryable and clearly historical.
13. Builder preview never writes to the production module root.
14. Builder-created data access is company-scoped by default and permission-checked.
15. The golden end-to-end test passes on two isolated module roots/instances.
16. `pnpm check:privacy` passes before changes are shared.

## 33. Explicit answers to the audit questions

1. **State today:** mature initial-install runtime with declarative CRUD and dynamic code escape hatch; not a safe visual update platform.
2. **Finished:** contracts, discovery, metadata, main lifecycle states, permissions/dependencies, initial SQL generation, route loading, dynamic bundling, CRUD renderers, upload validation and scaffolder.
3. **Docs overstate:** “atomic” ZIP replacement, complete hard purge, and practical support implied by all declared blueprint kinds.
4. **Partial:** migration evolution, cleanup/purge, package management, relations, field rendering parity and Cards contract.
5. **Main blocker:** schema evolution; package atomicity and complete ownership cleanup are co-blockers for production.
6. **Automatic schema evolution:** no.
7. **Modified `defineModel`:** new checksum/migration runs another create-if-not-exists; existing table does not gain a new column.
8. **Hard purge removes everything:** no.
9. **Possible residues:** views, migrations, orphan permissions/grants, tables/data, bundle local/Storage, loaded routes, caches and possibly dependency blockers.
10. **Uploader production-safe for updates:** good archive validation, unsafe replacement semantics.
11. **Needed:** staging, semantic validation, bundle/schema dry-run, immutable artifact, atomic swap, activation verification and rollback journal.
12. **Scaffolder reuse:** most domain rules/templates/tests; not its direct writer as the domain API.
13. **Shared compiler:** yes.
14. **Canonical format:** versioned JSON-compatible ModuleDefinition with stable IDs and no executable content.
15. **ZIP generation:** deterministic compiler artifact archived in the one RME3 package format.
16. **Direct install:** Package Service installs the exact stored artifact through existing lifecycle.
17. **Builder update:** new immutable revision/package plus identity-aware metadata/schema dry-run and additive migration.
18. **Versioning:** semver plus definition/source/build/package hashes and installed package reference.
19. **Builder -> Advanced:** one-way detach/eject with snapshot; no guaranteed reverse round-trip.
20. **Real declarative views:** TABLE, FORM, DETAIL, PAGE composition; CUSTOM works through code; Cards works as Table presentation.
21. **Missing:** generic Dashboard, Kanban and Calendar; ACTION/RELATION are not full screens.
22. **First renderer:** formalize Cards, then build limited declarative Dashboard.
23. **Dashboard viability:** high.
24. **Kanban viability:** medium-high after mutation/order contract.
25. **Calendar viability:** medium; start read-only and define timezone semantics.
26. **CRUD choice:** generated services/routes for MVP; generic runtime later.
27. **Before Web Builder:** purge ownership, atomic packages, schema diff/snapshots, ModuleDefinition/compiler and unified Package Service.
28. **Can wait:** destructive migrations, DB rollback, automation, marketplace, AI, many-to-many and specialized renderers.
29. **Technical MVP:** the safe additive, tenant-scoped scope in section 31.
30. **Roadmap:** phases 0–8 in section 30.

## 34. Risk register

| Severity | Risk | Why it matters | Mitigation |
|---|---|---|---|
| BLOCKER | metadata/schema drift | generated UI/API references absent columns | snapshots, diff, post-verify |
| BLOCKER | destructive package replacement | failed update removes working module | staged atomic publish/recovery |
| BLOCKER | incomplete purge | privacy, collisions and reinstall failures | inventory + residue assertion |
| HIGH | cross-resource non-transactionality | DB/filesystem/Storage/routes can disagree | saga/journal/idempotency |
| HIGH | executable advanced package validation | import can execute module code | trust tiers and isolated validation |
| HIGH | tenant leakage | visual author may omit scope | compiler-enforced company scope |
| MEDIUM | compiler/template drift | CLI and Builder emit different packages | one compiler, golden tests |
| MEDIUM | renderer contract sprawl | visual editor cannot predict runtime | capability registry/versioning |
| MEDIUM | false rollback promise | forward DB migration may break old code | compatibility gates, forward-only MVP |
| LOW | package size/storage growth | immutable versions accumulate | retention policy after correctness |

## 35. Open questions

These require product/operational decisions rather than more repository reading:

1. Are Builder projects instance-global or company-owned, and who may publish them?
2. How many previous immutable package artifacts/revisions must an instance retain?
3. Should advanced package installation require signatures/allowlisted publishers in self-hosted deployments?
4. Is a global, non-company-scoped Builder entity ever allowed in v1, or only after detaching to Advanced?
5. Should the MVP include limited Dashboard, or ship CRUD+Cards first and add Dashboard immediately afterward?

## 36. Final recommendation

### WHERE WE ARE

RME3 is a credible modular runtime and technical authoring system with strong initial-install primitives and a useful scaffolder.

### WHAT IS MISSING

Trustworthy updates: stable definitions/IDs, schema diff, immutable packages, atomic publication and provably complete ownership cleanup.

### WHAT WE SHOULD BUILD NEXT

First PR/SPEC: **RME3 Package Ownership & Hard Purge Hardening**, including `ModuleResourceInventory`, complete bundle/route/cache/files/metadata cleanup, idempotency and `assertNoModuleResourcesRemain` tests. Follow with staged atomic package publication, then additive Schema Diff Engine.

### IMPLEMENTED PACKAGE PUBLICATION BOUNDARY

The upload adapter now creates a staged package below the authoritative custom
module root. Existing RME3 manifest/model/view loaders inspect it and esbuild
compiles its components before the active package changes. Publication uses
same-filesystem renames, a temporary backup, coordinated bundle replacement,
lifecycle-aware runtime reload, per-module filesystem locking and compensating
rollback. Package publication remains separate from installation. Database
schema differences are reported but not applied; additive schema planning is
the next increment.

### IMPLEMENTED ADDITIVE SCHEMA BOUNDARY

`RunlyModel.schema` is the applied-definition snapshot for legacy and current
models. The engine normalizes only database-affecting properties, introspects
the actual public PostgreSQL table, performs a three-way comparison and emits a
stable MigrationPlan. Automatic execution is limited to backward-compatible
table creation, nullable/safely-defaulted columns, empty-table conditional
columns and non-unique indexes. Verification and the ModuleMigration ledger are
transactional. Drift, removals, renames, type changes and other destructive
operations block publication before package swap.

### WHAT CAN WAIT

### IMPLEMENTED SHARED COMPILER BOUNDARY

`ModuleDefinition` v1 es JSON-compatible, versionada y validada antes de
normalización. `@runly/module-compiler` transforma esa fuente de manera pura y
determinista en un package RME3 ordinario; no conoce prompts, filesystem,
publishing, HTTP ni DB. El scaffolder es ahora un adapter y
`.module-definition.json` conserva provenance sin participar en runtime.

### IMPLEMENTED DECLARATIVE DASHBOARD BOUNDARY

`DASHBOARD` es una capacidad aditiva de ModuleDefinition v1 y un blueprint RME3
real. Sus fuentes son declarativas, owned por el módulo y ejecutadas en batch
por el servidor con ACL y tenant scope derivados del contexto autenticado. El
renderer genérico soporta stat, bar/line/pie/donut y list con estados aislados.
No se permiten SQL, joins, fuentes core/cross-module ni JSX de widget.


The Web UI itself, destructive schema edits, rollback of database changes, generic CRUD runtime, automations, AI, marketplace and the long-tail renderers.
