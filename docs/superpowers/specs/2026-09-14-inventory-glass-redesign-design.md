# Rediseño glass de RunlyTable/RunlyForm/RunlyDetail y migración de runly.inventory a blueprints, con historial de auditoría

Date: 2026-09-14
Status: Draft
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-14-inventory-glass-redesign-design.md
Plan file: docs/superpowers/plans/2026-09-14-inventory-glass-redesign.md (created after spec approval)

---

## 1. Feature title

Rediseño visual glass de los renderers compartidos (`RunlyTable`/`RunlyForm`/`RunlyDetail`/`DetailHero`/`StatStrip`) y migración de las pantallas de creación/edición y detalle de `runly.inventory` a blueprints, con panel de historial de auditoría.

## 2. Status

Draft

## 3. Context

El sistema "Glass" (glassmorphism) ya es el lenguaje visual de referencia del proyecto (tokens app-wide en `packages/ui`), y en septiembre de 2026 el módulo `runly.fleet` migró sus pantallas de vehículos/conductores a `RunlyCrudView` con `RunlyDetail` usando `schema.hero` + `schema.kpis` + `layout: "two-column"` y los nuevos componentes `DetailHero`/`StatStrip`. Ese patrón nunca se replicó en `runly.inventory`: sus pantallas de alta/edición (`InventoryItemForm.jsx`, 541 líneas) y detalle (`InventoryItemDetail.jsx`, 302 líneas) siguen siendo JSX hand-rolled con `react-hook-form` y helpers de formato duplicados, construidas antes del patrón Fleet. El dueño del producto describió estas pantallas como "muy feas, incipidas y mal estructuradas" y pidió un rediseño que, de paso, actualice los renderers compartidos para que cualquier otro módulo que ya los use (Fleet y futuros módulos) se beneficie sin rehacer trabajo por módulo.

## 4. Problem

Dos problemas relacionados:

1. `RunlyTable`, `RunlyForm`, `RunlyDetail`, `DetailHero` y `StatStrip` se ven planos/desactualizados frente al resto del sistema glass del producto, así que cada módulo que los usa desentona visualmente con los módulos que sí tienen estilo glass propio.
2. Las pantallas de alta/edición y detalle de activos en `runly.inventory` son JSX hand-rolled que duplican lógica de layout/formato que `RunlyForm`/`RunlyDetail` ya generalizan, no usan el patrón hero/KPI/dos-columnas ya probado en Fleet, y no muestran historial de auditoría — aunque el backend ya registra cada mutación (alta/edición/asignación/devolución) en `AuditLog`, lo hace con un payload (`hint: { verb, label }`) que el traductor de `activity-bridge.js` no entiende, así que cualquier intento de mostrar ese historial hoy renderizaría texto crudo de respaldo en vez de oraciones reales.

## 5. Goals

1. `RunlyTable`, `RunlyForm`, `RunlyDetail`, `DetailHero` y `StatStrip` se renderizan con el lenguaje visual glass del producto (paneles con blur, bordes suaves, encabezados de sección con un chip de ícono representativo en vez de un título plano, degradados de acento, tipografía/espaciado refinado), sin cambios de props/API, de modo que todo consumidor existente (Fleet vehículos/conductores, y cualquier módulo futuro) hereda el nuevo look automáticamente en el próximo deploy.
2. La pantalla de alta/edición de `runly.inventory` se reconstruye como un blueprint `FORM` de `RunlyForm` con secciones identificadas por ícono (Identificación, Ubicación y estado, Compra, Garantía, Campos personalizados, Notas, Archivos), reemplazando el `InventoryItemForm.jsx` hand-rolled.
3. La pantalla de detalle de `runly.inventory` se reconstruye como un blueprint `DETAIL` de `RunlyDetail` usando `schema.hero` (nombre/etiqueta/estado/categoría/imagen) y `schema.kpis` (asignado a, fecha de asignación, vencimiento de garantía, valor de compra) con `layout: "two-column"`, reemplazando el `InventoryItemDetail.jsx` hand-rolled.
4. `InventoryCustomFieldsForm`, `InventoryAssignmentPanel`, `InventoryCommentThread` y `AttachmentsPanel` siguen funcionando sin cambios de comportamiento, montados en los nuevos blueprints vía el mecanismo `componentRegistry` que Fleet ya usa para widgets no estándar.
5. Aparece un panel funcional de "Historial de auditoría" en el detalle de inventario, mostrando oraciones reales en español para alta, edición, asignación y devolución del activo (y, como adición nueva, la baja/eliminación), usando `ActivityTimeline` conectado al pipeline existente `AuditLog`/`Activity`.
6. Se agregan a `RunlyForm` dos capacidades nuevas, opcionales y controladas por schema (apagadas por defecto): un anillo de "ficha completada" y un panel de "vista previa en vivo", activados específicamente en el blueprint de alta/edición de inventario.
7. No hay regresión visual en las pantallas de vehículos/conductores de Fleet (el otro consumidor actual de `hero`/`kpis`/`layout:"two-column"` en `RunlyDetail`), verificado manualmente tras el restyle.

