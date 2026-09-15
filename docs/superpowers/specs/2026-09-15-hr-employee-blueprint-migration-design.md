# Migración de HR (colaborador) a RunlyDetail/RunlyForm, con foto de perfil genérica en FileAsset

Date: 2026-09-15
Status: Draft
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md
Plan file: docs/superpowers/plans/2026-09-15-hr-employee-blueprint-migration.md (created after spec approval)

---

## 1. Feature title

Migración de las pantallas de detalle y alta/edición de colaborador (`HrEmployeeDetail.jsx`, `HrEmployeeForm.jsx`) a blueprints sobre `RunlyDetail`/`RunlyForm`, con una capacidad nueva de "portada" (isCover/sortOrder) agregada al modelo compartido `FileAsset` para que cualquier módulo con archivos etiquetados genéricamente (moduleKey/entityType/entityId) —empezando por la foto de perfil de HR— pueda usar el mismo selector de portada que Inventario.

## 2. Status

Draft

## 3. Context

`runly.inventory` y `runly.fleet` ya migraron sus pantallas de alta/edición y detalle a `RunlyForm`/`RunlyDetail` (ver los specs de 2026-09-14 y 2026-09-15 en esta misma carpeta), heredando automáticamente cada mejora hecha a esos renderers compartidos durante esta sesión: acento de tarjeta, valores en negrita, `DetailActionBar`, sidebar consolidado del formulario, e historial de modificaciones con diff por campo. `runly.hr` es el único módulo con pantallas de entidad principal que sigue siendo JSX hand-rolled — `HrEmployeeDetail.jsx` (1196 líneas) y `HrEmployeeForm.jsx` (1050 líneas) — construido antes de que existiera el patrón `RunlyDetail`/`RunlyForm`, con lógica duplicada de formateo, sin `react-hook-form`, y con un visor de auditoría propio que ahora duplica lo que `ActivityTimeline` ya hace de forma genérica.

Una investigación de código (ver sección "Context" ampliada más abajo) encontró que:
- `hr-service.js` **ya** envía snapshots completos `before`/`after` a `bridge.logAndPublish` en `updateEmployee` — el historial de cambios por campo ya funciona para HR sin tocar el backend (confirmado y verificado en una funcionalidad previa de esta misma sesión, commit "wire field labels into the employee activity panel").
- El formulario actual no usa `react-hook-form` ni Zod en el cliente — solo `useState` manual y `required` de HTML5. La migración a `RunlyForm` es una mejora neta de validación, no una pérdida.
- La foto de perfil (`HrEmployee.profileImageFileId`) es un patrón que no existe en ningún otro módulo migrado: un archivo subido vía el endpoint genérico `/files/upload` (etiquetado `moduleKey`/`entityType`/`entityId`, sin tabla de asociación por módulo como `InvItemFile`), cuyo id se guarda además en una columna FK dedicada del empleado, sincronizada por una mutación de dos pasos en el cliente. `FileAsset` (el modelo compartido) no tiene ninguna columna tipo `isCover`/`sortOrder` hoy — ese patrón solo existe en `InvItemFile` (tabla de asociación exclusiva de Inventario).

## 4. Problem

Tres problemas relacionados:

1. Las pantallas de HR no se benefician de ninguna de las mejoras compartidas hechas esta sesión (acento visual, `DetailActionBar`, historial expandible con diff — este último ya funciona a nivel de datos pero su presentación depende de que exista una pantalla que lo muestre bien, lo cual ya existe vía `HrEmployeeActivityPanel`).
2. HR tiene un visor de auditoría propio (`AuditPanel`/`AuditDetailModal`, ~185 líneas) que duplica — con su propia lógica de diff y su propio mapa de etiquetas — lo que `ActivityTimeline` ya hace de forma genérica y consistente con Inventario/Fleet.
3. La foto de perfil de colaborador usa un patrón (FK dedicado + subida a `/files/upload` sin capacidad de portada) que no tiene equivalente en `RunlyForm`/`AttachmentsPanel` hoy, y que bloquea generalizar el selector de portada (estrella) a cualquier módulo que use el patrón genérico de archivos por `moduleKey`/`entityType`/`entityId` en vez de una tabla de asociación propia.

## 5. Goals

