# Rediseño de Inventario — pase de acabado: layout del formulario, acciones y jerarquía visual del detalle

Date: 2026-09-15
Status: Draft
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md
Plan file: docs/superpowers/plans/2026-09-15-inventory-redesign-followup.md (created after spec approval)

---

## 1. Feature title

Pase de acabado sobre el rediseño glass de `runly.inventory` y sus renderers compartidos (`RunlyForm`/`RunlyDetail`): consolidación del sidebar del formulario a dos columnas, una barra de acciones primaria+overflow para el detalle, reordenamiento del sidebar de detalle, y refuerzo visual (acento + tipografía) de las tarjetas de sección.

## 2. Status

Draft

## 3. Context

El spec `docs/superpowers/specs/2026-09-14-inventory-glass-redesign-design.md` migró las pantallas de alta/edición y detalle de `runly.inventory` de JSX hand-rolled a blueprints sobre `RunlyForm`/`RunlyDetail`, con `schema.hero`, `schema.kpis`, `layout: "two-column"`, historial de auditoría real y los flags opcionales `schema.showCompletion`/`schema.preview`. Ese trabajo ya está implementado (commits hasta `0a644660`, incluyendo un ajuste posterior que movió el anillo de "ficha completada" a un sidebar propio).

El dueño del producto revisó el resultado en vivo (capturas de pantalla de las tres vistas: alta/edición, detalle, historial) y encontró cuatro problemas de layout/jerarquía visual que el spec anterior no cubrió, más una imagen de referencia (un diseño externo con tarjetas "Información general" con acento morado a la izquierda, un `StatStrip` fusionado bajo el hero, y un sidebar compacto de Asignación/Actividad/Comentarios) que describe la dirección visual deseada. Esta funcionalidad es ese pase de acabado.

Durante la discusión previa a este spec también se investigaron y corrigieron en el momento (sin necesidad de spec, por no ser features nuevas sino bugs sobre código ya escrito) dos defectos reales: el subtítulo del hero de `RunlyDetail` mostraba el valor crudo de un campo `select` (`"equipment"`) en vez de su etiqueta (`"Equipo / Maquinaria"`), y `canManageCover` en `useAttachmentsController` no exigía `canWrite`, por lo que los controles de portada/reordenar podían aparecer en vistas de solo lectura. Ambos ya están corregidos y no forman parte del alcance de este spec — se documentan aquí solo como contexto.

## 4. Problem

Cuatro problemas de layout/jerarquía visual persisten después del spec anterior:

1. **Formulario de alta/edición**: el sidebar derecho se ve como tres columnas en vez de dos. `InventoryItemForm.jsx` envuelve `RunlyForm` en su propio grid con su propio `aside` (anillo "Ficha completada" + botones "Ver activo"/"Eliminar activo"), pero `RunlyForm` internamente vuelve a dividir SU columna principal en campos + su propia columna `aside` (la tarjeta "Vista previa", vía `schema.preview`). El resultado visual es formulario | vista previa | ficha completada+botones — tres columnas — en vez de formulario | sidebar único (ficha completada+botones arriba, vista previa abajo).
2. **Botones de acción del detalle**: `InventoryItemDetail.jsx` renderiza "Volver"/"Editar"/"Eliminar" como tres botones `outline`/`size="sm"` del mismo peso visual, dificultando distinguir la acción principal (Editar) de una destructiva (Eliminar) y hacićndolos poco visibles.
3. **Orden del sidebar de detalle**: hoy el orden de secciones `aside` en `inventory-item-detail.blueprint.js` es Archivos → Asignación → Comentarios → Historial de auditoría. La imagen de referencia del producto pone Asignación y un feed de Actividad (equivalente al historial de auditoría) mucho más cerca de la parte superior del sidebar, con Comentarios después — hoy Asignación queda debajo de un bloque de Archivos potencialmente largo, lejos del alcance visual inmediato.
4. **Jerarquía visual de las tarjetas de sección**: las tarjetas `glass-shell` de `RunlyDetail` (Identificación, Ubicación y compra, Garantía, etc.) no tienen ningún acento que las distinga entre sí ni ancle la vista al pasar de una a otra, y el valor de cada campo (`dd`) tiene el mismo peso tipográfico que texto secundario en vez de leerse como el dato principal — la imagen de referencia del producto usa un borde/resplandor de acento a la izquierda de la tarjeta y un contraste label/valor más marcado (etiqueta pequeña/mayúscula/tenue, valor en negrita).

## 5. Goals

