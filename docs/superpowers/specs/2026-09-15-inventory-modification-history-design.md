# Historial de modificaciones (diffs por campo) en Actividad, con captura genérica en activity-bridge

Date: 2026-09-15
Status: Draft
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md
Plan file: docs/superpowers/plans/2026-09-15-inventory-modification-history.md (created after spec approval)

---

## 1. Feature title

Historial de modificaciones con diff por campo (valor anterior → valor nuevo) en la tarjeta "Actividad" del detalle de Inventario, sobre una capacidad genérica y reutilizable agregada a `activity-bridge.js`/`ActivityTimeline`.

## 2. Status

Draft

## 3. Context

El panel "Actividad" del detalle de Inventario (ver `docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md`, que lo reordenó y renombró) muestra oraciones genéricas como "Raúl actualizó el activo Asus TUF 15" para cada edición, sin indicar **qué** cambió. El dueño del producto pidió explícitamente poder ver un historial real de modificaciones — qué campo cambió y de qué valor a qué valor — no solo que "algo" cambió.

`AuditLog` (vía `activity-bridge.js`) ya tiene columnas `before`/`after` pensadas para esto, pero ningún servicio las usa con datos reales hoy: `inventory-service.js` (el único caso investigado en profundidad) solo envía `after: { fields: Object.keys(updateData), name }` — una lista de **nombres** de campos tocados, sin sus valores, y sin capturar nunca un snapshot "antes" del registro. El resto de servicios que llaman `bridge.logAndPublish` (HR, contactos, catálogo, etc.) tienen el mismo patrón de "hint" parcial, no snapshots completos.

## 4. Problem

No existe ninguna forma, en ningún módulo, de ver qué cambió exactamente en una edición — solo que una edición ocurrió. Construir esto una sola vez, de forma genérica en el bridge de actividad compartido, evita que cada módulo tenga que reinventar su propia lógica de diff cuando quiera la misma capacidad (Fleet y HR son candidatos obvios a futuro, ver sección 28), en línea con el patrón ya seguido en esta sesión de arreglar componentes compartidos en vez de duplicar por módulo.

## 5. Goals

1. `activity-bridge.js` gana una capacidad genérica: cuando un `logAndPublish` recibe **snapshots completos** de `before` y `after` (no solo hints parciales), calcula automáticamente qué campos cambiaron de valor y adjunta esa lista a `payload.changes` de la `Activity` publicada — sin que cada traductor tenga que implementar su propio diff.
2. `inventory-service.js` adopta esa capacidad: `updateItem` obtiene un snapshot "antes" del ítem (hoy no lo hace) y envía snapshots completos "antes"/"después" — construidos con la misma forma plana ya usada por `getItem()`/`listItems()` (`categoryName`, `brandName`, `locationName` en vez de los IDs crudos) — en vez del `{ fields, name }` actual.
3. `ActivityTimeline` (componente compartido) gana soporte genérico para expandir una entrada con `payload.changes`: un chevron revela una lista de filas "Etiqueta: valor anterior → valor nuevo", usando un mapa de etiquetas/formato que el consumidor le pasa (Inventario reutiliza las etiquetas ya declaradas en `inventory-item-detail.blueprint.js`, no una tabla nueva y duplicada).
4. Los campos de relación (`categoryId`/`brandId`/`locationId`) se muestran resueltos a nombre ("Categoría: Laptop → Desktop"), no como IDs crudos, reutilizando los mismos campos planos que la API de detalle ya calcula.
5. Los campos de texto largo/markdown (`notes`, `warrantyNotes`) se muestran truncados (antes/después, ~80 caracteres con elipsis), no en texto completo.
6. Una edición que solo toca campos cuyo valor no cambió realmente (el usuario reenvía el formulario sin cambios efectivos) no genera filas de diff vacías o falsas — el diff compara valores, no solo presencia en el payload de la petición.

## 6. Non-goals

