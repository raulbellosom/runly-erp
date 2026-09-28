# RME3 Module Builder — relations to system modules (Flotilla, Inventario, Contactos...)

Date: 2026-09-28
Status: Approved design (product owner, Module Builder session)
Builds on: `2026-09-28-rme3-builder-relations-integrity-design.md`

## 1. Goal

A Builder module can relate its records to entities of other (system)
modules and show their data: Contacto, Colaborador, Vehículo, Artículo de
inventario, Proyecto, Tarea, Evento de calendario, Cuenta, Archivo.

## 2. Contract

Relation field `{ type: 'relation', targetExternal: '<type>' }` with `<type>`
from `EXTERNAL_RELATION_TARGETS` (module-compiler `external-relations.js`:
label, owning module, read permission). Diagnostics:
`EXTERNAL_RELATION_TARGET_NOT_FOUND`, `RELATION_TARGET_CONFLICT` (not both
`targetEntity` and `targetExternal`). Normalization adds the owning module as
a dependency (it cannot be uninstalled while used).

## 3. API

- `relation-targets-service.js`: `catalog()` (installed flag per type),
  `search()` per type through the owning module's own data rules (company
  scope, members/shares/access for projects, tasks, calendar, ledger, files)
  after checking the type's read permission, and `resolve()` in batch by
  reusing the chat entity-reference resolvers (`resolveReferences`).
- Routes: `GET /relation-targets` (Builder), `GET /relation-targets/:type/search?search=`
  (picker, `{ data: [{ id, title, subtitle }] }`), `POST /relation-targets/:type/resolve`.
- `moduleContext.relations.resolve(c, type, ids)` for generated modules.

## 4. Generated module

- `<entity>-relations.js`: `assertExternalTargets` (create/update: 400 when
  the record does not exist, is inactive or the user cannot see it) and
  `withExternalLabels` (list/get add `<field>__label` = "Título · detalle" and
  `<field>__url`).
- Views: form picker on `/relation-targets/<type>/search` (`labelField: title`),
  table column `<field>__label`, detail `type: 'external-link'` (label linked
  to the record's own screen).
- Disable rules (Bloquear / Dejar vacío / Desactivar también) do not apply:
  system records are not controlled by the Builder module; an inactive or
  hidden record shows "No disponible".

## 5. UI

FieldSheet "Relacionar con": "Este módulo · X" and "<Módulo> · <Entidad>"
(disabled when the module is not installed), with a note about the needed
permission and the dependency. RunlyForm shows a saved relation's label from
`<field>__label` when it is not in the first page of options.

## 6. Out of scope

Showing Builder records inside system module screens (reverse direction),
writing into other modules.