1. El formulario de alta/edición de inventario (`InventoryItemForm.jsx`) se ve como dos columnas: campos del formulario a la izquierda, un único sidebar sticky a la derecha con, en este orden, el anillo "Ficha completada", los botones "Ver activo"/"Eliminar activo", y la tarjeta "Vista previa".
2. Esa consolidación se implementa como una capacidad genérica de `RunlyForm` (un nuevo prop `asideActions`), no como un hack local a Inventario, de modo que cualquier otro blueprint `FORM` que combine `schema.showCompletion`/`schema.preview` con botones de acción del host hereda automáticamente un único sidebar.
3. El detalle de inventario (y cualquier otra pantalla que adopte el nuevo componente) muestra un botón primario "Editar" y un menú "···" con las acciones secundarias/destructivas (Volver, Eliminar), vía un nuevo componente compartido `DetailActionBar` en `@runly/ui`.
4. El sidebar del detalle de inventario queda ordenado Archivos → Asignación → Actividad → Comentarios (renombrando la etiqueta de sección "Historial de auditoría" a "Actividad"), sin fusionar comentarios e historial en un solo feed — siguen siendo tarjetas separadas.
5. Las tarjetas de sección de `RunlyDetail` (compartido, no solo Inventario) tienen un borde/resplandor de acento a la izquierda usando el color de marca (`hsl(var(--primary))`), y el valor de cada campo (`dd`) usa `font-semibold` en vez de peso normal, acercando la jerarquía visual a la imagen de referencia sin introducir un nuevo color de marca.
6. No hay regresión visual en Fleet/HR ni en ningún otro consumidor actual de `RunlyForm`/`RunlyDetail` (verificado manualmente en 390px y 1440px), dado que todos los cambios son aditivos/opt-in o afectan un elemento (acento de tarjeta + peso del valor) que ya es parte del lenguaje visual compartido y por tanto se espera que se propague — ver sección 24, riesgo 2.

## 6. Non-goals

1. No se rediseña el `StatStrip`/`DetailHero` fusionados (ya se hizo en el spec anterior, commit `236f549f`) — esta funcionalidad no los toca salvo por el fix de subtítulo de campo `select` ya aplicado fuera de alcance de este spec.
2. No se fusionan Comentarios e Historial de auditoría en un solo feed cronológico — se confirmó explícitamente con el dueño del producto que la imagen de referencia muestra tarjetas separadas, no un feed combinado.
3. No se migra `runly.inventory` a RME3 — sigue siendo Phase 1-2, igual que el spec anterior.
4. No se agregan acciones nuevas al detalle de inventario (exportar, duplicar, etc.) — `DetailActionBar` solo reorganiza las tres acciones que ya existen (Volver, Editar, Eliminar).
5. No se investiga ni corrige el "destello" ocasional reportado en encabezados de tarjeta más allá de lo que el nuevo acento visual (meta 5) ya cubre por diseño — no se pudo reproducir una causa concreta durante la discusión previa a este spec, y el dueño del producto aceptó que el nuevo tratamiento visual sea la respuesta en vez de una investigación de causa raíz separada.
6. No se adopta `DetailActionBar` en otros módulos (Fleet, HR, etc.) dentro de esta funcionalidad — se construye como pieza reutilizable, pero solo Inventario la adopta aquí (ver sección 28).
7. No se cambian los datos/campos que expone el hero de Inventario (`titleField`, `subtitleFields`, `metaChips`, KPIs) — ya están correctos tras el fix de campos `select` aplicado antes de este spec.

## 7. User stories

- Como usuario con `inventory.item.create`/`inventory.item.update`, quiero ver el formulario de alta/edición en dos columnas claras (campos | sidebar de progreso+acciones+vista previa) en vez de tres columnas apretadas, para completar el formulario sin distracción visual.
- Como usuario con `inventory.item.read`, quiero que el botón "Editar" del detalle sea evidente de un vistazo y que "Eliminar" no compita visualmente con él, para no dudar sobre cuál es la acción principal.
- Como usuario con `inventory.item.read`, quiero ver quién tiene asignado el activo y su actividad reciente cerca de la parte superior del sidebar, sin tener que bajar más allá de la sección de archivos, para entender el estado del activo más rápido.
- Como desarrollador de otro módulo que ya usa `RunlyForm`/`RunlyDetail`, quiero que el sidebar consolidado del formulario y el acento de tarjeta del detalle se apliquen automáticamente a mis pantallas, para no reimplementar el mismo ajuste de layout módulo por módulo.

## 8. UX requirements