1. `HrEmployeeDetail.jsx` se reconstruye como un wrapper delgado sobre un blueprint `DETAIL` (`HR_EMPLOYEE_DETAIL`) usando `RunlyDetail` con `schema.hero`, `schema.kpis`, `layout: "two-column"` — mismo patrón que `INVENTORY_ITEM_DETAIL`/`VEHICLE_DETAIL`.
2. `HrEmployeeForm.jsx` se reconstruye como un wrapper delgado sobre un blueprint `FORM` (`HR_EMPLOYEE_FORM`) usando `RunlyForm`, con el sidebar consolidado (`asideActions` para los botones Ver/Deshabilitar cuando aplique) que Inventario ya tiene.
3. `AuditPanel`/`AuditDetailModal`/`computeDiff`/`fmtFieldValue` se eliminan por completo — el historial de cambios se muestra únicamente vía `HrEmployeeActivityPanel` (ya registrado como sección `component`), que ya obtiene diffs reales del backend.
4. El organigrama (`OrgChartPanel`, ~175 líneas) se extrae a un componente reutilizable registrado como `runly.hr:OrgChartSection`, montado como sección `component` del detalle — preserva la lógica visual existente, solo cambia cómo se monta.
5. `FileAsset` (modelo compartido) gana columnas `isCover Boolean @default(false)` y `sortOrder Int @default(0)`, más un mecanismo genérico en `files-service.js` (`setFileCover`/`reorderFiles`, scoped por `moduleKey`+`entityType`+`entityId`, no por una tabla de asociación) para que cualquier módulo con archivos etiquetados genéricamente pueda ofrecer el mismo selector de portada (estrella) que Inventario ya tiene vía `InvItemFile.isCover`.
6. La foto de perfil de colaborador se convierte en "el archivo marcado como portada entre los archivos genéricos del colaborador" — se elimina la columna `HrEmployee.profileImageFileId` (con una migración de datos que marca `isCover = true` en el `FileAsset` correspondiente para cada empleado que ya tenía una foto, antes de eliminar la columna) y el flujo de subida de dos pasos en el cliente.
7. Los campos denormalizados `department`/`jobTitle`/`managerName` dejan de sincronizarse desde el cliente — `hr-service.js` los calcula en `createEmployee`/`updateEmployee` a partir de `departmentId`/`jobTitleId`/`supervisorEmployeeId` resueltos, igual que `categoryName` en `inventory-service.js`.
8. La sección de documentos editable (subida con arrastrar-soltar, ~245 líneas de caché de vistas previas) se reemplaza por la sección estándar `type: "attachments"` que `AttachmentsPanel` ya provee, configurada contra los endpoints genéricos de `/files`.
9. El gating de permisos (`hr.employee.update`/`hr.employee.create`/`hr.employee.delete`) se preserva exactamente, movido a las nuevas pantallas delgadas — sin cambios de comportamiento para el usuario final.

## 6. Non-goals

1. No se toca `HrScreen.jsx` (la pantalla de listado) — permanece como está, igual que el listado de Inventario/Fleet quedó fuera de alcance en sus propias migraciones.
2. No se ofrece creación en línea ("+ Crear") para `departmentId`/`jobTitleId` dentro del formulario de colaborador — se pierde esa conveniencia (hoy vía `CreatableComboboxField`), igual que Inventario aceptó perder la creación en línea de categoría/marca/ubicación en su propia migración (ver `docs/superpowers/specs/2026-09-14-inventory-glass-redesign-design.md`, sección 24, riesgo 5). Crear un departamento o puesto nuevo requiere ir primero a la pantalla de catálogos de HR.
3. No se migra `HrOrgChartScreen.jsx` (la vista de organigrama de toda la empresa) — es una pantalla distinta del organigrama embebido en el detalle de un colaborador individual (`OrgChartPanel`), que sí se migra.
4. No se cambia el modelo de permisos ni se agregan claves nuevas — se preservan `hr.employee.read/create/update/delete` exactamente como existen hoy.
5. No se construye una capacidad de "portada" genérica configurable por-relación (ej. elegir automáticamente cuál relación de un módulo arbitrario tiene "portada") — el mecanismo nuevo en `files-service.js` es genérico en el sentido de que cualquier módulo puede usarlo pasando su propio `moduleKey`/`entityType`, pero cada módulo debe configurar explícitamente su blueprint para usarlo; no hay autodetección.
6. No se adopta `RunlyCrudView` para HR — las pantallas de detalle/formulario siguen siendo wrappers delgados que llaman `RunlyDetail`/`RunlyForm` directamente (mismo patrón que Inventario), no la envoltura de tabla+formulario+detalle en una sola pieza que `RunlyCrudView` ofrece (usada por Fleet), porque HR necesita lógica de permisos/mutaciones a medida que no encaja limpiamente en ese wrapper genérico.

