# Runly Canvas — bibliotecas de elementos (Excalidraw, SVG y propias)

## 1. Feature title

Bibliotecas de Canvas: importar `.excalidrawlib`, iconos SVG (sueltos o ZIP) y guardar elementos propios para reutilizarlos.

## 2. Status

Complete — Verified: 2026-10-02 (node --test API 81/81 y desktop 131/131, pnpm db:generate, eslint, build:web). Migración 20261002120000_canvas_libraries escrita pero NO aplicada; smoke manual pendiente.

## 3. Context

Canvas sólo ofrece formas básicas, texto, hotspots e imágenes. Para
diagramas específicos (redes, nube, eléctricos, UML) los usuarios necesitan
recursos gráficos. Excalidraw publica bibliotecas comunitarias en formato
`.excalidrawlib` (JSON); los fabricantes publican paquetes de iconos SVG
(AWS, Azure, Cisco…). Cada biblioteca externa tiene su propia licencia: Runly
no incluye ninguna; el usuario las importa.

## 4. Problem

1. No hay forma de traer recursos gráficos especializados.
2. No se pueden reutilizar composiciones propias entre Boards.

## 5. Goals

1. Bibliotecas **personales** o **de la empresa**, con nombre y elementos.
2. Importar `.excalidrawlib` (v1 y v2) convirtiendo sus elementos a objetos
   de Canvas (rectángulos, elipses, rombos, líneas, flechas, textos; trazo
   libre simplificado a segmentos).
3. Importar iconos `.svg` (uno o varios) y `.zip` con SVG: cada icono se sube
   a Files (saneado) y queda como elemento de imagen.
4. Guardar la selección actual como elemento de una biblioteca.
5. Panel "Biblioteca" con buscador para insertar con clic (centro de la vista)
   o arrastrando al lienzo (desktop).

## 6. Non-goals

1. Catálogo integrado de bibliotecas de terceros o descarga desde URL.
2. Exportar bibliotecas.
3. Editar un elemento de biblioteca in situ (se borra y se vuelve a guardar).
4. Imágenes incrustadas de Excalidraw (`image` elements) — se omiten.

## 7. User stories

1. Como ingeniero de TI, quiero importar la biblioteca de redes de Excalidraw
   y dibujar el diagrama de mi oficina.
2. Como arquitecto de nube, quiero subir el ZIP de iconos de AWS y usarlos en
   varios Boards.
3. Como coordinador, quiero guardar mi "kit de señalética" y que todo el
   equipo lo use.

## 8. UX requirements

- Botón "Biblioteca" (ícono `Library`) en la barra inferior (editores) abre
  un panel lateral (`Sheet` derecho; header fijo con buscador y botones
  "Nueva" e "Importar"; contenido con scroll).
- Secciones plegables por biblioteca con insignia "Empresa"/"Personal",
  contador y menú (Renombrar, Cambiar a Empresa/Personal, Eliminar con
  `ConfirmDialog`). Rejilla de miniaturas (96 px) con nombre; clic inserta;
  arrastrar al lienzo inserta en el punto (desktop).
- Importar: selector de archivos (`.excalidrawlib,.json,.svg,.zip`, varios);
  si no hay biblioteca elegida, crea una con el nombre del archivo. Resumen
  final: "Se importaron N elementos (M omitidos)".
- "Guardar en biblioteca" en el menú de acciones rápidas y en el inspector:
  diálogo con biblioteca destino (`SelectField`, o "Nueva biblioteca…") y
  nombre del elemento.
- Vacío: `EmptyState` "Aún no tienes bibliotecas" con botones "Importar" y
  "Nueva biblioteca", y una línea: "Puedes descargar bibliotecas de
  libraries.excalidraw.com (revisa la licencia de cada una)."