- Todo texto de UI en español; la única etiqueta que cambia de texto es "Historial de auditoría" → "Actividad" en el sidebar de detalle de Inventario (el componente `InventoryDetailHistorySection.jsx` sigue usando `ActivityTimeline` sin cambios de comportamiento, solo cambia el título visible de la tarjeta y su posición en el blueprint).
- Responsivo obligatorio en 390px y 1440px:
  - El sidebar consolidado del formulario (ficha completada + botones + vista previa) se apila en una sola columna en mobile, en el mismo punto de quiebre que ya usa `RunlyForm` para su `aside` (`xl:`), sin cambios de breakpoint.
  - `DetailActionBar` en mobile: el botón primario "Editar" se mantiene visible; el menú "···" se mantiene como trigger de `DropdownMenu` (ya es táctil-friendly, sin cambios adicionales).
  - El reordenamiento del sidebar de detalle no introduce scroll horizontal ni comprime las tarjetas por debajo de un ancho usable en 390px (se mantiene la columna única existente en mobile del layout `two-column` de `RunlyDetail`).
- Ninguna confirmación destructiva cambia de mecanismo — "Eliminar" dentro de `DetailActionBar` sigue abriendo el mismo `ConfirmDialog` que ya existe en `InventoryItemDetail.jsx`, ahora disparado desde una entrada del menú "···" en vez de un botón directo.
- El acento de tarjeta (borde/resplandor izquierdo) y el `font-semibold` de los valores de campo se aplican a **todas** las tarjetas de sección `type: "fields"` que renderiza `RunlyDetail`, no solo a las de Inventario — es un cambio en el renderer compartido.

## 9. Routes/screens

Sin rutas nuevas ni cambios de path — mismas tres rutas que el spec anterior, solo cambia el layout interno de los componentes ya migrados a blueprint:

| Route | Screen | Module | Description |
|---|---|---|---|
| `/app/m/runly.inventory/inventory/new` | `InventoryItemForm.jsx` | runly.inventory | Alta de activo — sidebar consolidado a una columna |
| `/app/m/runly.inventory/inventory/:id/edit` | `InventoryItemForm.jsx` | runly.inventory | Edición de activo — mismo layout que alta |
| `/app/m/runly.inventory/inventory/:id` | `InventoryItemDetail.jsx` | runly.inventory | Detalle de activo — `DetailActionBar` + sidebar reordenado |

## 10. Data model

### New models

N/A

### Modified models

N/A — no hay cambios de campos/esquema. Esta funcionalidad es puramente de presentación (layout, componente de acciones, orden de secciones de blueprint, estilos de tarjeta).

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

N/A — no hay endpoints nuevos ni modificados. Toda la funcionalidad consume datos ya devueltos por `GET /inventory/items/:id` (sin cambios desde el spec anterior).

## 13. SDK contract

N/A — no hay métodos nuevos ni modificados en `@runly/sdk`.

## 14. Validator contract

N/A — no hay schemas Zod nuevos ni modificados.

## 15. Module manifest impact

N/A — el manifest de `runly.inventory` no cambia. No hay permisos, dependencias ni entradas de navegación nuevas.

## 16. Navigation impact

N/A — no hay cambios de navegación.

## 17. Blueprint impact

Se modifica un blueprint module-local existente, sin agregar tipos de sección nuevos (los tipos `fields`/`attachments`/`component` que usa `inventory-item-detail.blueprint.js` ya existen desde el spec anterior):

- **`inventory.item.detail`** (`apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-detail.blueprint.js`): se reordena el arreglo `sections` para que las entradas `column: 'aside'` queden en el orden Archivos → Asignación → Actividad → Comentarios (hoy: Archivos → Asignación → Comentarios → Historial de auditoría). La entrada de historial cambia su `label` de `'Historial de auditoría'` a `'Actividad'`; su `component: 'runly.inventory:HistorySection'` no cambia.
- **`inventory.item.form`** (`apps/desktop/src/modules/runly.inventory/blueprints/inventory-item-form.blueprint.js`): `schema.showCompletion` pasa de `false` a `true` (hoy el anillo se renderiza manualmente fuera de `RunlyForm`; con el nuevo sidebar consolidado, `RunlyForm` lo renderiza internamente).

Ningún otro blueprint (Fleet, HR) usa `schema.showCompletion`/`schema.preview` hoy, así que el cambio de comportamiento de `RunlyForm` (ver sección 24, riesgo 3) no los afecta.

## 18. RBAC/permissions

