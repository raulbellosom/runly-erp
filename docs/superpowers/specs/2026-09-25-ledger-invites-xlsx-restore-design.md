# runly.ledger — Invitaciones pendientes, importación XLSX y restauración de movimientos/categorías

Date: 2026-09-25
Status: Proposed
Author: Claude Sonnet 5 (spec agent)
Spec file: docs/superpowers/specs/2026-09-25-ledger-invites-xlsx-restore-design.md

---

## 1. Feature title

runly.ledger — Flujo de aceptar/rechazar invitaciones a grupos y cuentas compartidas, importación de movimientos en formato XLSX (asistente manual), y restauración de movimientos eliminados y categorías deshabilitadas.

---

## 2. Context

`runly.ledger` ya tiene mecanismos de colaboración (grupos y cuentas compartidas directas), un asistente de importación manual, y un patrón estándar de borrado suave (`enabled: false`). Una auditoría del módulo encontró tres huecos funcionales:

1. El acceso a grupos/cuentas compartidas es inmediato al invitar (`status = 'active'` desde la inserción) — decisión de diseño documentada en `docs/superpowers/specs/2026-06-05-ledger-collaboration-groups-design.md`, pero ya no es el comportamiento deseado.
2. El asistente manual de importación (`ImportWizard.jsx`) solo acepta CSV, mientras que el flujo de importación por IA (`AiImportScreen.jsx`) ya acepta CSV, XLSX, PDF e imágenes usando un parser de servidor (`exceljs`) que el asistente manual no reutiliza.
3. Los endpoints de habilitar/deshabilitar (`enabled: true/false`) ya existen para cuentas, movimientos y categorías, pero ninguna pantalla del módulo permite ver ni restaurar elementos deshabilitados — el backend soporta la restauración, la UI no la expone.

---

## 3. Problem

1. Cualquier usuario invitado a un grupo o cuenta compartida obtiene acceso de inmediato, sin poder revisar y aceptar conscientemente la invitación antes de que quede activa.
2. Los usuarios que exportan sus movimientos bancarios como XLSX (formato por defecto de la mayoría de bancos y Excel) no pueden importarlos con el asistente manual — deben convertir a CSV primero o usar el asistente de IA, que tiene un flujo distinto (reconocimiento por IA en vez de mapeo manual de columnas).
3. Un movimiento eliminado por error o una categoría deshabilitada por error no se pueden recuperar desde la interfaz — la única vía es una consulta directa a base de datos.

---

## 4. Goals

- G1: Las invitaciones a grupos y a cuentas compartidas directas crean una membresía en estado `pending`, sin acceso, hasta que el invitado la acepta.
- G2: El invitado puede aceptar o rechazar la invitación desde `MembershipsScreen.jsx`, que muestra una sección "Pendientes" con un badge de conteo en la navegación.
- G3: El asistente manual de importación acepta archivos `.xlsx` además de `.csv`, reutilizando el parser de servidor ya usado por el flujo de importación por IA.
- G4: Existe una vista de "Movimientos eliminados" por cuenta, con botón de restaurar por fila.
- G5: `CategoriesScreen.jsx` permite ver categorías deshabilitadas y restaurarlas.

---

## 5. Non-goals

- No se agrega expiración automática de invitaciones pendientes.
- No se agrega restauración de cuentas deshabilitadas (fuera de alcance de este spec; mismo patrón, se puede abordar después).
- No se agregan tokens de invitación de un solo uso ni URLs públicas de invitación.
- No se cambia el flujo de importación por IA (`AiImportScreen.jsx`) — ya soporta XLSX.
- No se agrega un endpoint dedicado de conteo de invitaciones pendientes; el badge se deriva de la respuesta ya cacheada de `GET /ledger/memberships`.
- No se modifica el cálculo de saldo corriente (`saldo_actual`) ni la numeración `consecutive` de movimientos — los movimientos deshabilitados quedan fuera de ese cálculo, igual que hoy.

---

## 6. User stories