## 6. Non-goals

1. No se cambian props, fetching de datos, validación, ni el comportamiento de schema de `RunlyTable`/`RunlyForm`/`RunlyDetail` — esto es un restyle visual más dos flags de schema nuevos y opcionales, no una reescritura del motor de renderers.
2. No se cambian endpoints de API, permisos, modelos de Prisma, ni métodos del SDK de `runly.inventory` — la funcionalidad reutiliza todo lo que ya existe (ver secciones 11-14).
3. No se migra `runly.inventory` a RME3 (`defineRunlyModule`/`modules/custom/`) — sigue siendo un módulo Phase 1-2 de escritorio; esta funcionalidad solo toca sus pantallas.
4. No se construye ni migra ningún editor de texto enriquecido/menciones nuevo — `MarkdownField` (notas/garantía) y `CommentThread`/`MentionTextarea` (comentarios) se quedan exactamente como están; la investigación confirmó que no existe un editor mejor al que migrar para ninguno de los dos casos (ver Contexto).
5. No se rediseña visualmente cada módulo que reutiliza estos renderers más allá de un chequeo de regresión puntual (HR, Contactos, Finanzas, etc. heredan el restyle automáticamente pero no se auditan pantalla por pantalla en esta funcionalidad).
6. No hay cambios de ruteo — las rutas actuales `/inventory`, `/inventory/new`, `/inventory/:id` (y la resolución actual del modo edición dentro de la pantalla de formulario) se mantienen igual.
7. No se introduce una suite de pruebas de regresión visual automatizada (no existe ninguna en el repo hoy); la verificación es manual (ver sección 26).

## 7. User stories

- Como usuario con `inventory.item.create`, quiero dar de alta un activo en un formulario claro, con secciones identificadas por ícono y con vista previa en vivo, para no perderme entre campos ni cometer errores.
- Como usuario con `inventory.item.read`, quiero ver el detalle de un activo con su información, KPIs (asignado a, garantía, valor) y un historial de auditoría legible, para entender su estado sin tener que preguntarle a alguien más.
- Como desarrollador de otros módulos (Fleet, HR, etc.), quiero que mis pantallas ya construidas con `RunlyTable`/`RunlyForm`/`RunlyDetail` se vean modernas sin tener que tocar código, para no duplicar esfuerzo de diseño módulo por módulo.

## 8. UX requirements

- Todo texto de UI en español (etiquetas, mensajes de error, estados vacíos).
- Responsivo obligatorio en 390px (mobile: columna única, `StatStrip` en scroll horizontal) y 1440px (desktop: layout de dos columnas) — se corre el checklist de 14 aspectos (`docs/ai-context/ui-screen-audit-checklist.md`) sobre las pantallas de creación/edición y detalle de Inventario.
- Secciones de formulario/detalle: tarjeta glass, ícono representativo junto al título de sección (ej. Identificación → `IdCard`), sin numeración tipo wizard.
- Estados de carga/vacío/error: usar `EmptyState`/`ErrorState` de `@runly/ui`, nunca texto plano.
- Confirmaciones destructivas (eliminar activo) usan `ConfirmDialog`, nunca `window.confirm`.
- El anillo de progreso y el panel de vista previa del formulario se colapsan/ocultan en mobile (< 860px) para no robarle espacio útil al formulario, siguiendo el mismo patrón responsivo que ya usan `RunlyForm`/`RunlyDetail` para su columna lateral.
- El historial de auditoría vive en la columna lateral de la vista de detalle, debajo de Comentarios.