Sin cambios. Las claves existentes siguen protegiendo las mismas operaciones:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `inventory.item.read` | GET item | Sí (sin cambio) |
| `inventory.item.create` | POST item | No |
| `inventory.item.update` | PUT/PATCH item | No |
| `inventory.item.delete` | DELETE item | No |

## 19. Multi-company behavior

Sin cambios — esta funcionalidad no introduce ninguna consulta ni endpoint nuevo; todo el aislamiento por `companyId` ya existente en los endpoints reutilizados sigue aplicando sin modificación.

## 20. Files/storage impact

N/A — no se toca `AttachmentsPanel`/`FileUploader` ni su comportamiento de almacenamiento en esta funcionalidad (los fixes de `canManageCover` y del subtítulo del hero ya se aplicaron antes de este spec, fuera de su alcance).

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A — no se agregan ni modifican acciones de `AuditLog`. El renombrado de la etiqueta visible "Historial de auditoría" → "Actividad" es puramente de presentación; el `type`/`action` almacenado (`inventory.item.created`, etc.) no cambia.

## 23. Edge cases

1. Un activo sin ninguna asignación activa, sin comentarios y sin historial de auditoría (dato sembrado antes del spec anterior) — el sidebar reordenado debe mostrar las tres tarjetas (Asignación/Actividad/Comentarios) en su estado vacío existente, no ocultarlas ni romper el orden.
2. El formulario de alta (sin `id` todavía) no muestra los botones "Ver activo"/"Eliminar activo" (ya es así hoy, condicionado a `isEdit && editItem?.id`) — el nuevo prop `asideActions` de `RunlyForm` debe tolerar recibir `null`/`undefined` en modo alta sin dejar un hueco vacío con espaciado extraño en el sidebar.
3. Un blueprint `FORM` que declare `schema.preview` pero NO `schema.showCompletion` (o viceversa) — el sidebar consolidado de `RunlyForm` debe renderizar solo las piezas presentes (ring y/o preview y/o `asideActions`) sin dejar espacios en blanco entre ellas.
4. `DetailActionBar` sin acción "Eliminar" disponible (un futuro consumidor sin permiso de borrado) — el menú "···" debe ocultarse por completo si no queda ninguna acción secundaria que mostrar, en vez de abrir un menú vacío.
5. Viewport 390px en el detalle: el borde/resplandor de acento de las tarjetas de sección no debe generar overflow horizontal ni recortarse de forma que se vea como una línea cortada a mitad de tarjeta.

## 24. Risks

1. Riesgo: cambiar el layout interno de `RunlyForm` (mover el anillo de completado y agregar un prop `asideActions`) es un cambio de comportamiento en un renderer compartido, aunque hoy solo Inventario declara `schema.showCompletion`/`schema.preview`. Mitigación: confirmado por grep antes de este spec que ningún otro blueprint del repo usa esas dos claves de schema hoy — el cambio de placement del anillo (de "arriba de todo el grid" a "dentro de la columna aside") es seguro porque no hay ningún consumidor actual en el otro camino de código.
2. Riesgo: el acento de tarjeta + `font-semibold` en valores de campo es un cambio visual en `RunlyDetail`, compartido con Fleet/HR y cualquier otro consumidor de secciones `type: "fields"`. Mitigación: verificación manual de las pantallas de detalle de vehículos/conductores de Fleet (y de empleado en HR si aplica) en 390px y 1440px tras el cambio, igual que se hizo para el spec anterior — es un refuerzo del mismo lenguaje visual glass ya adoptado, no una paleta nueva.
3. Riesgo: `RunlyForm.jsx` y `RunlyDetail.jsx` ya están cerca del límite blando de 1000 líneas del proyecto (ver spec anterior, riesgo 1). Mitigación: el nuevo componente `DetailActionBar` vive en su propio archivo (`packages/ui/src/components/DetailActionBar.jsx`), no agrega líneas a `RunlyDetail.jsx`; el prop `asideActions` de `RunlyForm` es una adición pequeña (unas pocas líneas de JSX condicional), no una reestructuración.
4. Riesgo: mover "Eliminar" detrás de un menú "···" reduce en un clic la accesibilidad de esa acción (antes era un botón directo). Mitigación: es una decisión de producto explícita del dueño del producto (acción destructiva no debe competir visualmente con la acción principal) — el `ConfirmDialog` existente sigue siendo la única forma de confirmar el borrado, así que no se reduce la seguridad, solo la prominencia visual del punto de entrada.

## 25. Acceptance criteria

