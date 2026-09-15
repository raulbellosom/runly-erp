# Mejora de componentes compartidos: calendario, combobox, visor de archivos y columna de imagen en tablas

Date: 2026-09-14
Status: Draft
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-14-shared-form-components-upgrade-design.md
Plan files: docs/superpowers/plans/2026-09-14-shared-form-components-upgrade-a-backend.md (API/Prisma), docs/superpowers/plans/2026-09-14-shared-form-components-upgrade-b-frontend.md (UI) — creados después de aprobar este spec

---

## 1. Feature title

Mejora de cuatro componentes compartidos de `@runly/ui` usados en todo el ERP: navegación rápida del selector de fecha, unificación del combobox con buscador, consolidación del visor de archivos, y columna de imagen reusable en `RunlyTable` (con foto de portada seleccionable para activos de inventario).

## 2. Status

Draft

## 3. Context

Durante el rediseño glass de Inventario (spec `2026-09-14-inventory-glass-redesign-design.md`, ya implementado) el usuario probó las pantallas nuevas y encontró que varios componentes de `@runly/ui` reusados por `RunlyForm`/`RunlyDetail`/`RunlyTable` — no solo el estilo visual que ya se corrigió — tienen problemas reales de usabilidad y arquitectura: el selector de fecha no permite saltar a un año lejano, el combobox con buscador se ve "delgado" y no glass, y no hay una forma reusable de mostrar/abrir imágenes desde una tabla. Una investigación de código confirmó que estos problemas son reales y, en el caso del visor de archivos, que existen tres implementaciones paralelas sin consolidar.

## 4. Problem

Cuatro problemas concretos, cada uno en un componente compartido usado por múltiples módulos (no solo Inventario):

1. **Selector de fecha** (`packages/ui/src/components/date-picker-shared.jsx`): solo tiene flechas de mes anterior/siguiente. Para llegar a una fecha con más de uno o dos años de diferencia hay que hacer decenas de clics.
2. **Combobox con buscador** (`ComboboxField`/`RelationSelectField`/`CreatableComboboxField` en `packages/ui/src/components/FormFields.jsx`): las tres son copias casi idénticas (~150 líneas cada una) del mismo patrón de popover, no usan el estilo glass del resto del sistema, y el autofocus del buscador depende de un `setTimeout(..., 50)` que no es confiable.
3. **Visor de archivos**: existen tres componentes distintos con superposición de funciones (`ImageViewer` sin navegación, `FileViewer` con navegación pero básico, `AdvancedFileViewer` el más completo pero ubicado incorrectamente dentro de `runly.files` aunque ya lo usan Identity/HR/Chat). Además, `AttachmentsPanel` no separa imágenes/video de documentos por defecto, y no hay ningún campo de "foto de portada" para activos de inventario.
4. **Columna de imagen en tablas** (`RunlyTable`): existe un `type: "image"` genérico pero "tonto" (necesita una URL ya resuelta, sin clic para ver) y una versión completa pero no reusable (bespoke por módulo, ej. `VehicleImageCell` de Fleet). No hay una forma genérica de declarar "esta tabla tiene una columna de imagen que resuelve su propia URL firmada y abre el visor al hacer clic".

## 5. Goals

1. El selector de fecha (`Calendar`/`DateSelectorShell`) soporta navegación tipo iOS: al tocar el mes se pasa a una vista de cuadrícula de meses del año actual; al tocar el año se pasa a una vista de cuadrícula de años (paginada de a 12); seleccionar un año lleva a la vista de meses de ese año, y seleccionar un mes lleva a la vista de días de ese mes/año.
2. `ComboboxField`, `RelationSelectField` y `CreatableComboboxField` comparten una sola implementación base del popover (posicionamiento, clic-afuera, autofocus confiable, contenedor con `glass-shell`), sin perder ninguna de sus funciones actuales (badges/subtítulos, crear en línea, estados de carga/error/reintentar).
3. `AdvancedFileViewer` (junto con sus dependencias `PDFViewer`/`FileVisual`/`file-kind`) se reubica en `packages/ui` como el visor único con navegación secuencial (siguiente/anterior) del sistema; `AttachmentsPanel` lo usa en vez de `FileViewer`. `FileViewer`/`ImageViewer` quedan marcados como obsoletos (no se borran ni se tocan sus consumidores actuales).
4. `AttachmentsPanel` separa por defecto (en modo formulario y en modo detalle) los archivos en dos grupos: "Multimedia" (imágenes y video — se agrega el tipo `video` que hoy falta en la detección) y "Documentos" (todo lo demás).
5. Los activos de inventario (`InvItem`) tienen una foto de portada calculada (la primera imagen subida) con la posibilidad de que el usuario la cambie explícitamente marcando otra imagen como portada o reordenando sus archivos adjuntos.
6. Existe un tipo de columna nuevo y genérico en `RunlyTable`, `type: "image-asset"`, que resuelve una URL firmada a partir de un `fileAssetId` y abre `AdvancedFileViewer` (con navegación secuencial cuando hay más de un archivo) al hacer clic — sin necesitar un componente bespoke por módulo.
7. Las tablas de Inventario y de RH (Recursos Humanos) declaran explícitamente esa columna nueva como primera columna, mostrando la foto de portada del activo / la foto del colaborador respectivamente.