## 7. User stories

- Como usuario con `hr.employee.read`, quiero ver el detalle de un colaborador con el mismo lenguaje visual (acento de tarjeta, botones de acción visibles) que ya veo en Inventario y Flota, para que la experiencia sea consistente en todo el sistema.
- Como usuario con `hr.employee.update`, quiero poder marcar cuál de las fotos subidas de un colaborador es la que aparece como su foto de perfil, en vez de que sea siempre la primera subida sin poder cambiarla.
- Como desarrollador de otro módulo, quiero poder usar el mismo mecanismo de portada (estrella) que Inventario tiene, sin necesitar una tabla de asociación propia, para no reconstruir esa capacidad módulo por módulo.

## 8. UX requirements

- Todo texto de UI en español.
- Responsivo obligatorio en 390px y 1440px — checklist de 14 aspectos corrido sobre ambas pantallas migradas.
- El organigrama (`OrgChartSection`) preserva su apariencia visual actual (nodos de supervisor/self/reportes, colores por hash, navegación al hacer clic) — es una migración de "dónde se monta", no un rediseño visual de ese widget específico.
- El botón de estrella para marcar portada en `AttachmentsPanel` es siempre visible (no solo al pasar el mouse), igual que el ajuste ya hecho a Inventario esta sesión.
- Las acciones de la pantalla de detalle (Editar, Habilitar/Deshabilitar) usan `DetailActionBar` (primario + secundarios visibles, sin menú oculto), igual que Inventario — con el gating de permisos existente aplicado antes de construir los arreglos `primary`/`secondary` (si el usuario no tiene `hr.employee.update`, no se pasa `primary`; si no tiene `hr.employee.delete`, no se incluye la acción de habilitar/deshabilitar en `secondary`).
- El formulario usa el sidebar consolidado de `RunlyForm` (ficha completada + vista previa) — no hay panel de vista previa configurado hoy en HR, así que solo aplica el anillo de completado si se decide activarlo (ver sección 17).

## 9. Routes/screens

Rutas existentes, sin cambios de path:

| Route | Screen | Module | Description |
|---|---|---|---|
| `/app/m/runly.hr/employees/new` | `HrEmployeeForm.jsx` (wrapper delgado sobre `RunlyForm` + `HR_EMPLOYEE_FORM`) | runly.hr | Alta de colaborador |
| `/app/m/runly.hr/employees/:id/edit` | mismo componente que arriba, `mode="edit"` | runly.hr | Edición de colaborador |
| `/app/m/runly.hr/employees/:id` | `HrEmployeeDetail.jsx` (wrapper delgado sobre `RunlyDetail` + `HR_EMPLOYEE_DETAIL`) | runly.hr | Detalle de colaborador |

## 10. Data model

### New models

N/A

### Modified models

- **`FileAsset`**: se agregan dos columnas nuevas, `isCover Boolean @default(false)` y `sortOrder Int @default(0)`. Ambas nullable-safe con default, sin impacto en filas existentes. Usadas por el nuevo mecanismo genérico de portada en `files-service.js`, no solo por HR.
- **`HrEmployee`**: se elimina la columna `profileImageFileId` (y su relación `profileImageFile`) después de una migración de datos que preserva la foto actual de cada empleado marcando `isCover = true` en el `FileAsset` correspondiente.

## 11. Prisma impact

New models: N/A
Modified models: `FileAsset` (+2 columnas), `HrEmployee` (-1 columna, -1 relación)
New migration required: Sí — una migración forward que: (1) agrega `is_cover`/`sort_order` a `file_asset`; (2) para cada `hr_employee` con `profile_image_file_id IS NOT NULL`, hace `UPDATE file_asset SET is_cover = true WHERE id = hr_employee.profile_image_file_id`; (3) elimina la columna `profile_image_file_id` de `hr_employee` (y su FK).
Migration safety notes: El paso 2 es una migración de datos dentro de la misma migración SQL (no un script aparte) para garantizar que corre exactamente una vez, en orden, antes del `DROP COLUMN` del paso 3. Es aditiva/seleccionable: si un empleado no tenía foto, no se toca ningún `FileAsset`. Es irreversible en el sentido de que revertir requeriría una migración forward nueva que re-agregue la columna (no se edita la migración aplicada, ver rollback en sección 27).