1. Dado el formulario de edición de un activo existente en un viewport de 1440px, cuando se renderiza, entonces el sidebar derecho muestra en una sola columna, de arriba a abajo: anillo "Ficha completada", botones "Ver activo"/"Eliminar activo", tarjeta "Vista previa" — sin una tercera columna separada.
2. Dado el mismo formulario en modo alta (sin `id`), cuando se renderiza, entonces el sidebar muestra el anillo y la vista previa sin los botones "Ver activo"/"Eliminar activo" (no aplican todavía) y sin espacios en blanco donde irían.
3. Dado el detalle de un activo, cuando se renderiza, entonces se ve un botón primario "Editar" y un trigger "···" que, al abrirse, muestra "Volver" y "Eliminar" como entradas de menú.
4. Dado que un usuario hace clic en "Eliminar" dentro del menú "···", cuando confirma en el `ConfirmDialog`, entonces el activo se elimina exactamente igual que hoy (mismo endpoint, mismo comportamiento).
5. Dado el detalle de un activo con asignación, comentarios e historial, cuando se renderiza, entonces el sidebar muestra las tarjetas en el orden Archivos, Asignación, Actividad, Comentarios — y la tarjeta de historial se titula "Actividad", no "Historial de auditoría".
6. Dado cualquier tarjeta de sección `type: "fields"` en `RunlyDetail` (Inventario, Fleet u otro módulo), cuando se renderiza, entonces tiene un borde/resplandor de acento a la izquierda en el color de marca y cada valor de campo se muestra en `font-semibold`.
7. Dada la pantalla de detalle de vehículos de Fleet, cuando se abre después de esta funcionalidad, entonces no hay regresión de layout en 390px ni 1440px más allá del acento/peso de fuente esperado (meta 6).

## 26. Verification plan

- `pnpm lint` — sin errores de lint nuevos.
- `pnpm build` — `apps/desktop` y `packages/ui` compilan sin errores.
- `node --test packages/ui/src/runly-renderer/__tests__/` y `node --test packages/ui/src/hooks/__tests__/` — suites existentes siguen en verde.
- Manual, con `pnpm dev` corriendo:
  - Formulario de alta/edición de inventario en 390px y 1440px — confirmar sidebar de una sola columna (ring+botones+preview) en ambos modos (alta y edición).
  - Detalle de inventario en 390px y 1440px — confirmar `DetailActionBar` (Editar primario + menú "···" con Volver/Eliminar) y el nuevo orden del sidebar (Archivos, Asignación, Actividad, Comentarios).
  - Confirmar visualmente el acento de tarjeta + `font-semibold` de valores en al menos dos tarjetas de sección del detalle de Inventario.
  - Regresión: detalle y formulario de vehículos/conductores de Fleet en 390px y 1440px (mismo checklist que el spec anterior, sección 26).
  - Checklist de 14 aspectos (`docs/ai-context/ui-screen-audit-checklist.md`) sobre las dos pantallas de Inventario afectadas.

## 27. Rollback plan

No hay migración de Prisma involucrada. Si se encuentra una regresión:

- El prop `asideActions` de `RunlyForm` y el reordenamiento del blueprint de Inventario pueden revertirse de forma independiente vía `git revert` del commit correspondiente, sin afectar ningún otro módulo (ningún otro consumidor usa `schema.showCompletion`/`schema.preview` hoy).
- `DetailActionBar` es un componente nuevo y aditivo — revertir su adopción en `InventoryItemDetail.jsx` (volviendo a los tres botones `outline` inline) no requiere tocar el componente compartido en sí.
- El acento de tarjeta + `font-semibold` en `RunlyDetail` es un diff de CSS/JSX puro, revertible con `git revert` sin impacto de datos.

## 28. Future enhancements

1. Adoptar `DetailActionBar` en las pantallas de detalle de Fleet, HR y cualquier otro módulo que hoy arme sus propios botones "Volver/Editar/Eliminar" inline.
2. Ofrecer `schema.showCompletion`/`schema.preview` (y por tanto el sidebar consolidado de `RunlyForm`) a los formularios de alta/edición de otros módulos, una vez probado en Inventario.
3. Investigar con una repetición reproducible el "destello" ocasional reportado en encabezados de tarjeta, si el nuevo acento visual no resuelve la percepción del problema en la práctica.
4. Extender el acento de tarjeta de `RunlyDetail` para usar `schema.hero.accentColorField` (color por registro) en vez del color de marca fijo, para módulos donde eso tenga sentido (ej. color de vehículo en Fleet) — descartado en este spec a favor de mantener consistencia con el sistema de diseño existente (ver decisión del dueño del producto en la sección de accent color).