## 6. Non-goals

1. No se tocan `MiniCalendar.jsx` (`runly.calendar`) ni las vistas de mes/semana/día de ese módulo — son implementaciones de calendario independientes y de alcance distinto (una app de calendario, no un selector de fecha de formulario); queda como mejora futura unificarlas.
2. No se reemplazan los consumidores actuales de `FileViewer`/`ImageViewer` (`ImageUploader`, `ChannelGeneralTab`, `VehicleImageCell`, `DriverAvatarCell`, `CompanyBranding`) — siguen funcionando exactamente igual; solo `AttachmentsPanel` migra a `AdvancedFileViewer` en esta funcionalidad.
3. No se agrega la columna `image-asset` automáticamente a ningún otro módulo (Contactos, Flota, Finanzas, etc.) — solo a Inventario y RH, que fue lo pedido explícitamente. `RunlyTable` no "detecta sola" columnas de imagen.
4. No se cambia el campo de foto/avatar que ya usa `HrEmployeeDetail.jsx` hoy (`profileImageFileId` con fallback a `userProfile.avatarFileId`) — la columna nueva de la tabla de RH reutiliza esa misma precedencia ya establecida, no se decide una nueva.
5. No se construye una selección de fecha por "rueda" (wheel picker) nativa de iOS — se usa cuadrícula de meses/años, que resuelve el mismo problema (llegar rápido a una fecha lejana) con el mismo mecanismo de vistas que `RunlyForm`/`RunlyDetail` ya usan en todos lados (una cuadrícula clickeable), sin introducir un patrón de interacción nuevo (gestos de scroll con snap) al sistema.
6. No se migra `ImageUploader.jsx`/`ChannelGeneralTab.jsx`/`CompanyBranding.jsx` de `ImageViewer` a `AdvancedFileViewer` — quedan como están (ver non-goal 2).

## 7. User stories

- Como usuario llenando la fecha de compra o garantía de un activo con más de un año de antigüedad, quiero saltar directo al año/mes en vez de darle clic a "anterior" decenas de veces.
- Como usuario buscando una categoría/marca/ubicación en un combobox, quiero que se vea consistente con el resto del sistema (glass) y que el buscador tenga el foco listo para escribir apenas se abre.
- Como usuario viendo los archivos de un activo, quiero ver las fotos/videos separados de los documentos, y poder pasar de una imagen a la siguiente sin cerrar el visor.
- Como usuario dando de alta un activo con varias fotos, quiero elegir cuál aparece como portada en el listado.
- Como usuario viendo el listado de inventario o de colaboradores, quiero ver de un vistazo la foto de cada fila, y poder ampliarla con un clic.

## 8. UX requirements

- Todo texto de UI en español.
- El selector de fecha: el encabezado (mes y año) deja de ser texto plano y se vuelve dos elementos clickeables independientes; hay flechas de navegación en cada vista (mes↔mes en vista de días, año↔año en vista de meses, página de 12 años↔página de 12 años en vista de años). Responsivo en el `Sheet` móvil existente igual que hoy.
- Combobox: el contenedor del popover usa `glass-shell`; el buscador recibe el foco automáticamente al abrir, de forma confiable (sin carreras de `setTimeout`), en desktop y mobile.
- `AttachmentsPanel` agrupado (Multimedia/Documentos) es el modo por defecto tanto en `context="form"` como en `context="detail"`; el toggle de vista lista/cuadrícula existente se mantiene disponible dentro de cada grupo.
- El visor de archivos abierto desde cualquier punto (adjuntos, columna de imagen de tabla) permite navegar con flechas izquierda/derecha (o botones visibles) entre todos los archivos del mismo conjunto, sin cerrarse.
- En la ficha de un activo de inventario, cada imagen adjunta muestra una acción visible ("Usar como portada") y se puede reordenar (arrastrar o botones arriba/abajo) — esto es una capacidad opcional de `AttachmentsPanel` activada por configuración (`config.coverSelectable`), no un comportamiento nuevo forzado en todos los módulos que ya usan el panel.
- La columna de imagen de una tabla muestra una miniatura circular/redondeada; si el registro no tiene imagen, muestra un ícono de respaldo — mismo patrón visual que ya usa `VehicleImageCell`.