## 12. API contract

### Endpoints existentes (sin cambios) que se reutilizan

- `GET /hr/employees`, `GET /hr/employees/:id`, `POST /hr/employees`, `PUT /hr/employees/:id`, `PATCH /hr/employees/:id/enabled`, `GET /hr/org-chart`, `GET|POST|PUT|PATCH /hr/departments...`, `GET|POST|PUT|PATCH /hr/job-titles...` — sin cambios de request/response, salvo que `createEmployee`/`updateEmployee` ahora calculan `department`/`jobTitle`/`managerName` en el servidor (ver sección 22) en vez de aceptarlos tal cual del cliente (aditivo: si el cliente los sigue enviando, el servidor los ignora y calcula los suyos).
- `GET /files`, `POST /files/upload`, `DELETE /files/:id`, `GET /files/:id/signed-url` — sin cambios de firma; el flujo de HR simplemente deja de escribir/leer `profileImageFileId` por separado.

### Endpoints nuevos

- **`PATCH /files/:id/cover`** — marca un `FileAsset` como portada dentro de su grupo (`moduleKey`+`entityType`+`entityId`), desmarcando cualquier otro archivo del mismo grupo. Permiso: `files.assets.update` (clave ya existente, reutilizada — confirmar en el catálogo de permisos durante el plan). Request: `{}` (el id va en la URL). Response: `{ data: FileAsset }`.
- **`POST /files/reorder`** — reordena los archivos de un grupo (`moduleKey`+`entityType`+`entityId`+arreglo de ids en el orden deseado), escribiendo `sortOrder` secuencial. Permiso: `files.assets.update`. Request: `{ moduleKey, entityType, entityId, orderedIds: string[] }`. Response: `{ data: FileAsset[] }`.

Ambos mirroring exacto de `setItemFileCover`/`reorderItemFiles` en `inventory-service.js`, generalizados para no depender de una tabla de asociación.

### Lógica backend modificada (sin cambio de ruta/firma)

- `apps/api/src/services/files-service.js`: la función de listado de archivos por `moduleKey`/`entityType`/`entityId` ahora ordena por `sortOrder ASC, createdAt ASC` (antes solo `createdAt`), y expone `isCover`/`sortOrder` en cada fila.
- `apps/api/src/services/hr-service.js`: `createEmployee`/`updateEmployee` calculan `department`/`jobTitle`/`managerName` a partir de `departmentId`/`jobTitleId`/`supervisorEmployeeId` resueltos vía consultas a `HrDepartment`/`HrJobTitle`/`HrEmployee` (supervisor), en vez de aceptar esos tres campos de texto directo del payload del cliente.

## 13. SDK contract

Domain: `runly.files` (o el nombre que use el SDK hoy para el dominio de archivos — confirmar en el plan)

- `setCover(fileId, token)` — `PATCH /files/:id/cover` — retorna `{ data: FileAsset }`.
- `reorder({ moduleKey, entityType, entityId, orderedIds }, token)` — `POST /files/reorder` — retorna `{ data: FileAsset[] }`.

## 14. Validator contract

- Nuevo schema `filesReorderSchema` en `@runly/validators`: `{ moduleKey: string, entityType: string, entityId: string.uuid(), orderedIds: string.uuid().array() }`.
- `hrEmployeeCreateSchema`/`hrEmployeeUpdateSchema` (existentes): se elimina `profileImageFileId` de los campos aceptados (o se deja como aceptado-pero-ignorado durante una ventana de compatibilidad — decisión de implementación en el plan); se elimina la validación de `department`/`jobTitle`/`managerName` como campos de entrada directa si el servidor ahora los calcula (siguen existiendo como campos de salida/lectura).

## 15. Module manifest impact

N/A — ni `runly.hr` ni el manejo de `FileAsset` cambian su manifest; no hay permisos, dependencias ni entradas de navegación nuevas.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

Dos blueprints nuevos, module-local a `runly.hr` (mismo patrón que `INVENTORY_ITEM_FORM`/`INVENTORY_ITEM_DETAIL`):