1. No se adopta esta capacidad en Fleet, HR, ni ningún otro módulo en esta funcionalidad — solo se construye de forma genérica en `activity-bridge.js`/`ActivityTimeline` y se adopta en Inventario. Otros módulos quedan para trabajo futuro (ver sección 28).
2. No se diferencian cambios en campos personalizados (`InvCustomFieldValue`, por categoría) — el diff cubre los campos directos y de relación de `InvItem` únicamente. Los campos personalizados quedan fuera de alcance por la complejidad adicional de su modelo dinámico por categoría.
3. No se agrega ninguna acción de reversión/rollback ("deshacer este cambio") — esto es solo lectura/visualización del historial, no una herramienta de edición.
4. No se migran ni recalculan entradas de `AuditLog`/`Activity` existentes (creadas antes de esta funcionalidad) — esas seguirán mostrando el texto genérico sin chevron de expansión, ya que nunca tuvieron un `payload.changes` calculado.
5. No se construye un diff para las acciones `created`/`assigned`/`returned`/`deleted` de Inventario — el diff por campo aplica solo a `inventory.item.updated`, que es la única acción con una semántica real de "antes vs. después" de múltiples campos (las demás ya tienen su propia oración clara y específica).
6. No hay cambio de permisos — ver el diff requiere el mismo `inventory.item.read` que ya protege ver el detalle del ítem y su feed de actividad; no se expone nada que el usuario no pudiera ya ver en los valores actuales del ítem.

## 7. User stories

- Como usuario con `inventory.item.read`, quiero expandir una entrada "actualizó el activo" en Actividad y ver exactamente qué campos cambiaron y sus valores anterior/nuevo, para entender el historial del activo sin tener que preguntarle a quien hizo el cambio.
- Como desarrollador de otro módulo, quiero poder pasar snapshots completos `before`/`after` a `logAndPublish` y obtener automáticamente un diff calculado, para no tener que escribir mi propia lógica de comparación de campos cuando quiera esta misma capacidad.

## 8. UX requirements

- Todo texto de UI en español.
- Cada fila del diff expandido: `Etiqueta del campo: valor anterior → valor nuevo`, usando el mismo formato de valor que el detalle del ítem (fecha `DD/MM/YYYY`, moneda `Intl.NumberFormat('es-MX', {style:'currency'})`, etc.) — reutilizando, no reimplementando, el formateo existente donde sea práctico.
- Un valor anterior vacío/nulo se muestra como "—" (mismo placeholder que el resto del sistema), no como "null" o cadena vacía.
- El chevron de expansión solo aparece en entradas que tienen `payload.changes` con al menos un elemento — una entrada sin diff calculado (p. ej. de antes de esta funcionalidad) se ve exactamente igual que hoy, sin chevron.
- Responsivo: la lista expandida de cambios no debe producir overflow horizontal en 390px — cada fila se envuelve en varias líneas si el valor es largo, en vez de truncarse invisible o desbordar.
- Campos de texto largo (notas): mostrar `"primeros ~80 caracteres…" → "primeros ~80 caracteres…"`, sin intentar renderizar markdown dentro de la fila de diff.

## 9. Routes/screens

Sin rutas nuevas. Cambia el contenido/interacción de una sección ya existente:

| Route | Screen | Module | Description |
|---|---|---|---|
| `/app/m/runly.inventory/inventory/:id` | `InventoryItemDetail.jsx` → tarjeta "Actividad" | runly.inventory | Cada entrada de edición ahora es expandible para ver el diff por campo |

## 10. Data model

### New models

N/A

### Modified models

N/A — `AuditLog.before`/`AuditLog.after` y `Activity.payload` ya existen como columnas JSON (usadas hoy por `activity-bridge.js` de forma parcial); esta funcionalidad solo cambia qué se escribe en ellas, no el esquema.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

Sin endpoints nuevos. Se modifica el payload que `PUT /inventory/items/:id` (y su alias `PATCH`) ya escribe internamente en `AuditLog`/`Activity` — no hay cambio de request/response HTTP hacia el cliente. El cliente sigue leyendo el diff a través del endpoint ya existente que `ActivityTimeline` consume (`sdk.activity.listForEntity` → `GET /activity?entityType=InvItem&entityId=:id`), cuyo shape de respuesta gana un campo opcional `payload.changes` por entrada — aditivo, no rompe ningún consumidor que lo ignore.

## 13. SDK contract

N/A — no hay métodos nuevos en `@runly/sdk`. `sdk.activity.listForEntity` ya devuelve el objeto `Activity` completo, `payload` incluido.

## 14. Validator contract

N/A — no hay schemas Zod nuevos ni modificados; esta funcionalidad no cambia la validación de la petición `PUT/PATCH /inventory/items/:id`, solo qué se registra internamente después de que la petición ya fue validada.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A en el sentido de blueprints nuevos — se reutiliza el mapa de etiquetas de campo ya declarado en `inventory-item-detail.blueprint.js` (sección "Identificación", "Ubicación y compra", "Garantía", "Notas") como fuente de las etiquetas que `InventoryDetailHistorySection.jsx` le pasa a `ActivityTimeline`. Concretamente, se extrae ese mapa `{ field -> { label, type, options? } }` a una función reutilizable pequeña (p. ej. `buildFieldLabelMap(blueprint)` en un archivo de utilidades del módulo) para no duplicar las 15+ etiquetas ya escritas en el blueprint.