## 9. Routes/screens

Rutas existentes, sin cambios de path — solo cambia el componente montado en cada una:

| Route | Screen | Module | Description |
|---|---|---|---|
| `/app/m/runly.inventory/inventory/new` | `InventoryItemForm.jsx` (ahora un wrapper delgado sobre `RunlyForm` alimentado por el blueprint `inventory.item.form`) | runly.inventory | Alta de activo |
| `/app/m/runly.inventory/inventory/:id/edit` (resuelto hoy dentro de `InventoryItemForm.jsx` vía un parámetro wildcard, sin cambios en esa resolución) | mismo componente que arriba | runly.inventory | Edición de activo |
| `/app/m/runly.inventory/inventory/:id` | `InventoryItemDetail.jsx` (ahora un wrapper delgado sobre `RunlyDetail` alimentado por el blueprint `inventory.item.detail`) | runly.inventory | Detalle de activo |

`/inventory`, `/inventory/catalogs` y `/inventory/assignments` no se tocan (fuera de alcance).

## 10. Data model

### New models

N/A — no hay modelos nuevos de Prisma.

### Modified models

N/A — no hay cambios de campos/esquema. La funcionalidad solo lee/escribe campos que `InvItem` y sus relaciones (`InvCategory`, `InvBrand`, `InvLocation`, `InvCustomField`, `InvItemFile`, `InvComment`) ya exponen hoy, y reutiliza los modelos existentes `AuditLog`/`Activity` para el panel de historial.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

No hay endpoints nuevos. La funcionalidad es una reconstrucción de frontend más una corrección de lógica backend existente (no rutas nuevas):

### Endpoints existentes (sin cambios) que se reutilizan

- `GET /inventory/items/:id`, `POST /inventory/items`, `POST /inventory/items/:id/assign`, `POST /inventory/items/:id/return`, `DELETE /inventory/items/:id`, `GET /inventory/custom-fields?categoryId=`, `GET|POST|DELETE /inventory/items/:id/files` — sin cambios de request/response.
- `GET /activity?entityType=InvItem&entityId=:id` (consumido vía `sdk.activity.listForEntity`) — sin cambios; solo cambia el *traductor* detrás de él (ver sección 22).

### Endpoint nuevo (alias aditivo, no reemplaza nada)

- **`PATCH /inventory/items/:id`** — alias de actualización con el mismo permiso (`inventory.item.update`) y el mismo handler (`inventoryService.updateItem`) que la ruta `PUT /inventory/items/:id` ya existente (`apps/api/src/routes/inventory/index.js:74`). Es necesario porque `RunlyForm` (el renderer compartido al que se migra el formulario de edición) siempre envía las ediciones por `PATCH` — así es como ya lo consume `runly.fleet` (`PATCH /fleet/vehicles/:id`, ver `apps/api/src/routes/fleet/vehicles-routes.js:216`). La ruta `PUT` existente se conserva sin cambios para no romper ningún otro consumidor.

### Lógica backend modificada (sin cambio de ruta/firma)

- `apps/api/src/services/inventory-service.js`: `deleteItem(id, companyId)` (línea 423) hoy hace el soft-delete (`enabled: false`) sin llamar a `bridge.logAndPublish(...)`, a diferencia de todas las demás mutaciones de este archivo. Esta funcionalidad agrega esa llamada para que las bajas también aparezcan en el historial de auditoría.
- `apps/api/src/services/inventory-service.js`: `getItem(id, companyId)` (línea 135) hoy solo devuelve `category`/`brand`/`location`/`assignedTo` como objetos anidados, sin los alias planos que `listItems()` (línea ~122-130) ya calcula para su tabla (`categoryName`, `brandName`, `locationName`, `assignedToName`). Esta funcionalidad agrega esos mismos cuatro campos calculados al objeto que devuelve `getItem`, replicando exactamente el mismo patrón. Es necesario porque las secciones de tipo `fields` de `RunlyDetail` leen `data[field.name]` de forma directa (sin soporte de rutas con punto como `category.name`), así que necesitan un campo plano; el KPI "Asignado a" tiene la misma necesidad (el resolver de KPIs solo lee un campo por KPI, no concatena varios).

