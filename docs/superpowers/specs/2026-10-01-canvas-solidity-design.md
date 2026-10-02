# Runly Canvas — solidez: realtime con deltas, conflictos, cursores, versiones y miniaturas

## 1. Feature title

Canvas Fase 1 — colaboración sólida y visibilidad del trabajo.

## 2. Status

Approved (decisión delegada por el usuario, 2026-10-01).

## 3. Context

Segunda iniciativa del roadmap de mejora de `runly.canvas` (orden acordado:
plantillas → **solidez** → capa de datos → herramientas de plano → mapas →
migración POS). La capa de datos (siguiente fase) necesita que los cambios
remotos lleguen sin recargar toda la página.

Infraestructura existente reutilizada:

- `broadcaster.broadcastToChannel` (servidor → `canvas:board:<id>`).
- Relay `POST /realtime/broadcast` y heartbeat `POST /realtime/presence`
  (`realtime-access-service.js`), usados por el wrapper
  `apps/desktop/src/lib/authorizedRealtime.js`. Los envíos de clientes pasan
  por Hono, que valida `runly_canvas_user_access(..., edit)`.
- Endpoints de versiones ya existentes en `canvas-routes.js`.

## 4. Problem

1. Cualquier evento `canvas.changed` invalida el Board completo y todos los
   objetos de todas las páginas: cada movimiento de un colaborador provoca
   un refetch completo.
2. `batchObjects` es todo-o-nada: un conflicto de revisión en una operación
   revierte el lote entero y el cliente sólo invalida la caché, perdiendo los
   cambios no conflictivos.
3. No se ve dónde trabajan los demás (sin cursores ni selección remota).
4. Las versiones tienen API pero no interfaz.
5. `thumbnailFileId` nunca se genera: las tarjetas de Boards no muestran
   vista previa. Además `updateBoard` acepta cualquier `thumbnailFileId` sin
   validar que el archivo pertenezca a la empresa.

## 5. Goals

1. Los cambios de objetos se propagan como deltas y se aplican a la caché
   sin refetch; los demás eventos invalidan sólo la consulta afectada.
2. Un lote aplica todas las operaciones válidas y reporta los conflictos por
   objeto con la versión vigente del servidor.
3. Los colaboradores ven cursores con nombre y la selección de los demás en
   la misma página.
4. Panel "Versiones": listar, guardar y restaurar con confirmación.
5. Miniatura automática por Board, visible en la lista de Boards.

## 6. Non-goals

1. CRDT / merge de un mismo objeto editado a la vez (sigue revisión optimista).
2. Seguir el viewport de otro usuario ("follow mode").
3. Diff visual entre versiones.
4. Miniaturas generadas en servidor.
5. Cambios a la autorización Realtime (no se añaden políticas INSERT).
6. Optimizar el número de consultas del relay (posible caché futura).

## 7. User stories

1. Como editor, quiero ver al instante lo que mueve mi compañero sin que mi
   lienzo parpadee ni recargue.
2. Como editor, si muevo un objeto que otra persona acaba de cambiar, quiero
   que mis demás cambios se guarden y que se me avise cuál no.
3. Como colaborador, quiero ver el cursor y la selección de los demás con su
   nombre para no pisarnos.
4. Como propietario, quiero guardar una versión con nombre antes de un cambio
   grande y poder volver a ella.
5. Como usuario, quiero reconocer mis Boards por su miniatura en la lista.

## 8. UX requirements

- Cursores remotos: flecha + etiqueta con el nombre, color estable por
  usuario (paleta de 8 colores por hash del id). Sólo para usuarios en la
  misma página. Desaparecen tras 10 s sin actualización o al salir.
- Selección remota: contorno discontinuo del color del usuario alrededor de
  cada objeto que tiene seleccionado.
- Conflictos: toast de advertencia "Otra persona cambió N elemento(s); se
  cargó su versión más reciente." El objeto muestra la versión del servidor.