- Como usuario invitado a un grupo, quiero ver la invitación como pendiente y decidir si la acepto o la rechazo, para no obtener acceso a cuentas ajenas sin mi consentimiento.
- Como administrador de un grupo, quiero que el invitado tenga que aceptar antes de aparecer como miembro activo, para saber con certeza quién tiene acceso real.
- Como usuario con un estado de cuenta en XLSX, quiero importarlo directamente con el asistente manual, sin convertirlo a CSV primero.
- Como usuario que borró un movimiento por error, quiero encontrarlo en una lista de "eliminados" y restaurarlo con un clic.
- Como usuario que desactivó una categoría por error, quiero verla en la lista de categorías (marcada como desactivada) y reactivarla.

---

## 7. UX requirements

- Todo texto de UI en español, sin emojis, siguiendo componentes `@runly/ui` (`ConfirmDialog`, `EmptyState`, `Badge`, `Button`, etc.) — nada de `window.confirm`/`alert`.
- **Invitaciones pendientes**: sección "Pendientes" al inicio de `MembershipsScreen.jsx`, por encima de las secciones existentes "Grupos" y "Cuentas compartidas". Cada tarjeta pendiente muestra nombre del grupo/cuenta, quién invitó, rol asignado, y dos botones: "Aceptar" (primario) y "Rechazar" (variant ghost/destructive vía `ConfirmDialog` solo si se decide requerir confirmación — dado que es reversible mediante nueva invitación, no se requiere `ConfirmDialog` para aceptar; rechazar tampoco lo requiere por ser de bajo riesgo y explícito).
- Badge de conteo: el ítem de navegación "Mis membresías" del módulo muestra un badge numérico cuando `pendingCount > 0`. **Verificado en código**: `ModuleSidebar.jsx` (`packages/ui/src/components/ModuleSidebar.jsx`) no tiene hoy ningún mecanismo de badge por ítem de navegación — los `navItems` vienen del manifiesto estático del módulo (`module.navigation`, resuelto vía `useRuntimeModules()`), sin conteos dinámicos. El mecanismo de extensión más cercano ya existente es `MODULE_SIDEBAR_SLOTS` (`apps/desktop/src/app/sidebar-slots.js`), un registro `moduleKey → componente` que `RunlyApp.jsx` inyecta en `ModuleSidebar` vía la prop `sidebarSlot`. Este spec extiende ese mismo patrón en vez de inventar uno nuevo (ver Sección 15).
- **Importación XLSX**: en `ImportWizard.jsx`, el `DistDropZone` cambia su `accept` a `.csv,.xlsx`, sus textos de ayuda pasan de "CSV" a "CSV o XLSX", y el paso de subida ya no distingue formato ante el usuario — el parseo ocurre en servidor.
- **Movimientos eliminados**: nuevo diálogo/panel "Movimientos eliminados" accesible desde un botón en `AccountScreen.jsx` (junto a acciones existentes de la cuenta). Lista simple (fecha, nombre, depósito/retiro) con botón "Restaurar" por fila; usa `EmptyState` cuando no hay movimientos eliminados.
- **Categorías deshabilitadas**: en `CategoriesScreen.jsx`, un toggle "Mostrar desactivadas" revela una tercera sección de tabla "Desactivadas" (mismo patrón visual que las secciones "Sistema"/"Mis categorías" ya existentes), con botón "Restaurar" en vez de "Editar"/"Desactivar".

---

## 8. Routes/screens

Módulo: `runly.ledger` (core, no cambia de módulo).

| Ruta | Pantalla | Cambio |
|---|---|---|
| `/app/m/runly.ledger/memberships` | `MembershipsScreen.jsx` | Modificada: sección "Pendientes" + accept/reject |
| `/app/m/runly.ledger/accounts/:id/import` | `ImportWizard.jsx` | Modificada: acepta XLSX, sube archivo en vez de parsear en cliente |
| `/app/m/runly.ledger/accounts/:id` | `AccountScreen.jsx` | Modificada: botón/entrada a "Movimientos eliminados" (nuevo componente, sin ruta propia — diálogo) |
| `/app/m/runly.ledger/categories` | `CategoriesScreen.jsx` | Modificada: toggle + sección "Desactivadas" |

No se agregan rutas nuevas.

---

## 9. Data model

Sin tablas nuevas ni columnas nuevas. Reutiliza:

- `LedgerGroupMember.status` (String, default `"active"`) — pasa a usarse con valor `"pending"` como estado inicial de una invitación.
- `LedgerAccountMember.status` (String, default `"active"`) — ídem.
- `LedgerTransaction.enabled` (Boolean) — ya existe, ahora se expone lectura de `enabled = false` vía un nuevo endpoint de solo lectura.
- `LedgerCategory.enabled` (Boolean) — ya existe, ahora se expone lectura de `enabled = false` vía un parámetro opcional del endpoint de listado existente.

No se requiere `CHECK` constraint para el nuevo valor `"pending"`: la columna es texto libre, ya usada con valores arbitrarios (`active`/`rejected`) sin validación a nivel de base de datos.

---

## 10. Prisma impact

Ninguno. No se modifica `prisma/schema.prisma`. No se requiere migración.

---

## 11. API contract

### 11.1 Invitaciones

**Modificado** — `apps/api/src/routes/ledger/group-service.js` `inviteMember`, `apps/api/src/routes/ledger/collaboration-service.js` `inviteAccountMember`:
- El `INSERT ... VALUES (..., 'active')` pasa a `VALUES (..., 'pending')`.
- El `ON CONFLICT DO UPDATE` pasa a:
  ```sql
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = NOW(),
        status = CASE WHEN ledger_group_member.status = 'active' THEN 'active' ELSE 'pending' END
  ```
  (mismo patrón para `ledger_account_member`).
- Respuesta y permisos sin cambio (`ledger.members.write`, `minRole: 'admin'` / dueño de cuenta).

**Nuevo** — `POST /ledger/invitations/groups/:id/accept`
- Auth: sesión válida, permiso `ledger.groups.read` (igual que el endpoint de rechazo existente).
- Body: ninguno.
- Lógica: `UPDATE ledger_group_member SET status = 'active' WHERE group_id = :id AND user_id = actorId AND status = 'pending' RETURNING *`.
- Respuesta: `200 { ok: true }`.
- Errores: `404` si no hay invitación pendiente para ese usuario/grupo.

**Nuevo** — `POST /ledger/invitations/accounts/:id/accept`
- Auth: permiso `ledger.accounts.read` (igual que el rechazo existente).
- Misma lógica sobre `ledger_account_member`.
- Respuesta: `200 { ok: true }`. Errores: `404`.

**Sin cambios** — `POST /ledger/invitations/groups/:id/reject`, `POST /ledger/invitations/accounts/:id/reject` (ya funcionan sobre cualquier estado existente, incluido `pending`).

**Modificado** — `GET /ledger/memberships`:
- `listMemberships` deja de filtrar `status = 'active'` exclusivamente; devuelve también filas `status = 'pending'`.
- Se añade `LEFT JOIN user_profile` sobre `invited_by` para incluir `invited_by_name`.
- Forma de respuesta: `{ data: { groups: [...], accounts: [...] } }` donde cada fila ahora incluye `status` (`'active' | 'pending'`) e `invited_by_name`. El cliente separa "Pendientes" de "Activas" filtrando por `status` — no hay endpoint separado.

### 11.2 Importación XLSX

**Nuevo** — `POST /ledger/accounts/:id/import/parse`
- Auth: permiso `ledger.import`, más `canWriteAccount` (igual patrón que `/import/preview`).
- Content-Type: `multipart/form-data`, campo `file`.
- Lógica: detecta formato por extensión (`.csv` | `.xlsx`), llama a `parseImportBuffer(buffer, format)` de `import-service.js` (ya existente, sin cambios).
- Respuesta: `200 { rows: [...], headers: [...] }`. `rows` es el array de objetos crudos (misma forma que hoy produce el parser client-side).
- Errores: `400` si la extensión no es `.csv`/`.xlsx`, `413` si excede el límite de tamaño (mismo límite que usa `ai-import-routes.js`, `MAX_FILE_BYTES`).

**Sin cambios** — `POST /ledger/accounts/:id/import/preview`, `POST /ledger/accounts/:id/import/commit`: siguen recibiendo `{ rows, mapping }` como JSON; ahora `rows` viene de la respuesta de `/import/parse` en vez de un parseo en el navegador.

### 11.3 Restauración