## 13. SDK contract

N/A — no hay métodos nuevos o modificados en `@runly/sdk`. `sdk.activity.listForEntity(entityType, entityId, token, limit)` ya existe y es lo que `ActivityTimeline` llama internamente.

## 14. Validator contract

N/A — no hay schemas Zod nuevos ni modificados. La lista de campos del blueprint `FORM` coincide con los campos que los validadores actuales de creación/edición de `InvItem` ya aceptan; no hay cambios de reglas de validación.

## 15. Module manifest impact

N/A — el manifest de `runly.inventory` no cambia. No hay permisos, dependencias ni entradas de navegación nuevas.

## 16. Navigation impact

N/A — no hay cambios de navegación.

## 17. Blueprint impact

Se agregan dos definiciones de blueprint nuevas, module-local a `runly.inventory` (mismo patrón que las constantes `VEHICLE_FORM`/`VEHICLE_DETAIL` de Fleet — no se guardan en la tabla `Blueprint` de Prisma, porque `runly.inventory` es Phase 1-2 de escritorio, no RME3).

**Corrección técnica tras leer el código real de los renderers (no asumida en el primer borrador):** `componentRegistry` hoy **solo** existe como mecanismo de celdas personalizadas de `RunlyTable` (`packages/ui/src/runly-renderer/RunlyTable.jsx`, vía claves `"moduleKey:ComponentName"` resueltas por `apps/desktop/src/lib/moduleComponentRegistry.js`). Ni `RunlyForm.jsx` ni `RunlyDetail.jsx` reciben o usan un `componentRegistry` hoy, y ninguno de los dos tiene un tipo de sección "custom component" genérico — `RunlyForm` solo reconoce los tipos de sección `fields`/`attachments`/`parts`, y `RunlyDetail` (que normaliza sus secciones con su propia copia de `normalizeSections`, independiente de `runly-form-schema.js`) solo reconoce `fields`/`attachments`/`relation-card`/`relation-list`. Fleet nunca usó `componentRegistry` para montar paneles completos dentro de un `RunlyDetail`; lo usa exclusivamente para badges/celdas de imagen en su tabla. Por lo tanto, esta funcionalidad **agrega dos capacidades nuevas y genéricas** a los renderers compartidos (no solo "reutiliza algo que ya existe"), siguiendo el mismo patrón por el que ya se agregaron `attachments`/`parts`/`relation-card`/`relation-list` en su momento:

1. **Nuevo tipo de sección `"component"` en `RunlyDetail`**, resuelto por un nuevo prop `componentRegistry` (mismo formato de clave `"moduleKey:ComponentName"` que ya usa `RunlyTable`) que se agrega directamente a `RunlyDetail`. Las dos pantallas de Inventario usan `RunlyForm`/`RunlyDetail` de forma directa (no a través de `RunlyCrudView`, que empaqueta tabla+formulario+detalle como una sola pieza y forzaría a reescribir también la pantalla de listado, fuera de alcance) — así que `componentRegistry` se pasa directamente desde la pantalla de detalle de Inventario a `RunlyDetail`, sin tocar `RunlyCrudView.jsx`. El componente registrado recibe `{ data, apiBaseUrl, token, companyId }`.
2. **Nuevo tipo de sección `"custom-fields"` en `RunlyForm`** (reconocido también por `normalizeSections` en `packages/ui/src/runly-renderer/runly-form-schema.js`), con configuración `{ apiPath, categoryField, valuePrefix }`: obtiene en el cliente la lista de `InvCustomField` para el valor actual de `categoryField`, renderiza cada uno según su `fieldType` (mismo switch que ya tiene `InventoryCustomFieldsForm`, pero conectado a `formValues`/`handleChange` de `RunlyForm` en vez de `react-hook-form`), y en el envío aporta un arreglo `customValues: [{ fieldId, value }]` al payload — siguiendo el mismo patrón por el que la sección `type: "parts"` ya aporta `payload.parts` de forma especial en `handleSubmit`.