## 9. Routes/screens

Ninguna ruta nueva. Se modifican pantallas y componentes existentes:

| Componente/Pantalla | Módulo | Cambio |
|---|---|---|
| `packages/ui/src/components/date-picker-shared.jsx` | @runly/ui (compartido) | navegación mes/año/década |
| `packages/ui/src/components/FormFields.jsx` (Combobox*, RelationSelectField, CreatableComboboxField) | @runly/ui (compartido) | unificación de popover |
| `packages/ui/src/components/AdvancedFileViewer.jsx` (+ `PDFViewer.jsx`, `FileVisual.jsx`, `file-kind.js`) | @runly/ui (compartido, reubicado desde runly.files) | visor único |
| `packages/ui/src/components/AttachmentsPanel.jsx` | @runly/ui (compartido) | agrupación multimedia/documentos, portada/reorden opcional |
| `packages/ui/src/runly-renderer/RunlyTable.jsx` | @runly/ui (compartido) | tipo de columna `image-asset` |
| `apps/desktop/src/modules/runly.inventory/blueprints/*` | runly.inventory | columna `image-asset` en tabla, `coverSelectable: true` en adjuntos |
| `apps/desktop/src/modules/runly.hr/screens/HrScreen.jsx` | runly.hr | columna `image-asset` en tabla |

## 10. Data model

### New models

N/A — no hay modelos nuevos.

### Modified models

- **`InvItemFile`** (`prisma/schema.prisma:3179`): se agregan dos columnas nuevas, ambas con default seguro para las filas existentes:
  - `sortOrder Int @default(0)` — orden de despliegue entre los archivos de un mismo activo.
  - `isCover Boolean @default(false)` — marca cuál archivo es la portada explícita del activo (si ninguno la tiene marcada, el backend usa la primera imagen por `sortOrder`/`createdAt` como portada calculada).

## 11. Prisma impact

New models: N/A
Modified models: `InvItemFile` (+`sortOrder`, +`isCover`, ambas con default — no rompe filas existentes)
New migration required: Sí
Migration safety notes: Ambas columnas son aditivas con `@default`, se aplican con `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` — no requiere backfill ni bloquea filas existentes.

## 12. API contract

### Endpoints nuevos

#### `PATCH /inventory/items/:id/files/:docId/cover`
Auth: requerido
Permission: `inventory.item.update`
Body: ninguno
Response: `{ data: { id, isCover: true, ... } }` — marca este archivo como portada y desmarca cualquier otro `InvItemFile` del mismo `itemId` que tuviera `isCover: true` (transacción).

#### `PATCH /inventory/items/:id/files/reorder`
Auth: requerido
Permission: `inventory.item.update`
Body: `{ items: [{ id: string, sortOrder: number }, ...] }` (mismo contrato que `PATCH /inventory/categories/reorder` ya existente)
Response: `{ ok: true }`

### Endpoints modificados (mismo path/método, respuesta enriquecida)

- `GET /inventory/items` (`listItems`) y `GET /inventory/items/:id` (`getItem`): el objeto de cada item ahora incluye `coverImageFileId` (el `fileAssetId` del `InvItemFile` marcado `isCover`, o si ninguno lo está, el de la imagen con menor `sortOrder`/más antigua entre los archivos cuyo `FileAsset.mimeType` empieza con `image/`, o `null` si el activo no tiene ninguna imagen adjunta).
- `GET /hr/employees` (el listado que alimenta `HrScreen.jsx`): cada colaborador incluye un campo calculado `photoFileId = profileImageFileId ?? userProfile?.avatarFileId ?? null` (misma precedencia que ya usa `HrEmployeeDetail.jsx`).

## 13. SDK contract