## 18. RBAC/permissions

Sin cambios. El diff se sirve a través del mismo endpoint `/activity` que ya está protegido por `inventory.item.read`:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `inventory.item.read` | GET item, GET /activity para InvItem (incluye ahora `payload.changes`) | Ya (sin cambio) |
| `inventory.item.update` | PUT/PATCH item (ahora también captura el snapshot "antes") | No |

## 19. Multi-company behavior

Sin cambios — el snapshot "antes" se obtiene con el mismo `prisma.invItem.findFirst({ where: { id, companyId, enabled: true } })` ya usado por el resto de `inventory-service.js`, aislado por `companyId` igual que toda otra consulta del servicio. El cálculo de diff en `activity-bridge.js` es puro (no consulta la base de datos), así que no introduce ninguna ruta de acceso cross-company nueva.

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

Cambia el payload interno de una acción ya existente, no se agrega ninguna acción nueva:

| Action key | Trigger | Payload (antes) | Payload (con esta funcionalidad) |
|---|---|---|---|
| `inventory.item.updated` | PUT/PATCH item | `after: { fields: [...], name }`, sin `before` | `before`: snapshot plano completo del ítem previo a la mutación (misma forma que `getItem()`); `after`: snapshot plano completo posterior; `activity-bridge.js` calcula `payload.changes` automáticamente a partir de ambos |

`computeFieldChanges(before, after)` (nueva función pura en `activity-bridge.js`, exportada para pruebas) excluye explícitamente: `id`, `companyId`, `createdAt`, `updatedAt`, `enabled` — nunca deben aparecer como "campo cambiado" en un diff visible al usuario.

## 23. Edge cases

1. Una edición que no cambia ningún valor real (el usuario reenvía el formulario sin tocar nada) — `computeFieldChanges` debe devolver un arreglo vacío; la entrada de Actividad se publica igual (comportamiento actual, sin cambios) pero sin chevron de expansión.
2. Un campo de relación cuyo valor anterior o nuevo es `null` (p. ej. el ítem no tenía marca y ahora sí) — se muestra `"—" → "Asus"`, no `"null" → "Asus"`.
3. Un campo de fecha (`purchaseDate`, `warrantyExpiry`) que cambia de `null` a una fecha real, o viceversa — mismo placeholder `"—"` que el resto del sistema, formateado `DD/MM/YYYY` cuando tiene valor.
4. Una entrada de Actividad creada antes de esta funcionalidad (sin `payload.changes`) — se renderiza exactamente como hoy, sin chevron, sin romper ni mostrar un estado de error.
5. Un campo de texto largo (`notes`) que cambia de vacío a un texto muy largo — se trunca a ~80 caracteres con elipsis tanto para "antes" (vacío → `"—"`) como para "después".
6. Dos ediciones concurrentes al mismo ítem (condición de carrera) — el snapshot "antes" de la segunda edición refleja lo que la primera edición ya escribió (lectura justo antes de la escritura, dentro del mismo request), consistente con el comportamiento de "último en escribir gana" que `updateItem` ya tiene hoy; esta funcionalidad no cambia esa semántica de concurrencia, solo la visibilidad del resultado.
7. Un campo booleano o enum (`status`, `itemType`) — el valor mostrado usa la misma etiqueta ya definida en las opciones del campo del blueprint (p. ej. `"Disponible" → "Asignado"`), no el valor crudo almacenado.

## 24. Risks

1. Riesgo: capturar un snapshot "antes" agrega una consulta extra (`findFirst`) a cada `PUT/PATCH /inventory/items/:id`. Mitigación: es una sola consulta indexada por `id` (clave primaria), costo despreciable frente a la consulta de actualización que ya se hace; no hay paralelismo ni N+1 involucrado.
2. Riesgo: `computeFieldChanges` podría marcar falsos positivos por diferencias de tipo/formato en vez de valor real (p. ej. un `Decimal` de Prisma vs. un `number`, o un objeto `Date` vs. una cadena ISO) entre `before` y `after` si no se normalizan antes de comparar. Mitigación: `computeFieldChanges` normaliza ambos lados a cadena antes de comparar (mismo criterio simple y predecible en todo el sistema), evitando lógica de comparación por tipo dispersa y difícil de mantener.
3. Riesgo: exponer nombres de campos técnicos si `InventoryDetailHistorySection.jsx` no logra mapear un campo del diff a una etiqueta del blueprint (p. ej. un campo nuevo agregado a `InvItem` en el futuro sin actualizar el blueprint). Mitigación: si no hay etiqueta, se usa el nombre de campo tal cual como respaldo (igual que el patrón ya existente en `normalizeSectionField` de `RunlyDetail.jsx`) — no se rompe el render, solo se ve menos pulido para ese campo específico hasta que se le agregue una etiqueta.
4. Riesgo: `ActivityTimeline` es un componente compartido (usado por cualquier módulo con un feed de actividad, no solo Inventario); agregarle la capacidad de expandir un diff podría alterar visualmente entradas de otros módulos que ya tengan (por casualidad) una clave `payload.changes` con otro significado. Mitigación: ningún traductor existente hoy escribe `payload.changes` (confirmado por búsqueda en el código antes de este spec); el chevron de expansión es estrictamente aditivo y solo aparece cuando esa clave específica existe y no está vacía.