Con esa corrección, los blueprints quedan:

- **`inventory.item.form`** (kind: `FORM`) — secciones: Identificación (`IdCard`), Ubicación y estado (`MapPin`), Compra (`Receipt`), Garantía (`ShieldCheck`), Campos personalizados (`SlidersHorizontal`, sección `type: "custom-fields"` nueva descrita arriba), Notas (`StickyNote`, campo tipo `markdown` → `MarkdownField`), Archivos (`Paperclip`, solo en edición, sección `type: "attachments"` — esta ya existe en `RunlyForm` tal cual, sin cambios). Agrega `schema.showCompletion: true` y `schema.preview: { titleField, subtitleFields, ... }` (claves de schema nuevas y opcionales en `RunlyForm`, apagadas por defecto para cualquier otro blueprint del sistema).
- **`inventory.item.detail`** (kind: `DETAIL`) — `schema.layout: "two-column"`, `schema.hero` (titleField: name, subtitleFields: [itemType, model], statusField: status, sin imagen de portada — `InvItem` no tiene ese concepto hoy, se muestra el ícono de respaldo siempre —, metaChips: [assetTag, categoryName, brandName]), `schema.kpis` (asignado a → campo `assignedToName` nuevo, fecha de asignación (`assignedAt`), vencimiento de garantía, valor de compra), secciones de columna principal (Identificación con `categoryName`/`brandName`/`locationName` como campos planos, Ubicación y compra, Garantía, Notas, Campos personalizados de solo lectura vía sección `fields` normal) y secciones de columna lateral, cada una `type: "component"` salvo Archivos (que usa la sección `attachments` nativa que ya existe): Asignación, Comentarios y **Historial de auditoría** vía el nuevo tipo `"component"` descrito arriba, apuntando a tres adaptadores nuevos y pequeños — `InventoryDetailAssignmentSection.jsx`, `InventoryDetailCommentsSection.jsx`, `InventoryDetailHistorySection.jsx` — que envuelven, sin modificarlos, a `InventoryAssignmentPanel`, `InventoryCommentThread` y `ActivityTimeline` respectivamente. El estado (`status`) se muestra en el hero reutilizando el diccionario `STATUS_LABELS`/`STATUS_COLORS` que ya existe dentro de `RunlyDetail.jsx`, ampliado con los 5 valores propios de inventario que le faltan (`available`, `assigned`, `lost`, `stolen`, `disposed` — `maintenance`/`retired` ya están cubiertos), en vez de usar `hero.statusMap` (que solo soporta una etiqueta de texto y un color binario éxito/error, insuficiente para 7 estados con significados distintos).

Un tipo de sección desconocido en ambos renderers ya cae de forma segura en su rama por defecto (una sección "fields" vacía si no trae `fields`, o simplemente no renderiza nada), así que agregar estos dos tipos nuevos no puede romper ningún blueprint existente que no los use explícitamente (Fleet, HR, etc. no usan las cadenas `"component"` ni `"custom-fields"` hoy).

## 18. RBAC/permissions

No hay claves de permiso nuevas. Las claves existentes siguen protegiendo las mismas operaciones, sin cambios:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `inventory.access` | acceso al runtime del módulo | No |
| `inventory.item.read` | GET item, GET activity para InvItem | Ya (sin cambio) |
| `inventory.item.create` | POST item | No |
| `inventory.item.update` | PUT item | No |
| `inventory.item.delete` | DELETE item | No |
| `inventory.assignment.manage` | asignar/devolver | No |

## 19. Multi-company behavior

Sin cambios. Todos los endpoints reutilizados ya aíslan por `companyId` de la sesión autenticada; los blueprints `FORM`/`DETAIL` solo renderizan lo que la API (ya aislada por compañía) devuelve y no introducen ninguna ruta de consulta nueva. El panel `ActivityTimeline` llama a `sdk.activity.listForEntity`, que a su vez se aísla por compañía vía el propio chequeo del endpoint `/activity` existente (sin cambios en esta funcionalidad).