**Nuevo** — `GET /ledger/accounts/:id/transactions/disabled`
- Auth: `ledger.transactions.read` (o el mismo chequeo `canReadAccount` que usa el listado normal).
- Query params: `page`, `pageSize` (misma paginación que el listado normal, sin `dateFrom`/`dateTo` ni cómputo de saldo/consecutivo).
- Lógica: nueva función `listDisabledTransactions` en `ledger-service.js` — `SELECT` plano de `ledger_transaction` filtrando `enabled = false`, sin CTE de ventana.
- Respuesta: `{ data: [...], pagination: { page, pageSize, total } }`.

**Sin cambios** — `PATCH /ledger/accounts/:id/transactions/:txId/enabled` (ya acepta `{ enabled: true }`, usado para restaurar).

**Modificado** — `GET /ledger/categories`:
- Acepta query param opcional `includeDisabled=true`.
- `listCategories` recibe `includeDisabled` y, cuando es `true`, omite el filtro `AND enabled = true`.
- Respuesta sin cambio de forma; cada fila ya incluye `enabled` (columna existente en `SELECT *`).

**Sin cambios** — `PATCH /ledger/categories/:id/enabled` (ya acepta `{ enabled: true }`).

---

## 12. SDK contract

`packages/sdk` — dominio `ledger` (o el dominio existente que agrupe estas llamadas; se usa `companyFetch` directo en las pantallas actuales para varias de estas rutas, sin pasar por un método de SDK dedicado, siguiendo el patrón ya presente en `MembershipsScreen.jsx`/`CategoriesScreen.jsx`/`ImportWizard.jsx`). No se requieren métodos nuevos de SDK: las pantallas seguirán llamando `companyFetch` contra las rutas nuevas/modificadas, igual que hacen hoy con las rutas equivalentes de rechazo/deshabilitar.

---

## 13. Validator contract

`packages/validators` — sin cambios: los endpoints de invitación no reciben body nuevo (accept/reject no llevan payload), `import/parse` recibe `multipart/form-data` (no Zod), y `includeDisabled`/paginación de `transactions/disabled` son query params simples validados inline en la ruta (mismo patrón que `dateFrom`/`dateTo`/`page`/`pageSize` en el listado normal, que tampoco usan un schema Zod dedicado).

---

## 14. Module manifest impact

Ninguno. No se agregan permisos nuevos — todas las rutas nuevas/modificadas reutilizan permisos ya declarados en el manifiesto (`ledger.groups.read`, `ledger.accounts.read`, `ledger.members.write`, `ledger.import`, `ledger.transactions.read`/`delete`, `ledger.categories.read`/`manage`). No cambia `version`, `dependencies`, ni `navigation` del manifiesto central (`apps/api/src/manifests/official/core-modules.js`).

---

## 15. Navigation impact

Ninguna entrada de navegación nueva en manifiestos (no cambia `apps/api/src/manifests/official/core-modules.js`). El badge de pendientes requiere un pequeño cambio de plomería en `@runly/ui`, siguiendo el patrón ya existente de `MODULE_SIDEBAR_SLOTS`:

1. **`packages/ui/src/components/ModuleSidebar.jsx`**: nueva prop opcional `navBadges` (`Record<fullPath, number>`). Cuando un `navItem.fullPath` (o `child.fullPath`) tiene una entrada `> 0` en `navBadges`, se renderiza un `Badge` numérico pequeño (variant existente, p. ej. `destructive` o `secondary`) al final del ítem, antes/junto al label — mismo lugar donde ya se muestra el `ChevronDown` en los grupos. Sin este mapa, el comportamiento es idéntico al actual (no rompe otros módulos).
2. **`apps/desktop/src/app/sidebar-slots.js`**: se extiende con un segundo registro paralelo `MODULE_NAV_BADGE_HOOKS: Record<moduleKey, () => Record<fullPath, number>>` (o se añade un campo `useNavBadges` junto al de `sidebarSlot` existente — decisión de implementación menor). Para `runly.ledger`, el hook consulta la misma query ya cacheada `['ledger-memberships', token]` (usada hoy por `MembershipsScreen.jsx` y `AccountsScreen.jsx`) y devuelve `{ '/app/m/runly.ledger/memberships': pendingCount }`.
3. **`apps/desktop/src/app/RunlyApp.jsx`**: donde ya calcula `sidebarSlot` (línea ~204-208) vía `MODULE_SIDEBAR_SLOTS`, añade el cálculo análogo de `navBadges` vía el nuevo registro, y lo pasa a `<ModuleSidebar navBadges={...} .../>`.