- **`hr.employee.form`** (kind: `FORM`) — secciones: Identidad (nombre, apellido, código, estado, cuenta de usuario vinculada), Datos laborales (puesto, departamento, supervisor, tipo de contrato, ubicación, fechas), Contacto (correo laboral/personal, teléfono, contacto de emergencia), Notas (markdown), Archivos (`type: "attachments"`, con `coverPath`/`reorderPath` apuntando a los endpoints nuevos — esta sección cubre tanto la foto de perfil como cualquier otro documento, sin una sección de "foto" separada). `showCompletion` se activa si el equipo lo pide (por defecto `false`, consistente con no forzar una decisión visual no pedida explícitamente).
- **`hr.employee.detail`** (kind: `DETAIL`) — `schema.hero` (`titleField`: nombre completo calculado, `subtitleFields`: puesto/departamento, `statusField`: status, `imageDocsPath`: el mismo path genérico de archivos, resuelto igual que Inventario vía `fetchFirstImageAssetId` con preferencia por `isCover`), `schema.kpis` (antigüedad — requiere resolver cómo exponer un valor calculado como KPI, ver riesgo 3), `layout: "two-column"`. Secciones de columna principal: Datos laborales, Contacto, Notas. Secciones de columna lateral (`column: "aside"`): Cuenta de usuario vinculada (`relation-card`), Organigrama (`type: "component"`, `runly.hr:OrgChartSection`), Archivos (`type: "attachments"`, solo lectura), Equipo asignado (`type: "component"`, reutiliza el widget existente de Inventario), Actividad (`type: "component"`, `runly.hr:HistorySection` — el mismo `HrEmployeeActivityPanel.jsx` ya existente, solo registrado con esta clave nueva).

Un tipo de sección desconocido cae de forma segura en su rama por defecto en ambos renderers, así que agregar estos blueprints no puede romper ningún otro blueprint existente (Fleet, Inventario, Ledger no usan las claves `hr.employee.*`).

## 18. RBAC/permissions

Sin cambios a las claves existentes; se reutiliza una clave existente para los dos endpoints nuevos:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `hr.employee.read` | GET employee(s), GET org-chart | Ya (sin cambio) |
| `hr.employee.create` | POST employee | No |
| `hr.employee.update` | PUT employee | No |
| `hr.employee.delete` | PATCH employee/:id/enabled | No |
| `files.assets.update` | PATCH /files/:id/cover, POST /files/reorder (nuevos) | No |

## 19. Multi-company behavior

Sin cambios de patrón — los endpoints nuevos (`setCover`/`reorder`) se scopean por `companyId` de la sesión autenticada exactamente igual que el resto de `files-service.js`, verificando que el `FileAsset` pertenezca a la compañía activa antes de mutarlo. La migración de datos (antigua `profileImageFileId` → `isCover`) opera fila por fila sin cruzar compañías (cada `HrEmployee` y su `FileAsset` ya comparten `companyId` por construcción).

## 20. Files/storage impact

- Bucket/objectKey: sin cambios — se sigue usando `runly-files` (o el bucket canónico actual) con la convención de `objectKey` ya existente.
- `FileAsset` metadata: gana `isCover`/`sortOrder` como se describió; no cambia cómo se sube/almacena el archivo físico en Supabase Storage, solo metadata adicional en la fila de Postgres.

## 21. Export/import requirements

N/A — no se introducen requisitos de exportación/importación nuevos. `listEmployeesForExport`/el export de PDF de colaboradores no leen `profileImageFileId` hoy (no confirmado explícitamente, verificar en el plan que no rompan si la columna desaparece).

## 22. Audit log requirements

Sin acciones nuevas — `hr.employee.create`/`hr.employee.update`/`hr.employee.setEnabled` ya están registradas y ya funcionan con diff automático (confirmado en la funcionalidad de historial de modificaciones de esta misma sesión). Cambia únicamente qué campos aparecen en el `after` de `hr.employee.update`: `profileImageFileId` deja de existir como campo; `department`/`jobTitle`/`managerName` ahora reflejan valores calculados en el servidor en vez de lo que el cliente haya enviado (más confiables, sin cambio de forma).

## 23. Edge cases