## 25. Acceptance criteria

1. Dado un ítem de inventario con al menos un campo directo modificado (p. ej. precio de compra), cuando se abre su detalle y se expande la entrada "actualizó el activo" en Actividad, entonces se muestra una fila "Precio de compra: $25,000.00 → $28,500.00".
2. Dado un ítem cuya categoría cambió, cuando se expande la entrada correspondiente, entonces se muestra "Categoría: Laptop → Desktop" (nombres resueltos), no IDs crudos.
3. Dado un ítem cuyas notas cambiaron de un texto largo a otro, cuando se expande la entrada, entonces ambos valores se muestran truncados a ~80 caracteres con elipsis.
4. Dado que un usuario reenvía el formulario de edición sin cambiar ningún valor, cuando se publica la actividad correspondiente, entonces esa entrada no tiene chevron de expansión (no hay `payload.changes`).
5. Dada una entrada de Actividad creada antes de esta funcionalidad (sin `payload.changes`), cuando se visualiza en el feed, entonces se ve exactamente igual que hoy, sin chevron ni error.
6. Dado el mismo cambio de flujo en un viewport de 390px, cuando se expande una entrada con varios campos cambiados, entonces no hay overflow horizontal.

## 26. Verification plan

- `node --test apps/api/src/services/__tests__/` — incluye pruebas nuevas para `computeFieldChanges` (casos: sin cambios, cambio de campo simple, cambio de relación con nombres, valores nulos, campos excluidos).
- `pnpm lint` — sin errores nuevos.
- `pnpm build` — `apps/api`, `apps/desktop`, `packages/ui` compilan sin errores.
- Manual, con `pnpm dev` corriendo: editar un activo de inventario cambiando precio, categoría y notas en una sola edición; abrir su detalle; expandir la entrada de Actividad correspondiente; confirmar las tres filas de diff con el formato esperado (moneda, nombre de categoría, texto truncado). Repetir en 390px.

## 27. Rollback plan

No hay migración de Prisma involucrada. Si se encuentra una regresión:

- El cambio en `activity-bridge.js` (`computeFieldChanges` + su integración en `publishFromAudit`) es aditivo y puede revertirse con `git revert` sin afectar ninguna entrada de `AuditLog`/`Activity` ya escrita (son append-only en este codebase).
- El cambio en `inventory-service.js` (capturar snapshot "antes", enviar snapshots completos) puede revertirse independientemente, volviendo al payload `{ fields, name }` actual — las entradas de Actividad futuras simplemente dejarían de tener `payload.changes`, sin romper nada.
- El cambio en `ActivityTimeline`/`InventoryDetailHistorySection.jsx` (chevron de expansión) puede revertirse de forma independiente; sin él, las entradas con `payload.changes` simplemente no serían expandibles (degradación segura, no un error).

## 28. Future enhancements

1. Adoptar esta misma capacidad en Fleet (vehículos/conductores/seguros) y HR (empleados) una vez migrado a blueprints — cada uno solo necesita capturar un snapshot "antes" y pasar snapshots completos a `logAndPublish`, la capacidad de diff/expansión ya sería genérica.
2. Extender el diff a campos personalizados (`InvCustomFieldValue`) por categoría, una vez resuelto cómo mapear su `fieldId` dinámico a una etiqueta legible de forma genérica.
3. Permitir expandir/ver el texto completo de un campo largo truncado (p. ej. un botón "ver completo" dentro de la fila de diff) en vez de solo mostrar el texto recortado.
4. Filtro/búsqueda dentro del feed de Actividad por tipo de cambio (solo ediciones, solo asignaciones, etc.).