- Versiones: botón "Versiones" (ícono History) en la barra superior abre un
  `Sheet` lateral (header fijo, lista con scroll):
  - Formulario "Guardar versión" (nombre opcional, máx. 200) para EDITOR/OWNER.
  - Lista: "Versión N", nombre, autor, fecha relativa, número de elementos,
    insignia "Restaurada" si aplica, insignia "Actual" para
    `currentVersionId`.
  - "Restaurar" sólo OWNER, con `ConfirmDialog`: "Se reemplazará el
    contenido del Board por la versión N. Se guardará antes una versión
    automática del estado actual." Restaurar crea primero esa versión
    ("Antes de restaurar la versión N").
  - Estados: `Skeleton` al cargar, `EmptyState` sin versiones, `ErrorState`.
- Miniaturas: imagen 16:9 `object-cover` en la tarjeta; si no hay o falla,
  se mantiene el ícono de plantilla actual.
- Textos en español, sin emojis, componentes `@runly/ui`.

## 9. Routes/screens

Sin rutas nuevas. `/app/m/runly.canvas` (`CanvasHome`, `BoardCard`) y
`/app/m/runly.canvas/:boardId` (`BoardEditor`, `EditorTopBar`, nuevo
`VersionsSheet`, `CanvasViewport`).

## 10. Data model

Sin tablas ni columnas nuevas. Formas nuevas:

- Resultado de batch: se añade `{ op: 'conflict', id, object: Row | null }`
  (`null` = el objeto ya no existe).
- Evento `canvas.changed` con `action: 'objects.changed'`:
  `{ boardId, action, upserts?: Row[], deletedIds?: string[], refetch?: true }`.
  `upserts`/`deletedIds` sólo si el JSON pesa ≤ 200 000 caracteres; si no,
  `refetch: true`.
- Evento efímero `cursor` (relay cliente):
  `{ pageId, x, y, selectedIds: string[] }` (`x`/`y` `null` = fuera del
  lienzo). El relay añade `actorId` (sobrescribe cualquier valor del cliente).
- `listVersions` añade `createdByName`.

## 11. Prisma impact

N/A. Sin migración.

## 12. API contract

- `POST /canvas/boards/:id/objects/batch` — respuesta `{ data: Result[] }`.
  Las operaciones `update`/`delete`/`restore` con revisión desfasada o
  objeto inexistente ya no abortan el lote: devuelven `op: 'conflict'`.
  Errores de validación siguen abortando con 400.
- `PATCH /canvas/boards/:id` — `thumbnailFileId` debe ser un `FileAsset`
  habilitado subido para ese Board (`moduleKey = 'runly.canvas'`,
  `entityType = 'CanvasBoard'`, `entityId = boardId`; el Board ya está acotado
  a la empresa activa) o `null`; si no,
  404 "Archivo no encontrado.". Al reemplazarlo, el anterior se deshabilita
  (`enabled: false`).
- `POST /canvas/boards/:id/versions` — sin cambio de forma. Retención: tras
  crear, si hay más de 100 versiones se borran las más antiguas que no sean
  `currentVersionId`.
- `POST /canvas/boards/:id/versions/:versionId/restore` — crea antes una
  versión automática del estado actual dentro de la misma transacción.
- `GET /canvas/boards/:id/versions` — cada fila añade `createdByName`.
- `POST /realtime/broadcast` — para topics `canvas:board:*` el payload se
  reenvía con `actorId` del usuario autenticado.

## 13. SDK contract

Sin métodos nuevos (`listVersions`, `createVersion`, `restoreVersion` ya
existen en `packages/sdk/src/domains/canvas.js`; verificar y añadir si faltan
con las firmas `(boardId, token)`, `(boardId, data, token)`,
`(boardId, versionId, token)`).

## 14. Validator contract

N/A.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

Sin permisos nuevos. Versiones: `canvas.version.view|create|restore` (ya
existen) + ACL (crear: EDITOR, restaurar: OWNER). Cursores: el relay ya exige
acceso de edición al Board (`edit = true`), por lo que VIEWER/COMMENTER no
emiten cursores pero sí los reciben.

## 19. Multi-company behavior

Sin cambios: todo acceso parte de `assertBoardAccess` con empresa activa. La
validación nueva de `thumbnailFileId` cierra un hueco de aislamiento.

## 20. Files/storage impact

Miniatura: PNG 640×360 subido con el flujo existente de Files
(`moduleKey=runly.canvas`, `entityType=CanvasBoard`, `entityId=boardId`).
Se genera en el cliente; las imágenes del Board se cargan para la miniatura
con `fetch` CORS + `createImageBitmap`; si fallan se dibujan como
marcadores. Si el canvas queda contaminado, la miniatura se genera sin
imágenes.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