## 20. Files/storage impact

N/A para comportamiento de almacenamiento nuevo — `AttachmentsPanel`/`FileUploader` siguen usando el mismo bucket y los mismos metadatos `InvItemFile` que `InventoryItemForm.jsx`/`InventoryItemDetail.jsx` ya usan hoy; esta funcionalidad solo cambia cómo se monta ese panel (vía `componentRegistry` dentro de un blueprint en vez de JSX hand-rolled directo), no su comportamiento de almacenamiento.

## 21. Export/import requirements

N/A — no se introducen requisitos de exportación/importación nuevos.

## 22. Audit log requirements

No se introducen acciones nuevas de `AuditLog` para alta/edición/asignación/devolución — ya existen y ya escriben correctamente. La corrección es enteramente del lado de lectura/traducción, más una escritura nueva:

| Action key | Trigger | Payload | Cambio en esta funcionalidad |
|---|---|---|---|
| `inventory.item.created` | POST item | `after: { name, assetTag }` | Agregar traductor en `activity-bridge.js` para que se lea `"<actor> dio de alta el activo <name>"` en vez del texto crudo de respaldo |
| `inventory.item.updated` | PUT item | `after: { fields: [...] }` | Agregar traductor: `"<actor> actualizó el activo <name>"` |
| `inventory.item.assigned` | PATCH assign | `after: { employeeId }` | Agregar traductor: `"<actor> asignó el activo <name>"` |
| `inventory.item.returned` | PATCH return | `after: { status }` | Agregar traductor: `"<actor> registró la devolución del activo <name>"` |
| `inventory.item.deleted` (nueva) | DELETE item | `after: { enabled: false }` | Nueva llamada a `bridge.logAndPublish` agregada en `deleteItem()` (hoy ausente por completo) + traductor: `"<actor> dio de baja el activo <name>"` |

Los cinco traductores se registran en el mapa `TRANSLATORS` de `apps/api/src/services/activity-bridge.js`, siguiendo exactamente la forma que ya usan las entradas `hr.employee.*`/`catalog.product.*` (`{ actor, entityId, after } => ({ type, summary, severity, link })`), con `link: /app/m/runly.inventory/inventory/:entityId`.

## 23. Edge cases

1. Un activo sin historial de auditoría todavía (datos sembrados/migrados antes de esta funcionalidad) — `ActivityTimeline` debe mostrar su estado vacío existente, no un error.
2. Un activo asignado y devuelto varias veces — el historial debe mostrar cada evento en orden cronológico, no solo el más reciente.
3. Un activo eliminado (soft-disabled, `enabled: false`) no es alcanzable desde el listado actual (ya filtrado), pero si se accede directo por URL, la nueva entrada de auditoría de la baja debe seguir siendo visible en el historial (para activos eliminados después del deploy de esta funcionalidad).
4. Un activo sin relaciones opcionales (sin categoría/marca/ubicación/empleado asignado) — los campos de hero/KPI/sección deben mostrar su placeholder "—" existente, no romper el resolver del blueprint.
5. La sección de campos personalizados no debe renderizarse cuando la categoría del activo tiene cero registros `InvCustomField` (igual al comportamiento hand-rolled actual).
6. Los widgets montados vía `componentRegistry` (`InventoryAssignmentPanel`, `InventoryCommentThread`, `AttachmentsPanel`, `ActivityTimeline`) deben recibir las mismas props que reciben hoy (id del item, contexto de companyId/token) aunque ahora se instancien a través del blueprint en vez de JSX directo.
7. Los flags nuevos de schema `showCompletion`/`preview` de `RunlyForm` deben quedar inactivos por defecto en cualquier blueprint que no los declare explícitamente, para que Fleet/HR/otros blueprints `FORM` existentes se rendericen exactamente igual que antes (sin anillo ni panel de vista previa donde no se pidió).
8. Mobile (390px): el anillo de progreso y el panel de vista previa deben colapsarse/ocultarse en vez de comprimir el formulario a un ancho inutilizable.

## 24. Risks