1. Un colaborador sin ninguna foto subida — el hero debe mostrar el ícono de respaldo (`fallbackIcon`), igual que Inventario cuando no hay imagen de portada.
2. Un colaborador con varias fotos subidas pero ninguna marcada como portada explícitamente (dato migrado antes de esta funcionalidad, si el `profileImageFileId` original era null) — se usa la primera imagen por orden de subida como respaldo, igual que el comportamiento ya existente de `fetchFirstImageAssetId`.
3. La migración de datos encuentra un `profileImageFileId` que apunta a un `FileAsset` ya eliminado/inexistente (fila huérfana) — el `UPDATE ... WHERE id = ...` de la migración simplemente no afecta ninguna fila en ese caso; no debe fallar la migración.
4. Un usuario sin `files.assets.update` intenta ver el detalle de un colaborador — el botón de portada no debe aparecer (mismo patrón `canManageCover = canWrite && Boolean(config?.coverPath)` ya corregido esta sesión para Inventario).
5. Reordenar archivos en un grupo con un solo archivo — `reorder` con un arreglo de un elemento debe ser un no-op seguro (no debe fallar por "arreglo demasiado corto").
6. Un departamento o puesto es eliminado (soft-disable) después de haber sido asignado a un colaborador — el cálculo server-side de `department`/`jobTitle` en `updateEmployee` debe seguir funcionando si el colaborador no cambia esa relación en esa edición (no debe re-validar ni fallar por relaciones ya asignadas que ahora están deshabilitadas, solo por relaciones nuevas que el usuario intenta asignar).
7. El organigrama de un colaborador sin supervisor ni reportes — `OrgChartSection` debe mostrar solo el nodo "self", sin romper por arreglos vacíos.

## 24. Risks

1. Riesgo: eliminar `HrEmployee.profileImageFileId` es un cambio de esquema irreversible sin una migración de rollback automática. Mitigación: la migración de datos (antes del DROP) preserva toda foto existente marcándola `isCover`; se documenta el rollback manual en la sección 27.
2. Riesgo: agregar `isCover`/`sortOrder` a `FileAsset` (modelo compartido) podría interactuar con otros módulos que ya usan `FileAsset` de formas no previstas (ej. archivos compartidos entre usuarios, versiones de archivo). Mitigación: ambas columnas son aditivas con default seguro (`false`/`0`), no cambian ningún comportamiento existente de lectura/escritura de `FileAsset` a menos que un módulo explícitamente configure `coverPath`/`reorderPath` en su blueprint — ningún módulo existente lo hace hoy salvo Inventario (que sigue usando su propio `InvItemFile.isCover`, no el nuevo campo de `FileAsset`, así que no hay colisión).
3. Riesgo: el KPI de "antigüedad" (`fmtTenure`) es hoy una función calculada en el cliente a partir de `hireDate`, no un campo. `schema.kpis` de `RunlyDetail` espera un campo directo del registro. Mitigación: exponer `tenureLabel` (string ya formateado, ej. "3 años y 2 meses") como campo calculado en `getEmployee()` del backend, mismo patrón que `categoryName` — evita necesitar una capacidad nueva de "KPI calculado en cliente" en el renderer compartido.
4. Riesgo: mover el cálculo de `department`/`jobTitle`/`managerName` al servidor podría no coincidir exactamente con lo que el cliente calculaba antes (ej. formato de "Apellido, Nombre" vs "Nombre Apellido" para `managerName`). Mitigación: revisar el cálculo cliente actual (`fromEmployee`/`normalizeForApi`) antes de portarlo al servidor, replicando el mismo formato exacto, verificado con una prueba que compara ambos.
5. Riesgo: `AttachmentsPanel`/`useAttachmentsController` fueron diseñados y probados contra el patrón de tabla de asociación de Inventario (`fileAssetId`, `associationId` distintos); el patrón genérico de HR no tiene "associationId" separado del `FileAsset` mismo. Mitigación: confirmar durante el plan que la configuración de campos (`fields: { fileAssetId: 'id', ... }`) puede mapear ambos al mismo valor sin requerir cambios de código en `useAttachmentsController` — si hiciera falta un ajuste, debe mantenerse retrocompatible con Inventario/Fleet.
6. Riesgo: `HrEmployeeForm.jsx`/`HrEmployeeDetail.jsx` importan `InventoryEmployeeWidget` desde el módulo de Inventario — una dependencia cruzada de módulos ya existente hoy, no introducida por esta funcionalidad, pero que debe seguir funcionando igual tras el registro del componente bajo la nueva convención de blueprint.

## 25. Acceptance criteria

