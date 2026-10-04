# RME3 ModuleDefinition v1 y Module Compiler

## Arquitectura

```text
CLI ─────────┐
Builder ─────┼──> ModuleDefinition ──> @runly/module-compiler ──> paquete RME3
MirAI ───────┘           (futuro)                               (runtime normal)
```

Actualmente sólo el CLI es cliente. Builder y MirAI se muestran como límites
futuros; no forman parte de esta implementación.

## Separación e inventario

- Input/UI: `scripts/scaffold-module.js` y `scripts/scaffold/prompts.js`.
- Dominio: `packages/module-compiler/src/definition.js`.
- Compilación pura: `packages/module-compiler/src/compiler.js` y `templates/`.
- Output filesystem: `scripts/scaffold/writer.js`.

Se conservan key, nombre, versión, descripción, icono, color, PWA, preset,
entidades, labels singular/plural, `companyScoped`, `softDelete`, fields,
`required`, opciones y relaciones. Los tipos exactos son `text`, `textarea`,
`number`, `decimal`, `boolean`, `select`, `multiselect`, `date`, `datetime`,
`email`, `phone`, `relation`, `file`, `json`, `markdown`, `color` y `richtext`.

Los presets `crud` y `crud-custom` son ahora factories de definiciones. Ambos
usan el mismo compilador; `crud-custom` añade dashboard/componentes React como
capa de compatibilidad, no como renderer declarativo.

## Contrato v1

La fuente es un objeto JSON-compatible con `schemaVersion: 1`, identidad y
presentación del módulo, PWA, preset, dependencias, entities, permissions,
views y navigation. Una entity separa `id`, key estable y labels visibles. Un
field usa configuración por tipo: selects requieren options y relations
requieren `targetEntity` interno o `targetModel` externo. Los defaults sólo
aceptan literales string, number o boolean; no aceptan SQL.

Las vistas v1 son `TABLE`, `FORM`, `DETAIL` y `PAGE`. Una definición mínima las
genera automáticamente y marca `generated: true`. El contrato conserva vistas
explícitas y sus referencias; la expansión completa de columns, sections y page
configuration pertenece al siguiente incremento de renderers.

## Validación y defaults

`validateModuleDefinition` devuelve `{ valid, errors, warnings }`; cada
diagnóstico tiene `path`, `code`, `message` y `severity`. Valida versión, JSON
puro, namespaces/identificadores, rutas confinadas, icono/color/PWA, duplicados,
configuración discriminada y referencias entre relations, views, navigation y
permissions. También bloquea texto que podría convertirse en código al emitirse.

`normalizeModuleDefinition` aplica version `0.1.0`, preset `crud`, dependencia
`runly.core`, `companyScoped: true`, `softDelete: true`, cuatro permisos CRUD,
cuatro vistas y navigation por entity. El override de company scope continúa
disponible para el CLI avanzado por compatibilidad; un futuro Builder debe
mantener el default seguro.

## API y pipeline

La API exporta `validateModuleDefinition`, `normalizeModuleDefinition`,
`assertValidModuleDefinition`, `createCrudDefinition`,
`createCrudCustomDefinition`, `createDefinitionFromScaffoldConfig`,
`upgradeModuleDefinition` y `compileModule`.

```text
raw definition -> validate -> normalize/defaults -> validate -> templates
               -> files ordenados -> SHA-256 packageHash
```

`compileModule` no toca filesystem. Devuelve `moduleKey`, definition, files,
diagnostics, packageHash, manifest, models y views.

## Package generado

`crud` genera `.module-definition.json`, manifest, models, TABLE/FORM/DETAIL/PAGE,
rutas, services, helpers y validators. `crud-custom` añade dashboard y dos
artifacts de componentes. El manifest deriva lifecycle ownership y permisos.
Los models usan `defineModel`; el compiler nunca genera ni ejecuta SQL. El
Schema Diff Engine conserva la responsabilidad exclusiva de DDL.

## Source y runtime

Se incluye `.module-definition.json` para provenance, reimport y edición futura.
Es la fuente del generador; los `.js` son los artifacts que RME3 ejecuta y el
runtime ignora el JSON. Tras eject/edición manual, el package sigue siendo RME3
normal y el JSON puede quedar desactualizado. Recompilar vuelve a tomar la
definición como fuente y sobrescribe artifacts derivados.

## Determinismo y versionado

No hay timestamps ni IDs aleatorios. Se conserva el orden semántico de arrays
del autor, los paths finales se ordenan léxicamente y el formatting vive en
templates versionados. La misma definición produce los mismos bytes y hash.

