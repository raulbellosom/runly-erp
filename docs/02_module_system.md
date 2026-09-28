# Runly ERP - Module System (RME3)

Runly ERP is a module engine. Each ERP capability is modeled as a module that declares its own lifecycle metadata, permissions, navigation, data models, views, and optional API/component extensions.

## Module locations

| Directory | Namespace | Owner |
|---|---|---|
| `modules/custom/<moduleKey>/` | `custom.*`, `community.*` | Partners/community |
| `apps/api/src/manifests/official/` | `runly.*` | Internal official manifest snapshots (seed/runtime baseline) |

> `modules/custom/` is instance data, not source: the Module Builder, ZIP uploads and installs write into it (plus internal `.staging/`, `.previews/`, `.backups/`, `.locks/` folders), so it is git-ignored except for its `.gitkeep`. Keep a module's source in its own repository or as the ZIP exported from the Builder, and bring it into an instance by uploading the ZIP (or by copying it into `modules/custom/` locally and running `POST /modules/sync`). Never commit a module folder to this repo. `modules/official/` is legacy and unused: official modules ship as manifest snapshots in `apps/api/src/manifests/official/`; module discovery still tolerates the folder but nothing should be placed there.

`packages/maps/` was decommissioned and removed on 2026-05-25.

## Manifest standard

Every RME3 module uses `defineRunlyModule` in `module.manifest.js`.

```js
import { defineRunlyModule } from '@runly/module-engine'

export default defineRunlyModule({
  key: 'custom.fleet',
  name: 'Flota',
  version: '0.1.0',
  kind: 'FEATURE',
  dependencies: [{ key: 'runly.core' }],
  lifecycle: {
    installable: true,
    uninstallable: true,
    resettable: true,
    supportsDataPurge: true,
    defaultUninstallPolicy: 'preserve-data',
    ownedEntities: ['Vehicle'],
    sharedEntities: ['Company', 'AuditLog'],
  },
  permissions: [
    { key: 'fleet.access', name: 'Access Fleet' },
    { key: 'fleet.vehicles.read', name: 'Read Vehicles' },
  ],
  navigation: [
    {
      label: 'Vehiculos',
      path: '/fleet/vehicles',
      icon: 'Truck',
      layout: 'main',
      permissionKey: 'fleet.vehicles.read',
    },
  ],
})
```

`createModuleManifest` is deprecated for new module development.

## Prisma boundary

Prisma manages platform/core models and RME3 metadata models.

Module-owned business tables should be declared through Runly ORM (`defineModel`) and managed by the RME3 DDL pipeline, not by adding Prisma tables for new module work.

## Views and blueprints

Module views are declared with `defineView` and rendered by the RME3 renderer (`RunlyTable`, `RunlyForm`, `RunlyDetail`, `RunlyCrudView`).

See `docs/08_blueprints.md` for supported blueprint field types.

## Lifecycle model

```
DISCOVERED -> UNINSTALLED <-> INSTALLED <-> DISABLED
                             ^
                           ERROR
```

- `RunlyModule.status` stores lifecycle state.
- Core modules are protected (`core: true`, `uninstallable: false`).
- Destructive lifecycle operations require dry-run + explicit confirmation.

## Permission conventions

Each module should define:

- `module.access`
- `module.resource.read`
- `module.resource.create`
- `module.resource.update`
- `module.resource.delete`

Navigation entries require `permissionKey`, and API routes must enforce matching ACL permissions.

## New module checklist

1. Create `modules/custom/<moduleKey>/module.manifest.js` with `defineRunlyModule`.
2. Add entities in `models/*.model.js` with `defineModel`.
3. Add blueprints/views in `views/*.js` with `defineView`.
4. Add pages in `pages/*.page.js` with `definePage`.
5. Optionally add `api/index.js` for module-specific endpoints.
6. Run `POST /modules/sync`.
7. Install/enable from module catalog.

Do not introduce new work in legacy manifest paths or manual core wiring patterns.