1. Dado un usuario con `hr.employee.read`, cuando abre el detalle de un colaborador, entonces se renderiza vía `RunlyDetail` con hero, KPIs (incluida antigüedad), acento de tarjeta y `DetailActionBar`.
2. Dado un colaborador con dos fotos subidas, cuando el usuario marca la segunda como portada, entonces el hero del detalle muestra esa segunda foto.
3. Dado que se aplica la migración de datos, cuando se consulta un colaborador que ya tenía `profileImageFileId` antes de la migración, entonces su `FileAsset` correspondiente tiene `isCover = true` y su foto se sigue mostrando igual que antes.
4. Dado el formulario de alta/edición de colaborador, cuando se renderiza, entonces no aparece ningún componente `AuditPanel`/`AuditDetailModal` en ningún lugar del código ni de la UI.
5. Dado un colaborador cuyo departamento cambia en una edición, cuando se guarda, entonces el campo `department` (texto) del registro resultante coincide con el nombre del `HrDepartment` seleccionado, calculado por el servidor.
6. Dado un usuario sin `hr.employee.update`, cuando ve el detalle de un colaborador, entonces no aparece el botón primario "Editar" en `DetailActionBar`.
7. Dado el mismo flujo en un viewport de 390px, cuando se interactúa con el organigrama y la sección de archivos, entonces no hay overflow horizontal ni elementos inaccesibles.

## 26. Verification plan

- `node --test apps/api/src/services/__tests__/` — incluye pruebas nuevas para el cálculo server-side de `department`/`jobTitle`/`managerName`, y para `setFileCover`/`reorderFiles` en `files-service.js`.
- `pnpm db:generate` — el cliente Prisma regenera sin errores tras el cambio de esquema.
- `pnpm db:migrate` — la migración nueva aplica sin errores contra una base con datos de prueba (al menos un colaborador con `profileImageFileId` no nulo antes de migrar).
- `pnpm lint` — sin errores nuevos.
- `pnpm build` — `apps/api`, `apps/desktop`, `packages/ui` compilan sin errores.
- Manual, con `pnpm dev` corriendo: alta y edición de un colaborador completo (incluida foto, cambio de portada entre dos fotos, departamento/puesto/supervisor, notas); detalle en 390px y 1440px verificando hero/KPIs/organigrama/archivos/actividad/equipo asignado; confirmar que el historial de "Actividad" muestra diffs reales tras una edición.
- Checklist de 14 aspectos (`docs/ai-context/ui-screen-audit-checklist.md`) sobre las dos pantallas migradas.

## 27. Rollback plan

- El restyle/migración de las pantallas de HR a blueprint puede revertirse de forma independiente restaurando desde git history `HrEmployeeDetail.jsx`/`HrEmployeeForm.jsx` hand-rolled, sin tocar la base de datos.
- El cambio de esquema (`isCover`/`sortOrder` en `FileAsset`, eliminación de `HrEmployee.profileImageFileId`) es una migración de Prisma aplicada; revertirla requiere una migración forward nueva que: (1) re-agregue `profileImageFileId` a `hr_employee`; (2) para cada `FileAsset` con `isCover = true` y `entityType = 'HrEmployee'`, escriba su id de vuelta en el `hr_employee.profile_image_file_id` correspondiente. No se edita la migración original aplicada (regla del proyecto).
- Los dos endpoints nuevos (`PATCH /files/:id/cover`, `POST /files/reorder`) son aditivos; revertirlos solo afecta a los módulos que los hayan adoptado (HR, y cualquier futuro consumidor) — Inventario sigue usando su propio mecanismo basado en `InvItemFile`, no se ve afectado.

## 28. Future enhancements

1. Migrar el mecanismo de portada de Inventario (`InvItemFile.isCover`) al nuevo campo genérico de `FileAsset`, unificando ambos caminos en uno solo — no se hace en esta funcionalidad para no tocar código de Inventario ya estable, pero queda como consolidación futura.
2. Adoptar el mismo patrón de "portada genérica" en Fleet (que hoy solo usa "primera imagen por orden de subida", sin selector explícito).
3. Restaurar la creación en línea de departamento/puesto sin salir del formulario, si surge la misma mejora prevista para Inventario (ver spec de Inventario, sección 28, ítem 6).
4. Migrar `HrOrgChartScreen.jsx` (el organigrama de toda la empresa) para reutilizar los mismos componentes visuales que `OrgChartSection`.