1. Riesgo: `RunlyForm.jsx` (1422 líneas), `RunlyDetail.jsx` (1108 líneas) y `RunlyTable.jsx` (1244 líneas) ya superan el límite blando de 1000 líneas del proyecto; agregar estilos glass y las dos funcionalidades opcionales nuevas podría acercarlas al límite duro de 1500. Mitigación: extraer el renderizado del "encabezado de sección con chip de ícono" a un componente compartido pequeño (ej. `packages/ui/src/components/SectionHeaderChip.jsx`) reutilizado por `RunlyForm` y `RunlyDetail` en vez de duplicar el estilo inline en cada uno; extraer el anillo de progreso y el panel de vista previa a sus propios componentes pequeños bajo `runly-renderer/`.
2. Riesgo: restilizar renderers compartidos que Fleet ya usa puede causar una regresión visual ahí. Mitigación: chequeo manual de las pantallas de listado/formulario/detalle de vehículos y conductores de Fleet en 390px y 1440px como parte de la verificación (sección 26), antes de dar por terminada esta funcionalidad.
3. Riesgo: montar `InventoryCustomFieldsForm`, `InventoryAssignmentPanel`, `InventoryCommentThread` y `AttachmentsPanel` vía `componentRegistry` en vez de JSX hand-rolled directo podría cambiar silenciosamente el cableado de props (ej. perder el contexto `Controller` de `react-hook-form` para los campos personalizados). Mitigación: verificar que cada widget embebido se comporte idéntico (misma validación, mismo guardado) tras la migración, comparando manualmente contra las pantallas hand-rolled actuales antes de eliminar los archivos viejos.
4. Riesgo: los nuevos traductores `inventory.item.*` podrían chocar con el enfoque de auditoría de una futura migración de `runly.inventory` a RME3. Mitigación: ninguna necesaria ahora — este es código Phase 1-2 y el mapa de traductores es aditivo/indexado por string de acción, así que una futura migración a RME3 puede simplemente mantener o reemplazar estas entradas de forma independiente.
5. Riesgo: los nuevos tipos de sección `"component"` (en `RunlyDetail`) y `"custom-fields"` (en `RunlyForm`) son capacidades genuinamente nuevas en renderers que ya usan Fleet y potencialmente otros módulos — no una reutilización de algo existente (corrección hecha en la sección 17 tras leer el código real). Mitigación: ambos tipos son aditivos y solo se activan cuando un blueprint declara explícitamente esa cadena de tipo; ningún blueprint existente (Fleet, HR, etc.) usa esas cadenas hoy, y el comportamiento por defecto de ambos renderers ante un tipo de sección desconocido ya es "no romper, renderizar vacío" — confirmado leyendo `normalizeSections` en ambos archivos antes de escribir el plan de implementación.

## 25. Acceptance criteria

1. Dado que la app de escritorio está corriendo, cuando un usuario abre `/app/m/runly.inventory/inventory/new`, entonces el formulario de alta se renderiza como un `RunlyForm` con secciones identificadas por ícono (sin números) con el lenguaje visual glass.
2. Dado un usuario con `inventory.item.read` que abre el detalle de un activo existente, entonces se renderiza como un `RunlyDetail` con hero (nombre/etiqueta/estado/imagen), un `StatStrip` de KPIs, y un layout de secciones de dos columnas.
3. Dado un activo que fue creado, editado, asignado y devuelto, cuando el usuario abre su pantalla de detalle, entonces el panel "Historial de auditoría" muestra cuatro entradas legibles en español en orden cronológico (no texto crudo de respaldo).
4. Dado que un usuario elimina un activo, cuando se consulta directamente su historial de auditoría, entonces existe una entrada `inventory.item.deleted` con una oración real en español.
5. Dada la pantalla de detalle de vehículos de Fleet (consumidor existente de `RunlyDetail`/`hero`/`kpis`), cuando se abre después de esta funcionalidad, entonces se renderiza con el nuevo estilo glass sin regresión de layout en 390px ni 1440px.
6. Dado cualquier otro blueprint `FORM` de otro módulo que no declare `schema.showCompletion`/`schema.preview`, cuando se renderiza su formulario, entonces no aparece ningún anillo de progreso ni panel de vista previa (confirmado apagado por defecto).
7. Dado el formulario de alta/edición de inventario en un viewport de 390px, cuando el anillo de progreso/panel de vista previa normalmente aparecerían, entonces se colapsan/ocultan en vez de comprimir los campos del formulario.
8. Dado que `InventoryCustomFieldsForm`/`InventoryAssignmentPanel`/`InventoryCommentThread`/`AttachmentsPanel` ahora se montan vía `componentRegistry`, cuando un usuario interactúa con cada uno (guarda un campo personalizado, asigna un activo, publica un comentario, sube un archivo), entonces el comportamiento es idéntico al de las pantallas hand-rolled previas al rediseño.