Este mecanismo es genérico (no específico de ledger) y queda disponible para cualquier módulo que en el futuro necesite un badge de navegación, sin necesitar otro spec para repetir la plomería.

---

## 16. Blueprint impact

N/A — `runly.ledger` no usa blueprints RME3 para estas pantallas (son pantallas custom React, no CRUD genérico vía `RunlyTable`/`RunlyForm`).

---

## 17. RBAC/permissions

Sin permisos nuevos. Mapa de endpoints nuevos/modificados a permisos existentes:

| Endpoint | Permiso |
|---|---|
| `POST /ledger/invitations/groups/:id/accept` | `ledger.groups.read` |
| `POST /ledger/invitations/accounts/:id/accept` | `ledger.accounts.read` |
| `POST /ledger/accounts/:id/import/parse` | `ledger.import` (+ `canWriteAccount`) |
| `GET /ledger/accounts/:id/transactions/disabled` | `ledger.transactions.read` (+ `canReadAccount`) |
| `GET /ledger/categories?includeDisabled=true` | `ledger.categories.read` o `ledger.categories.manage` (igual que el listado normal) |

---

## 18. Multi-company behavior

Sin cambios de comportamiento: todas las consultas nuevas/modificadas mantienen el filtro `company_id = ${companyId}::uuid` ya presente en las funciones de servicio existentes que se están extendiendo (`listMemberships`, `listCategories`, `listTransactions`/nueva `listDisabledTransactions`, `inviteMember`/`inviteAccountMember`). No hay acceso cruzado entre empresas en ningún endpoint nuevo.

---

## 19. Files/storage impact

N/A. El archivo subido en `POST /ledger/accounts/:id/import/parse` se procesa en memoria (buffer) y se descarta tras el parseo — no se persiste en Supabase Storage, igual que el flujo equivalente de `ai-import-routes.js`.

---

## 20. Export/import requirements

Este spec **es** el requerimiento de import: agrega soporte XLSX al asistente manual de importación de movimientos, reutilizando el parser de servidor ya usado por el import por IA (`exceljs` para XLSX, `csv-parse` para CSV). No afecta export (`export-service.js` no se toca).

---

## 21. Audit log requirements

Se seguirá el patrón ya existente en `accounts-routes.js` para movimientos (verbos `ledger.transaction.enable`/`ledger.transaction.disable` ya implementados en el endpoint `PATCH .../enabled` — la restauración de un movimiento ya genera `ledger.transaction.enable` sin cambios). Para categorías, el endpoint `PATCH /ledger/categories/:id/enabled` no genera actualmente entrada de `AuditLog` explícita más allá de lo que ya hace hoy (fuera de alcance ampliar auditoría de categorías en este spec). Para invitaciones:
- Aceptar invitación: no se agrega evento de auditoría nuevo (es una acción del propio invitado sobre su membresía, de bajo riesgo); se mantiene la notificación ya existente (`ledger.group_invite`/`ledger.account_invite`) como registro funcional del flujo.
- No se requieren cambios en `AuditLog` para este spec — ninguna de las tres features toca datos financieros de forma que requiera nueva trazabilidad más allá de la ya presente en `enable`/`disable`.

---

## 22. Edge cases