`CURRENT_MODULE_DEFINITION_SCHEMA_VERSION` identifica v1 y
`upgradeModuleDefinition` es el límite para futuras migraciones. Hoy rechaza
cualquier origen/destino distinto de v1; una v2 añadirá una migración v1→v2.

## CLI

```bash
node scripts/scaffold-module.js
node scripts/scaffold-module.js module.config.json
node scripts/scaffold-module.js --definition module-definition.json
```

El último modo es no interactivo. El writer expone
`writeCompiledModule(compiledModule, destination)` como adapter filesystem.

## Dashboard declarativo

ModuleDefinition v1 admite vistas `DASHBOARD` explícitas sin cambiar
`schemaVersion`. Se compilan como `views/<key>.dashboard.js` con `defineView`;
no generan JSX ni componentes dinámicos. Los widgets MVP son `stat`, `chart`
(`bar`, `line`, `pie`, `donut`) y `list`. Consulta el ejemplo
`examples/module-definitions/declarative-dashboard.json`.

Cada source referencia exclusivamente una entity owned por el módulo y puede
declarar `aggregate`, `aggregateField`, un `groupBy`, filters, order y limit.
No admite SQL, joins ni referencias cross-module. Dashboard es opt-in: las
definiciones CRUD existentes no reciben una vista nueva automáticamente.

### Kanban declarativo

Una vista `KANBAN` declara `entity`, `groupBy` y `card.titleField`; la tarjeta
puede añadir `subtitleField`, `descriptionField`, `badgeField` e `imageField`.
`groupBy` acepta campos `select` o `boolean`. El compiler deriva columnas y
etiquetas desde las opciones del modelo y emite `views/<key>.kanban.js`. Véase
`examples/module-definitions/declarative-kanban.json`.

El runtime recibe solo `viewKey`, vuelve a cargar el esquema persistido y limita
la consulta a modelos owned por el módulo. Aplica compañía, soft-delete,
filtros/order allowlisted y 200 registros por defecto (máximo 500). El drag
reutiliza el `PATCH` CRUD con permiso `update`; sin él, el tablero es de lectura.
SQL, joins, relaciones hidratadas y fuentes cross-module no se admiten en v1.

## Enlaces públicos (`publicLinks`)

Sección opcional de la definición (máximo 10). Cada entrada es una ficha
pública (`mode: 'view'`, `fields`) o un formulario público (`mode: 'submit'`,
`targetEntity`, `formFields`, `linkField` opcional). El compilador emite
`publicResources` en el manifiesto, `views/<key>.public.js` (vista CUSTOM
pública en `/p/<slug>/<key>` con el componente genérico
`runly.public:RecordPage` y `schema.publicPage`) y `api/public.js`, que reusa
los servicios y validadores generados. Solo se exponen los campos listados;
archivos, JSON y relaciones externas no se aceptan, y todos los campos
obligatorios del formulario deben estar en `formFields`. Implementación:
`packages/module-compiler/src/public-links.js`. Plataforma y reglas:
`docs/ai-context/rme3-public-links.md`.

## Automatizaciones (`automations`)

Spec: `docs/superpowers/specs/2026-10-04-builder-automations-design.md`; guía: `docs/developers/automatizaciones.md`.

- `definition.automations` (máx. 20): `{ key, label, enabled, trigger, action }`. `trigger` es `{ type: 'record', entity, on: 'create'|'update'|'save', when? }` o `{ type: 'event', event, when? }`; `when` = `{ field, op: 'equals'|'changed'|'filled', value? }`. `action` = `{ service, args: { <arg>: { from: 'value'|'field'|'template'|'recordId'|'actor', ... } } }`.
- `automations.js` valida contra `SERVICE_CONTRACTS` / `DOMAIN_EVENT_PAYLOADS`: servicio existente y que escribe, args declarados y obligatorios cubiertos, `system: true` para triggers de evento, `actor` solo en triggers de registro, `changed` solo al actualizar.
- El manifiesto **deriva** `consumes` y `events.subscribes`; en la definición siguen prohibidos a mano (`BUILDER_INTEGRATION_UNSUPPORTED`).
- `compileModule` genera `api/automations.js` (runtime inline: `matches`, `render`, `buildArgs`, `runRecordAutomations`, `createEventHandlers`), `api/events.js` si hay triggers de evento, y llamadas en las rutas create/update (respuesta `automations: [{ key, ok, error? }]`; un fallo no deshace el guardado). `sourceEntityId` e `idempotencyKey` se agregan solos.
- Publicar (`publishProject`, `canGrant` = `core.modules.manage`) autoriza los servicios derivados o los devuelve en `pendingGrants`.
- Las rutas generadas leen la empresa con `c.get('companyId')` (respaldo: `memberships[0]`).