## 26. Verification plan

- `pnpm lint` — sin errores de lint nuevos.
- `pnpm build` — `apps/desktop` y `packages/ui` compilan sin errores.
- `node --check` sobre cada archivo `.js`/`.jsx` modificado en `apps/api` (los cambios de `activity-bridge.js`/`inventory-service.js`).
- Manual, con `pnpm dev` corriendo:
  - Formulario de alta/edición de inventario en 390px y 1440px — verificar estilo glass, encabezados de sección con ícono, comportamiento del anillo de progreso/panel de vista previa (aparece en desktop, se colapsa en mobile).
  - Pantalla de detalle de inventario en 390px y 1440px — verificar hero/KPIs/dos columnas, y que el nuevo panel de historial de auditoría muestre oraciones reales en español para un activo de prueba creado/editado/asignado/devuelto/eliminado.
  - Pantallas de detalle y formulario de vehículos de Fleet en 390px y 1440px — confirmar que no hay regresión visual por el restyle de los renderers compartidos.
  - Pantalla de detalle de empleado de HR (si también consume `RunlyDetail`) — mismo chequeo de regresión.
  - Checklist completo de 14 aspectos (`docs/ai-context/ui-screen-audit-checklist.md`) corrido contra las dos pantallas reconstruidas de inventario.

## 27. Rollback plan

No hay migración de Prisma involucrada, así que no hay rollback de esquema. Si se encuentra una regresión crítica visual o funcional:

- El restyle de los renderers compartidos puede revertirse de forma independiente (es un diff puro de CSS/JSX en `RunlyTable.jsx`/`RunlyForm.jsx`/`RunlyDetail.jsx`/`DetailHero.jsx`/`StatStrip.jsx`) vía `git revert` de ese commit, restaurando la apariencia previa de cada módulo consumidor de inmediato.
- La migración a blueprints de inventario puede revertirse de forma independiente restaurando desde git history las pantallas hand-rolled previas `InventoryItemForm.jsx`/`InventoryItemDetail.jsx`, ya que el registro de rutas en `ModuleOutlet.jsx` no cambia.
- Los traductores nuevos de `activity-bridge.js` y la nueva llamada de auditoría en `deleteItem()` son aditivos y retrocompatibles; revertirlos solo detiene la aparición de nuevas entradas traducidas (las filas existentes de `AuditLog` no se tocan en ningún caso — `AuditLog` es append-only en este codebase).

## 28. Future enhancements

1. Migrar `runly.inventory` completamente a RME3 (`defineRunlyModule`) — fuera de alcance aquí; esta funcionalidad lo mantiene en Phase 1-2.
2. Extender el mismo chequeo de verificación del restyle glass a cada otro módulo consumidor de `RunlyTable`/`RunlyForm`/`RunlyDetail` (Contactos, Finanzas, HR, Ledger, etc.) de forma individual, más allá del chequeo puntual de Fleet/HR hecho aquí.
3. Extender `MentionTextarea`/`CommentThread` con formato enriquecido básico (negrita/cursiva/listas) si surge una necesidad real de producto — deliberadamente no se intenta aquí porque no existe hoy ningún editor que ya combine menciones y formato.
4. Ofrecer `schema.showCompletion`/`schema.preview` a los formularios de alta/edición de otros módulos una vez probado el patrón en Inventario.
5. Agregar un modo de vista previa de QR/etiqueta reutilizando el nuevo panel `schema.preview` para el etiquetado físico de activos.