- `@runly/sdk`'s dominio `inventory` gana dos métodos: `setItemFileCover(itemId, docId, token)` → `PATCH .../cover`, y `reorderItemFiles(itemId, items, token)` → `PATCH .../reorder`. Siguen el mismo patrón que los métodos de reorder de catálogos ya existentes en el mismo dominio.
- Sin cambios en `@runly/sdk`'s dominio `hr` ni `activity` — `photoFileId`/`coverImageFileId` llegan como parte de la respuesta existente, no requieren un método nuevo.

## 14. Validator contract

N/A — los dos endpoints nuevos no requieren un schema Zod dedicado (el de reorder reutiliza la validación laxa que ya usa el reorder de catálogos: un arreglo de `{id, sortOrder}`; el de portada no recibe body).

## 15. Module manifest impact

N/A — sin cambios en manifests, permisos nuevos, ni dependencias de módulo. Los dos endpoints nuevos reutilizan el permiso `inventory.item.update` ya existente.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

- **`inventory-item-form.blueprint.js`**: la sección `attachments` existente agrega `coverSelectable: true` a su config (nueva clave opcional que `AttachmentsPanel` interpreta para mostrar la acción "Usar como portada" y controles de reordenar sobre las miniaturas de imagen).
- **`inventory-item-detail.blueprint.js`**: la sección `attachments` existente agrega la misma `coverSelectable: true`.
- **`inventory.item.table`** (la tabla de listado de Inventario, `InventoryScreen.jsx` — archivo no tocado en la funcionalidad anterior, se modifica aquí por primera vez): se agrega como **primera** columna `{ field: 'coverImageFileId', label: 'Imagen', type: 'image-asset', sortable: false }`.
- **RH** (`HrScreen.jsx`'s `columns`): se agrega como **primera** columna `{ field: 'photoFileId', label: 'Foto', type: 'image-asset', sortable: false }`.
- **`RunlyTable`'s schema de columna**: se documenta el nuevo `type: "image-asset"` como tipo de primera clase (junto a `text`/`number`/`date`/`boolean`/`select`/`color`/`image` existentes), resuelto internamente sin pasar por `componentRegistry` (a diferencia de los cell renderers bespoke de Fleet).

## 18. RBAC/permissions

Sin permisos nuevos. Los dos endpoints nuevos de Inventario reutilizan `inventory.item.update` (ya guarda `PATCH /inventory/items/:id`).

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `inventory.item.update` | (existente) + `PATCH .../files/:docId/cover`, `PATCH .../files/reorder` | No |

## 19. Multi-company behavior

Sin cambios de patrón: los dos endpoints nuevos reciben `companyId` del contexto autenticado igual que el resto de rutas de `inventory-service.js`, y validan que el `InvItemFile`/`InvItem` referenciado pertenezca a la compañía activa antes de modificarlo (mismo guard `assertCompany`/verificación de pertenencia que ya usan `assignItem`/`returnItem`).

## 20. Files/storage impact

Sin cambios de almacenamiento — los endpoints nuevos solo modifican metadatos (`isCover`, `sortOrder`) de filas `InvItemFile` ya existentes; no suben ni mueven archivos en Supabase Storage. `AdvancedFileViewer` reubicado no cambia cómo se sirven los archivos (sigue usando URLs firmadas ya generadas por los endpoints existentes de `runly.files`).

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A — marcar una portada o reordenar archivos no se considera una acción de negocio auditable (es metadata de presentación), consistente con que subir/quitar archivos tampoco genera hoy una entrada de `AuditLog` en este módulo.

## 23. Edge cases

1. Un activo sin ningún archivo adjunto — `coverImageFileId` es `null`, la columna de imagen muestra el ícono de respaldo, sin error.
2. Un activo con archivos adjuntos pero ninguno es imagen (todos PDF) — `coverImageFileId` es `null` igual que el caso anterior.
3. Dos usuarios marcan "usar como portada" casi al mismo tiempo sobre imágenes distintas — la transacción de `PATCH .../cover` desmarca cualquier otra portada del mismo item antes de marcar la nueva, así que la última solicitud en completarse gana (comportamiento aceptable, sin bloqueo optimista adicional).
4. Un colaborador de RH sin foto propia (`profileImageFileId` nulo) pero con avatar de usuario (`userProfile.avatarFileId` presente) — la columna de imagen muestra el avatar del usuario, igual que ya hace `HrEmployeeDetail.jsx`.
5. El selector de fecha en vista de años: seleccionar un año fuera del rango típico (ej. 1950) debe seguir funcionando — la paginación de años no tiene límite inferior/superior artificial más allá de años JS válidos.
6. `AttachmentsPanel` con `coverSelectable: true` en un módulo que no sea Inventario (si se reutiliza el mismo flag en el futuro) — la acción "Usar como portada" solo debe aparecer si el consumidor también pasa el `onSetCover`/`onReorder` correspondiente; si no se pasan, el flag no debe romper el panel (debe degradar a no mostrar esas acciones).
7. La columna `image-asset` en una fila cuyo `fileAssetId` referencia un archivo ya eliminado de Storage — la resolución de URL firmada falla silenciosamente y se muestra el ícono de respaldo, igual que el manejo de errores ya existente en `VehicleImageCell`.

## 24. Risks

1. Riesgo: mover `AdvancedFileViewer.jsx` (1214 líneas) junto con `PDFViewer.jsx`/`FileVisual.jsx`/`file-kind.js` a `packages/ui` y reescribir ~8 puntos de importación (`ProfileScreen`, `UserEditorScreen`, `FilesScreen`, `HrEmployeeForm`, `HrEmployeeDetail`, `ChatAttachmentViewer`, `ConversationProfilePanel`, `EntityFileViewer`) es el cambio de mayor superficie de esta funcionalidad — cualquier import mal actualizado rompe la vista de archivos en esos módulos. Mitigación: mover los 4 archivos primero, verificar `pnpm build` limpio, y solo después reescribir cada import uno por uno, confirmando cada módulo sigue compilando.
2. Riesgo: `PDFViewer.jsx` depende de `react-pdf`, que hoy es dependencia de `apps/desktop` pero no de `packages/ui`. Mitigación: agregar `"react-pdf": "^10.4.1"` (misma versión ya usada) a `packages/ui/package.json` y correr `pnpm install` antes de mover el archivo.
3. Riesgo: unificar `ComboboxField`/`RelationSelectField`/`CreatableComboboxField` en un componente base compartido es un refactor de tres funciones grandes y ya probadas en producción (usadas en decenas de pantallas) — un error de comportamiento (ej. perder el estado de `meta`/badges, o el flujo de "crear en línea") se notaría en todo el sistema, no solo en Inventario. Mitigación: extraer primero SOLO la parte 100% idéntica entre las tres (posicionamiento del popover vía `computeDropdownStyle`, clic-afuera, autofocus) a una pieza compartida nueva, dejando cada componente dueño de su propio renderizado de opciones/estados especiales — no una fusión total de las tres en un solo componente configurable con props gigantes.
4. Riesgo: el cálculo de `coverImageFileId` en `getItem()`/`listItems()` requiere saber si un `FileAsset` es una imagen (por `mimeType`), lo que implica incluir el `fileAsset.mimeType` en el `include` de `InvItemFile` — una consulta ligeramente más pesada para el listado (que ya trae bastantes relaciones). Mitigación: seleccionar solo `mimeType` (no el archivo completo) en ese include, igual que el resto de selects ya acotados de este servicio.
5. Riesgo: la reubicación del visor y la unificación del combobox tocan archivos usados por Chat/HR/Identity/Files — módulos con QA reciente y activo según la memoria del proyecto. Mitigación: verificación manual explícita de esas pantallas incluida en el plan de verificación (sección 26), no solo de Inventario/RH.

## 25. Acceptance criteria

1. Dado el selector de fecha abierto en vista de días, cuando el usuario toca el nombre del mes, entonces se muestra una cuadrícula de los 12 meses del año actual.
2. Dado el selector de fecha en vista de meses, cuando el usuario toca el año, entonces se muestra una cuadrícula paginada de años (12 a la vez, con flechas para avanzar/retroceder una página).
3. Dado el usuario selecciona un año en la vista de años, cuando lo hace, entonces se muestra la vista de meses de ese año; al elegir un mes, se muestra la vista de días de ese mes/año.
4. Dado cualquier combobox con buscador (categoría, marca, ubicación, empleado, etc.), cuando se abre, entonces el campo de búsqueda tiene el foco automáticamente y el contenedor del popover usa el estilo `glass-shell`.
5. Dado un activo con 3 fotos y 2 PDFs adjuntos, cuando se abre su panel de archivos (en el formulario o en el detalle), entonces las 3 fotos aparecen agrupadas bajo "Multimedia" y los 2 PDFs bajo "Documentos".
6. Dado el usuario marca una de las 3 fotos como portada, cuando recarga el listado de inventario, entonces esa foto (no la primera subida) aparece en la columna de imagen de esa fila.
7. Dado un activo sin ninguna foto marcada como portada pero con al menos una imagen adjunta, cuando se lista, entonces `coverImageFileId` resuelve a la imagen más antigua adjunta.
8. Dado un colaborador de RH con `profileImageFileId` nulo pero con `userProfile.avatarFileId` presente, cuando se lista en la tabla de RH, entonces la columna de imagen muestra el avatar del usuario.
9. Dado el usuario hace clic en la columna de imagen de cualquier fila (Inventario o RH) que tenga una foto, cuando se abre el visor, entonces puede navegar con flechas a los demás archivos del mismo registro sin cerrarlo.
10. Dado cualquier pantalla que hoy usa `FileViewer`/`ImageViewer` fuera de `AttachmentsPanel` (ej. `VehicleImageCell`), cuando se abre después de esta funcionalidad, entonces sigue funcionando exactamente igual que antes (no migrada, sin regresión).

## 26. Verification plan

- `pnpm db:generate` y `pnpm db:migrate` — la migración de `InvItemFile` aplica sin errores.
- `node --test apps/api/src/services/__tests__/inventory-service.test.js` — nuevos casos para `coverImageFileId` (con portada explícita, sin portada pero con imágenes, sin imágenes) y para los dos endpoints nuevos.
- `pnpm lint` y `pnpm --filter @runly/desktop build:web` limpios.
- Manual, `pnpm dev` corriendo, en 390px y 1440px, tema claro y oscuro:
  - Selector de fecha: navegar de una fecha de hoy a una de hace 10 años usando la cuadrícula de años/meses.
  - Combobox: abrir categoría/marca/ubicación, confirmar foco automático y estilo glass en ambos temas.
  - Archivos de un activo de inventario: confirmar agrupación Multimedia/Documentos, marcar portada, reordenar, y ver el resultado reflejado en la columna de imagen del listado.
  - Tabla de RH: confirmar columna de foto como primera columna, con fallback a avatar de usuario cuando no hay foto de colaborador.
  - Regresión: abrir el visor de imagen de un vehículo en Fleet (`VehicleImageCell`) y confirmar que sigue funcionando igual que antes.
  - Regresión: abrir un archivo desde Chat, HR (`HrEmployeeDetail`), Identity (`ProfileScreen`) y Files (`FilesScreen`) — confirmar que `AdvancedFileViewer` sigue abriendo y navegando correctamente desde su nueva ubicación en `@runly/ui`.

## 27. Rollback plan

- La migración de `InvItemFile` es aditiva (columnas con default); revertirla requiere una migración forward que haga `DROP COLUMN` de `sortOrder`/`isCover` — no hay pérdida de datos existentes al revertir porque ninguna columna preexistente se modifica.
- El movimiento de `AdvancedFileViewer` a `packages/ui` puede revertirse con `git revert` del commit correspondiente, siempre que se revierta también el commit que reescribe los imports (deben revertirse juntos o el build queda roto).
- La unificación del combobox puede revertirse independientemente restaurando las tres implementaciones previas desde git history si se detecta una regresión de comportamiento no capturada en verificación.
- Los dos endpoints nuevos son aditivos; revertirlos no afecta ninguna funcionalidad existente (nada los consumía antes de esta funcionalidad).

## 28. Future enhancements

1. Unificar `MiniCalendar.jsx` y el `Calendar` de `date-picker-shared.jsx` en una sola implementación de cuadrícula de días (hoy son dos copias con convención de primer-día-de-semana distinta).
2. Migrar los consumidores restantes de `FileViewer`/`ImageViewer` (`ImageUploader`, `ChannelGeneralTab`, `VehicleImageCell`, `DriverAvatarCell`, `CompanyBranding`) a `AdvancedFileViewer` para tener un solo visor en todo el sistema.
3. Permitir que otros módulos (Contactos, Flota, Finanzas) declaren su propia columna `image-asset` cuando lo necesiten, reusando el mismo tipo de columna genérico construido aquí.
4. Explorar un selector de fecha por "rueda" (scroll con snap) más cercano a la interacción nativa de iOS, si la cuadrícula de meses/años no resulta suficientemente rápida en el uso real.
5. Extender `coverSelectable`/reordenar archivos a otros módulos con galerías de imágenes (ej. Fleet, si algún día se necesita elegir portada entre varias fotos de un vehículo en vez de una sola `cover_image_file_asset_id`).