1. **Re-invitar a un miembro ya activo**: el `ON CONFLICT DO UPDATE` condicional preserva `status = 'active'` si ya lo era, para no revocar acceso accidentalmente al reenviar una invitación (p. ej. para cambiar el rol).
2. **Re-invitar a alguien que rechazó**: el `ON CONFLICT` restablece `status = 'pending'`, generando una nueva invitación pendiente (comportamiento esperado: permite reintentar).
3. **Aceptar una invitación que ya no existe** (el grupo fue eliminado o el invitador removió al usuario antes de que aceptara): `acceptGroupInvitation`/`acceptAccountInvitation` devuelven `404`, la UI muestra un toast de error y refresca la lista.
4. **Cuenta que pasa a pertenecer a un grupo mientras tiene invitaciones directas pendientes**: comportamiento sin cambios respecto al ya existente — `inviteAccountMember` ya rechaza invitar si `account.group_id` está seteado; una invitación directa pendiente previa a la migración a grupo queda huérfana de la misma forma que ya ocurre hoy con miembros directos activos (no se agrava ni se corrige en este spec).
5. **Archivo XLSX con múltiples hojas**: `parseImportBuffer` ya solo procesa `workbook.worksheets[0]` — comportamiento heredado, sin cambios.
6. **Archivo XLSX/CSV vacío o sin encabezados**: `parseImportBuffer` ya devuelve `[]` en ese caso; el wizard debe mostrar el mismo error que hoy muestra para "El archivo no tiene datos" cuando `rows.length === 0`.
7. **Restaurar un movimiento cuya cuenta fue deshabilitada mientras tanto**: `setTransactionEnabled` no valida que la cuenta esté activa (comportamiento actual sin cambios) — el movimiento se reactiva igual; no aparecerá en el registro normal si la cuenta está deshabilitada porque `AccountScreen` ya no sería accesible en ese caso.
8. **Restaurar una categoría de sistema**: no aplica — `setCategoryEnabled` ya bloquea desactivar categorías de sistema (`is_system`), por lo que nunca habrá una categoría de sistema deshabilitada que restaurar.
9. **Paginación de movimientos eliminados con miles de filas**: `listDisabledTransactions` usa la misma normalización de paginación (`normalizePagination`) que el listado normal, con el mismo tope `maxPageSize`.

---

## 23. Risks

1. **Riesgo**: el `ON CONFLICT DO UPDATE` condicional en SQL crudo (`CASE WHEN ... THEN ... ELSE ... END`) es fácil de escribir mal y romper la idempotencia de la invitación. **Mitigación**: cubrir con test unitario explícito el caso "re-invitar a miembro activo no lo regresa a pending" y "re-invitar a miembro rechazado sí lo regresa a pending".
2. **Riesgo**: cambiar `listMemberships` para incluir filas `pending` podría romper el conteo `member_count` de grupos (que ya filtra `status = 'active'` correctamente vía `FILTER (WHERE gm2.status = 'active')` — no se toca esa subconsulta) o el listado de "Cuentas compartidas" activas si no se filtra bien en el cliente. **Mitigación**: el cliente filtra explícitamente por `status` antes de renderizar cada sección; test de `listMemberships` verifica que ambas listas (pending/active) vienen correctamente pobladas.
3. **Riesgo**: mover el parseo de CSV del cliente al servidor cambia la ruta de error para archivos malformados (mensajes de `csv-parse`/`exceljs` en vez de los mensajes ad-hoc del parser manual). **Mitigación**: envolver errores de parseo en `LedgerServiceError` con mensaje genérico en español, igual que ya hace `parseImportBuffer` al lanzar `'Formato no soportado. Use CSV o XLSX.'`.
4. **Riesgo**: agregar un endpoint de solo lectura de movimientos deshabilitados por cuenta sin límite de scope temporal podría crecer sin cota en cuentas con mucho historial de borrados. **Mitigación**: paginación obligatoria, mismo `maxPageSize` que el listado normal.

---

## 24. Acceptance criteria