`BOARD_VERSION_CREATED` y `BOARD_VERSION_RESTORED` ya existen; la versión
automática previa a restaurar registra `BOARD_VERSION_CREATED` con
`metadata.automatic = true`. Conflictos y cursores no se auditan.

## 23. Edge cases

1. El emisor recibe su propio delta: se ignora si la fila en caché tiene
   revisión ≥ la recibida (idempotente).
2. Delta de una página que el usuario no tiene cargada: se descarta.
3. Una fila actualizada sin `hotspot` incluido conserva el `hotspot` de la
   caché.
4. Conflicto en una fila aún `pending` (creación en vuelo): no aplica; las
   creaciones no producen conflicto.
5. Deshacer/rehacer que recibe conflictos: se revierte el paso de historial y
   se avisa "Otra persona cambió este elemento; no se pudo deshacer.".
6. Cursores cuando el usuario está solo: no se envían (sin otros en
   presencia).
7. Lote de más de 200 000 caracteres: se emite `refetch` y los clientes
   invalidan los objetos.
8. Miniatura con Board vacío: no se genera.
9. Usuario sin permiso de edición: no genera miniaturas.
10. Restaurar mientras otros editan: el evento `version.restored` invalida
    Board, objetos y vínculos en todos los clientes y se limpia la selección.

## 24. Risks

1. Carga del relay por cursores (cada envío valida acceso en BD) → envío
   throttled a 1 cada 120 ms, sólo con colaboradores presentes y sólo
   mientras el puntero se mueve.
2. Tamaño de mensajes Realtime → umbral de 200 000 caracteres con
   `refetch` como alternativa.
3. CORS del storage impide imágenes en miniaturas → fallback a marcadores.
4. Archivos de miniatura antiguos → se deshabilitan al reemplazarse;
   generación máxima 1 por minuto por sesión.

## 25. Acceptance criteria

1. Dado un lote con una actualización válida y otra con revisión desfasada,
   cuando se envía, entonces la válida se guarda y la otra vuelve como
   `conflict` con la fila vigente.
2. Dado un lote de 3 actualizaciones, cuando termina, entonces el evento
   `objects.changed` lleva las 3 filas en `upserts`.
3. Dado un cliente con la página cargada, cuando recibe un `upserts` con
   revisión mayor, entonces la fila en caché se reemplaza sin refetch; con
   revisión igual o menor, no cambia.
4. Dado un evento `hotspot.updated`, cuando llega, entonces sólo se
   invalidan las consultas de objetos del Board.
5. Dados dos editores en la misma página, cuando uno mueve el puntero,
   entonces el otro ve su cursor con su nombre en ≤ 0,5 s.
6. Dado el panel Versiones, cuando un editor guarda "Antes de reordenar",
   entonces aparece arriba como "Versión N".
7. Dado un OWNER que restaura la versión 2, cuando confirma, entonces existe
   una versión automática previa y el lienzo muestra el contenido de la 2.
8. Dado un `thumbnailFileId` que no fue subido para ese Board, cuando se hace
   PATCH, entonces responde 404.
9. Dado un Board editado, cuando pasan 8 s sin guardar cambios, entonces se
   sube una miniatura y la tarjeta del Board la muestra.

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/api/src/services/__tests__/realtime-access-service.test.js`
  (si existe; si no, crear test focalizado del sello `actorId`).
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` sobre archivos tocados; `pnpm --filter ./apps/desktop build:web`.
- Smoke manual con dos sesiones (dos navegadores) sobre el dev server
  existente: deltas, conflicto, cursores, versiones, miniatura.

## 27. Rollback plan

Sin migraciones. Revertir los commits. Los clientes antiguos ignoran los
campos nuevos del evento y siguen invalidando; el cliente nuevo frente a una
API antigua no recibe `upserts` y cae al refetch.

## 28. Future enhancements

1. Caché corta de autorización en el relay para cursores.
2. Seguir a un colaborador (follow mode) y viewport remoto.
3. Diff visual entre versiones y versiones automáticas periódicas.
4. Miniaturas por página.
5. Interpolación de cursores.