- Textos en español, sin emojis.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` — nuevo `LibraryPanel`, diálogos.

## 10. Data model

Nuevas tablas:

- `canvas_library`: `id uuid PK default uuidv7()`, `company_id uuid FK
  company`, `owner_id uuid FK user_profile`, `name text`, `scope text CHECK
  IN ('PERSONAL','COMPANY')`, `source text` (`custom|excalidraw|svg|mixed`),
  `created_at`, `updated_at`. Índice `(company_id, scope)`.
- `canvas_library_item`: `id uuid PK`, `library_id uuid FK canvas_library ON
  DELETE CASCADE`, `name text`, `kind text CHECK IN ('objects','image')`,
  `payload jsonb` (kind `objects`: `{ objects: [...], width, height }` con
  coordenadas relativas a (0,0)), `file_asset_id uuid FK file_asset ON DELETE
  SET NULL` (kind `image`), `width double precision`, `height double
  precision`, `position int`, `created_by_id uuid FK user_profile`,
  `created_at`. Índice `(library_id, position)`.
- `REVOKE ALL ... FROM anon, authenticated` como el resto de Canvas.

## 11. Prisma impact

Modelos nuevos `CanvasLibrary`, `CanvasLibraryItem` y nueva migración
`20261002120000_canvas_libraries`. `CanvasLibraryItem` también relacionado
con `FileAsset`.

## 12. API contract

Base `/canvas/libraries` (permiso `canvas.view` para leer):

- `GET /canvas/libraries` → bibliotecas visibles (propias personales +
  todas las de empresa) con `itemCount`, `canEdit`.
- `GET /canvas/libraries/:id/items` → elementos ordenados.
- `POST /canvas/libraries` `{ name, scope }` — `canvas.create`; scope
  `COMPANY` exige además `canvas.manage`.
- `PATCH /canvas/libraries/:id` `{ name?, scope? }` — dueño (personal) o
  `canvas.manage` (empresa o al cambiar a empresa).
- `DELETE /canvas/libraries/:id` — mismas reglas; deshabilita los
  `FileAsset` de sus elementos `image`.
- `POST /canvas/libraries/:id/items` `{ items: [...] }` (1–500) — mismas
  reglas de edición; valida cada objeto con `validateCanvasObject` (máx. 300
  objetos por elemento, payload ≤ 1 MB) y que `file_asset_id` sea un archivo
  habilitado subido para esa biblioteca (`moduleKey runly.canvas`,
  `entityType CanvasLibrary`, `entityId = libraryId`).
- `PATCH /canvas/libraries/:id/items/:itemId` `{ name }`;
  `DELETE /canvas/libraries/:id/items/:itemId`.
- Files: `CanvasLibrary` añadido a las entidades de módulo que conservan
  alcance de empresa.

Errores: 400 validación, 403 sin permiso, 404 fuera de la empresa.

## 13. SDK contract

`runly.canvas.listLibraries`, `createLibrary`, `updateLibrary`,
`deleteLibrary`, `listLibraryItems`, `addLibraryItems`, `renameLibraryItem`,
`deleteLibraryItem`.

## 14. Validator contract

N/A (validación en el servicio).

## 15–17

N/A.

## 18. RBAC/permissions

Sin permisos nuevos: `canvas.view` (leer), `canvas.create` (crear/editar
personales propias), `canvas.manage` (bibliotecas de empresa).

## 19. Multi-company behavior

Todo filtrado por `company_id`; las personales sólo las ve su dueño.

## 20. Files/storage impact

SVG importados se suben como `FileAsset` (`runly.canvas/CanvasLibrary/<id>`),
saneados en el cliente (sin `<script>`, `<foreignObject>`, atributos `on*`
ni `href` externos). Al insertar se reutiliza el mismo `fileId` (sin
duplicar bytes).

## 21. Export/import requirements

Importación de `.excalidrawlib` v1 (`library: Element[][]`) y v2
(`libraryItems: [{ name, elements }]`), `.svg` y `.zip` (sólo `.svg` de
dentro, máx. 300 archivos, 2 MB por SVG).

## 22. Audit log requirements

`LIBRARY_CREATED`, `LIBRARY_DELETED` y `LIBRARY_ITEMS_ADDED` (con conteo) en
`AuditLog` (`moduleKey runly.canvas`).

## 23. Edge cases

1. Elementos de Excalidraw desconocidos o `image`: se omiten y se cuentan.
2. `isDeleted: true` en Excalidraw: se omite.
3. Líneas de varios puntos: un segmento por tramo; la punta de flecha sólo en
   el último.
4. Colores `transparent`: sin relleno / sin trazo.
5. SVG sin `width/height`: se usa `viewBox`; sin ninguno, 64 × 64.
6. Hotspots guardados en biblioteca: se guardan como su objeto; al insertar
   se crea un hotspot nuevo con título "Hotspot".
7. Insertar en una página sin capa de dibujo disponible: aviso.

## 24. Risks

1. SVG maliciosos → saneado + se muestran sólo como `<img>`/canvas.
2. Bibliotecas grandes → paginación por biblioteca no necesaria en v1; límite
   500 elementos por petición de alta.

## 25. Acceptance criteria

1. Dado un `.excalidrawlib` v2 con un rectángulo y una flecha de 3 puntos,
   cuando se importa, entonces el elemento tiene 1 rectángulo y 2 segmentos
   (el último con punta).
2. Dado un ZIP con 3 SVG y un PNG, entonces se importan 3 elementos y 1
   omitido.
3. Dada una selección de 4 objetos, cuando se guarda en biblioteca y se
   inserta en otro Board, entonces aparecen los 4 con las mismas posiciones
   relativas.
4. Dado un usuario sin `canvas.manage`, cuando crea una biblioteca de
   empresa, entonces 403.
5. Dado un elemento `image` cuyo `file_asset_id` pertenece a otra biblioteca,
   entonces 400.

## 26. Verification plan

`node --test apps/api/src/routes/canvas/__tests__/*.test.js`,
`node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`,
`pnpm db:generate` (sin aplicar migraciones a bases compartidas sin
indicación), `npx eslint` de archivos tocados, `node --check
apps/api/src/index.js`, `pnpm --filter ./apps/desktop build:web`.

## 27. Rollback plan

Migración nueva y aditiva; para revertir, una migración hacia adelante que
elimine las dos tablas (sin tocar otras). Revertir commits de código.

## 28. Future enhancements

1. Exportar bibliotecas (`.excalidrawlib` y JSON de Runly).
2. Catálogo curado con licencias verificadas.
3. Importar desde URL.
4. Editar elementos de biblioteca.