1. Dado un admin de grupo que invita a un usuario, cuando la invitación se crea, entonces el estado de la membresía es `pending` y el invitado no tiene acceso al grupo hasta aceptar.
2. Dado un usuario con una invitación pendiente a un grupo, cuando llama `POST /ledger/invitations/groups/:id/accept`, entonces su membresía pasa a `active` y obtiene acceso inmediato según su rol.
3. Dado un usuario con una invitación pendiente a una cuenta directa, cuando llama `POST /ledger/invitations/accounts/:id/accept`, entonces su membresía pasa a `active`.
4. Dado un usuario con invitaciones pendientes, cuando visita `MembershipsScreen.jsx`, entonces ve una sección "Pendientes" separada de sus membresías activas, con botones para aceptar/rechazar.
5. Dado un usuario con invitaciones pendientes, cuando el ítem de navegación "Mis membresías" se renderiza, entonces muestra un badge con el conteo de pendientes.
6. Dado un archivo `.xlsx` válido de movimientos bancarios, cuando se sube al `ImportWizard.jsx`, entonces el asistente detecta encabezados y filas igual que hoy lo hace con CSV, permitiendo mapear columnas y previsualizar.
7. Dado un archivo con extensión distinta a `.csv`/`.xlsx`, cuando se intenta subir, entonces se rechaza con un mensaje de error claro, sin llamar al backend.
8. Dado un movimiento deshabilitado (`enabled = false`), cuando el usuario abre "Movimientos eliminados" en `AccountScreen.jsx`, entonces lo ve listado y puede restaurarlo con un clic, tras lo cual vuelve a aparecer en el registro normal de la cuenta.
9. Dado una categoría personal deshabilitada, cuando el usuario activa "Mostrar desactivadas" en `CategoriesScreen.jsx`, entonces la ve en una sección "Desactivadas" con botón "Restaurar", tras el cual vuelve a aparecer disponible para nuevos movimientos.
10. Dado un miembro ya activo de un grupo, cuando un admin lo "reinvita" (mismo flujo de invitar), entonces su estado permanece `active` (no regresa a `pending`).

---

## 25. Verification plan

```bash
# Backend unit tests (Node test runner)
node --test apps/api/src/routes/ledger/__tests__/group-service.test.js
node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js
node --test apps/api/src/routes/ledger/__tests__/ledger-service.test.js
node --test apps/api/src/routes/ledger/__tests__/categories-service.test.js   # nuevo
node --test apps/api/src/routes/ledger/__tests__/import-service.test.js      # nuevo

# Syntax checks on every touched file
node --check apps/api/src/routes/ledger/group-service.js
node --check apps/api/src/routes/ledger/collaboration-service.js
node --check apps/api/src/routes/ledger/ledger-service.js
node --check apps/api/src/routes/ledger/categories-service.js
node --check apps/api/src/routes/ledger/import-service.js
node --check apps/api/src/routes/ledger/groups-routes.js
node --check apps/api/src/routes/ledger/collaboration-routes.js
node --check apps/api/src/routes/ledger/accounts-routes.js
node --check apps/api/src/routes/ledger/categories-routes.js

# Lint + build
pnpm lint
pnpm build

# Manual verification in the running app (dev server)
pnpm dev
# - Invitar a un usuario de prueba a un grupo, confirmar status=pending y sin acceso previo a aceptar.
# - Aceptar desde una segunda sesión/usuario, confirmar acceso inmediato.
# - Rechazar una invitación pendiente, confirmar que no otorga acceso.
# - Subir un .xlsx real exportado de un banco/Excel al ImportWizard, confirmar mapeo y commit exitoso.
# - Eliminar un movimiento, abrir "Movimientos eliminados", restaurarlo, confirmar que reaparece en el registro.
# - Desactivar una categoría personal, activar "Mostrar desactivadas", restaurarla, confirmar que vuelve a estar disponible.
```

---

## 26. Rollback plan

No hay migraciones de base de datos involucradas (Sección 10), por lo que el rollback es puramente de código: revertir el commit/PR. Si ya se aceptaron invitaciones reales bajo el nuevo flujo antes de un rollback, esas filas quedan con `status = 'active'` (mismo valor que el comportamiento anterior), por lo que no hay pérdida de acceso ni estado inconsistente al revertir. No se requiere migración de reversión.

---

## 27. Future enhancements

- Expiración automática de invitaciones pendientes tras N días (explícitamente fuera de alcance, Sección 5).
- Restauración de cuentas deshabilitadas (mismo patrón que movimientos/categorías, diferido).
- Notificación al invitador cuando el invitado acepta o rechaza.
- Toggle "mostrar deshabilitadas" integrado directamente en el registro de movimientos (`DesktopTransactionTable.jsx`) en vez de un diálogo separado, si en el futuro se decide incluir movimientos deshabilitados en el cálculo de saldo con una marca visual en vez de excluirlos.

---

## 28. Open questions

Ninguna — todas las decisiones de alcance fueron confirmadas durante la fase de brainstorming (sequenciación combinada, alcance de invitaciones a ambos mecanismos de colaboración, sin expiración, ubicación de la UI de pendientes, parseo XLSX en servidor, alcance de restauración limitado a movimientos y categorías).
