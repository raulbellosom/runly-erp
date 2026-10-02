# Runly Canvas — eliminar Boards por completo y renombrar páginas

## 1. Feature title

Eliminar un Board con todo su contenido; renombrar y eliminar páginas; renombrar Boards.

## 2. Status

Approved (pedido del usuario, 2026-10-02).

## 3. Context

`DELETE /canvas/boards/:id` sólo archiva (`archivedAt`) y ninguna pantalla lo
usa. Las páginas se crean pero no se pueden renombrar ni eliminar desde la
interfaz (la API ya admite `PATCH`/`DELETE` de página). Los archivos subidos
para un Board (imágenes, PDF, portadas, adjuntos de hotspots) viven en Files
con `entityId = companyId` y `metadata.sourceEntityId = <boardId | hotspotId>`.
Los enlaces públicos viven en `module_public_link` (`moduleKey runly.canvas`,
`recordId = boardId`); los comentarios en `entity_comment`
(`CanvasBoard`/`CanvasHotspot`).

## 4. Problem

1. No hay forma de eliminar un Board; archivar deja todo ocupando espacio.
2. No se pueden renombrar ni eliminar páginas ni renombrar el Board desde el
   editor.

## 5. Goals

1. **Eliminar Board** (sólo propietario): borra Board, páginas, capas,
   objetos, hotspots, vínculos, adjuntos, versiones, colaboradores,
   comentarios, enlaces públicos y los archivos subidos para el Board o sus
   hotspots (almacenamiento + filas), en una operación. Auditoría
   `BOARD_DELETED` con nombre y conteos.
2. Archivos referenciados por elementos de bibliotecas (`canvas_library_item.payload`)
   no se borran (se conservan para no romper la biblioteca).
3. Desde la lista (menú de la tarjeta) y desde el editor (menú "Más" de la
   barra superior): **Renombrar Board** y **Eliminar Board**.
4. En el panel de páginas: menú por página con **Renombrar** (edición en la
   misma fila) y **Eliminar** (no permitido si es la única).

## 6. Non-goals

1. Papelera/recuperación (la eliminación es definitiva; se advierte).
2. Reordenar páginas.

## 7. User stories

1. Como propietario, quiero eliminar un Board de prueba y que no quede nada.
2. Como editor, quiero llamar a mis páginas "Planta baja" y "Azotea".

## 8. UX requirements

- Tarjeta de Board: botón "Más opciones" (`MoreVertical`, visible al pasar el
  cursor en desktop y siempre en táctil) con `DropdownMenu`: Abrir,
  Renombrar (dueño/editor), Eliminar (sólo dueño, destructivo).
- Editor: botón "Más" en la barra superior con Renombrar Board (editores) y
  Eliminar Board (dueño).
- Renombrar Board: `Dialog` con `TextField` (1–200), Guardar.
- Eliminar Board: `ConfirmDialog` destructivo: título "Eliminar «Nombre»",
  descripción "Se eliminarán sus páginas, elementos, hotspots, versiones,
  comentarios, enlaces públicos y archivos. Esta acción no se puede deshacer.",
  y el usuario debe escribir el nombre del Board para habilitar "Eliminar".
  Desde el editor, al terminar vuelve a la lista con toast "Board eliminado".
- Página: menú `MoreHorizontal` en la fila (visible al pasar el cursor /
  siempre en táctil): Renombrar → la fila se vuelve un `Input` (Enter guarda,
  Esc cancela, 1–200 caracteres); Eliminar → `ConfirmDialog` ("Se eliminarán
  sus capas y elementos."), deshabilitado si es la única página.
- Otros colaboradores con el Board abierto: reciben `board.deleted` y vuelven
  a la lista con toast "Este Board fue eliminado".

## 9. Routes/screens

`/app/m/runly.canvas` (`BoardCard`), `/app/m/runly.canvas/:boardId`
(`EditorTopBar`, panel de páginas).

## 10. Data model

Sin cambios.

## 11. Prisma impact

N/A (sin migración).

## 12. API contract

- `DELETE /canvas/boards/:id` — `canvas.delete` + ACL OWNER. Ahora elimina
  definitivamente (antes archivaba). Respuesta 204. Emite `board.deleted`.
- `PATCH /canvas/boards/:id` `{ name }` y `PATCH/DELETE .../pages/:pageId`
  existentes.

## 13. SDK contract

`runly.canvas.deleteBoard(boardId, token)` (alias de la llamada `DELETE`
existente; `archiveBoard` se elimina del SDK si nada más la usa).

## 14–17

N/A.

## 18. RBAC/permissions

`canvas.delete` + propietario para eliminar; `canvas.edit` + EDITOR para
renombrar Board y páginas.

## 19. Multi-company behavior

Todo acotado por `companyId`; archivos por `entityId = companyId` y
`sourceEntityId`.

## 20. Files/storage impact

Se borran del almacenamiento y de `file_asset` los archivos `runly.canvas`
con `sourceEntityId` = Board o cualquiera de sus hotspots (tipos
`CanvasBoard`, `CanvasThumbnail`, `CanvasHotspot`), salvo los referenciados
por elementos de bibliotecas. Fallos de almacenamiento se registran pero no
bloquean el borrado de datos (se reintenta borrar las filas igualmente sólo
si el objeto ya no existe; si el almacenamiento falla, la fila del archivo se
deshabilita).

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

`BOARD_DELETED` con `before: { name, templateType }` y
`metadata: { pages, objects, hotspots, files }`.

## 23. Edge cases

1. Board ya eliminado / de otra empresa: 404.
2. Colaborador no dueño: 403.
3. Board con muchas versiones/objetos: el borrado de filas va en cascada en
   una transacción; los archivos se borran después.
4. Renombrar página con nombre vacío: no se guarda.

## 24. Risks

1. Borrado definitivo accidental → confirmación escribiendo el nombre.

## 25. Acceptance criteria

1. Dado un Board con imágenes y un hotspot con adjunto, cuando el dueño lo
   elimina, entonces no quedan filas del Board ni archivos con su
   `sourceEntityId` (salvo los usados por bibliotecas) y existe
   `BOARD_DELETED`.
2. Dado un editor no dueño, cuando intenta eliminar, entonces 403.
3. Dada una página renombrada a "Azotea", entonces el panel y el subtítulo del
   editor la muestran.

## 26. Verification plan

`node --test apps/api/src/routes/canvas/__tests__/*.test.js`,
`node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`,
`npx eslint` de archivos tocados, `node --check apps/api/src/index.js`,
`pnpm --filter ./apps/desktop build:web`.

## 27. Rollback plan

Revertir commits (los Boards ya eliminados no se recuperan).

## 28. Future enhancements

1. Papelera con recuperación por 30 días.
2. Reordenar páginas arrastrando.
