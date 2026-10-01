# Runly Canvas — auditoría y especificación de fundación

Fecha: 2026-10-01

## Auditoría del repositorio

Runly es un monorepo JavaScript con Hono en `apps/api`, React/Vite/Tauri en
`apps/desktop`, un SDK compartido en `packages/sdk` y PostgreSQL administrado
con Prisma. Los módulos oficiales se registran como manifests core, montan un
router autenticado en la API, exponen un dominio en el SDK y resuelven sus
pantallas en `ModuleOutlet`. Los módulos RME3 instalados viven fuera del código
versionado, por lo que Canvas no debe implementarse en `modules/custom`.

Infraestructura reutilizada:

- `requirePermission` y el contexto activo de empresa para RBAC y tenant.
- ACL de recurso, siguiendo el patrón owner/member de Proyectos.
- `AuditLog` para acciones importantes, sin crear otro ledger de auditoría.
- `FileAsset` y URLs firmadas para bytes; Canvas sólo guarda asociaciones.
- `EntityComment` para comentarios sobre Board y Hotspot.
- el relay Realtime, los canales privados versionados y el broadcaster actual.
- TanStack Query, Zustand, `@runly/ui` y el cliente `runly` del SDK.

Conflictos y riesgos encontrados:

1. `modules/custom` está ignorado y es contenido de instancia; un módulo
   oficial debe vivir en API/desktop/SDK y declarar un manifest oficial.
2. La autorización Realtime se cachea al conectar. Runly ya soluciona la
   revocación incorporando una revisión al topic; Canvas debe participar en
   esa rotación al cambiar colaboradores o empresa.
3. Presence no sirve para cursores de alta frecuencia. Presence queda para
   participantes conectados; cursor/selección/viewport usan Broadcast
   limitado y no PostgreSQL.
4. `FileAsset` representa el archivo y su aislamiento; duplicar bytes o URLs
   permanentes en Canvas rompería el modelo de seguridad.
5. Los destinos oficiales de relaciones tienen validadores tenant-aware, pero
   los módulos RME3 arbitrarios aún no ofrecen un resolver genérico estable.
   La interfaz de Entity Link admite cualquier `moduleKey/entityType/entityId`,
   pero la API sólo materializa destinos que un resolver autorizado confirme.

## Decisiones arquitectónicas

### Persistencia híbrida

El estado vivo usa una fila por Board, Page, Layer, Object y Hotspot. Geometry,
transform, style, properties y metadata son JSON discriminado para añadir tipos
sin migraciones. Los campos de identidad, orden, pertenencia, revisión y
timestamps permanecen relacionales e indexables. No se guarda todo el Board en
un JSON gigante.

Las versiones explícitas son snapshots JSON comprimibles a futuro. Autosave no
crea versiones: sólo aplica operaciones batch al estado vivo. Un eventual log
de operaciones puede añadirse para colaboración avanzada sin cambiar el modelo
de lectura.

### Coordenadas

Los objetos se almacenan en coordenadas de mundo. El viewport mantiene una
transformación independiente `{x, y, zoom, rotation}` y el renderer convierte
mundo a pantalla. Cada Page declara unidades, sistema de coordenadas y una
calibración opcional. Una calibración contiene dos puntos de mundo, distancia
real y unidad; soporta distancia, perímetro y área sin usar píxeles de pantalla.

### Capas

Los fondos no son `CanvasObject`. `CanvasPage.background` contiene un descriptor
de adapter (image, tiled-image, pdf, svg; DXF/DWG futuros). Las capas persistidas
son `vector`, `hotspot` y `data`. Presence/cursor es una capa lógica efímera y
no una tabla.

### Renderer

React administra navegación, paneles, comandos y estado persistible. Un
`CanvasRenderer` imperativo administra dibujo, hit-testing y transformaciones,
sin crear un componente React por objeto. La primera implementación usa
Canvas2D. El contrato permite sustituirlo por PixiJS/WebGL y añadir un índice
R-tree/quadtree sin cambiar las pantallas ni el modelo.

No se añade una librería gráfica en esta fase: Canvas2D cubre rectángulo,
elipse, línea, texto y hotspot del MVP; evita decidir prematuramente entre
Pixi/Konva/Fabric. PixiJS es el candidato principal cuando las mediciones reales
demuestren que hacen falta batching GPU, miles de objetos visibles o fondos
tileados. SVG/DOM no será el renderer principal por su coste por nodo.

### Background adapters

Contrato estable:

```text
load(source, signal)
getBounds()
getMetadata()
getNativeUnits()
getLogicalPages()
render(context, viewport, visibleWorldBounds)
dispose()
```

`source` puede referenciar un `FileAsset`, un manifiesto de tiles o metadata de
importación; nunca almacena una signed URL. PDF multipágina se modela como un
asset fuente y fondos por Page. Anotaciones y PDF original permanecen separados.

### Colaboración, autosave y concurrencia

- Persistente: mutations REST batch con `revision` optimista por objeto.
- Efímero: `canvas:board:<boardId>` privado para cursores, selección, viewport,
  herramienta y avisos de invalidación.
- Presence: solamente identidad y estado conectado, con heartbeat existente.
- Autosave: cola local, debounce corto tras edición, flush al terminar drag,
  lotes acotados, reintento con backoff y estado `dirty/saving/saved/error`.
- Undo/redo: comandos inversos locales; no se persiste el historial completo.
  Un undo colaborativo se convierte en una nueva mutation y puede fallar por
  conflicto de revisión, en cuyo caso se recarga/reconcilia.

Yjs no se introduce para geometría en esta fase. Las operaciones sobre objetos
independientes y la revisión optimista cubren el MVP con menor complejidad. Si
la edición concurrente del mismo path exige merge punto a punto, el transporte
y la cola quedan detrás de interfaces reemplazables por CRDT.

## Dominio y datos

- `CanvasBoard`: tenant, propietario, template inicial, settings/metadata,
  thumbnail, archivo, versión actual y archivo lógico.
- `CanvasPage`: escena, orden, dimensiones opcionales, infinito, background,
  coordenadas y calibración.
- `CanvasLayer`: orden, tipo, visible, locked y opacity.
- `CanvasObject`: tipo, transform, geometry, style, properties, metadata,
  bounds futuros, revisión y soft delete.
- `CanvasHotspot`: semántica interactiva separada de su objeto gráfico.
- `CanvasEntityLink`: target Canvas polimórfico y destino Runly genérico.
- `CanvasAttachment`: asociación a `FileAsset`, no copia del archivo.
- `CanvasCollaborator`: owner/editor/commenter/viewer por Board.
- `CanvasVersion`: snapshot explícito y metadata de restauración.
- `EntityComment`: almacenamiento compartido para Board/Hotspot.

`companyId` se repite donde una comprobación tenant directa es valiosa. Todos
los accesos por ID comienzan por Board + empresa activa y devuelven 404 para no
filtrar existencia entre tenants.

## API

Base `/canvas`:

- `GET/POST /boards`
- `GET/PATCH/DELETE /boards/:boardId`
- CRUD de `pages`, `layers`, `hotspots` anidado bajo Board.
- `POST /boards/:boardId/objects/batch` para create/update/delete acotado.
- `GET /boards/:boardId/objects` con filtros page/layer y, posteriormente,
  bounds de viewport.
- CRUD de Entity Links y asociaciones de archivos.
- `GET/POST /boards/:boardId/versions` y restore explícito.
- comentarios anidados por target validado.

La respuesta batch incluye filas creadas/actualizadas y conflictos por
revisión. La API nunca confía en `companyId`, owner o actor enviados por el
cliente.

## Permisos

RBAC global:

`canvas.access`, `canvas.view`, `canvas.create`, `canvas.edit`,
`canvas.delete`, `canvas.share`, `canvas.comment`, `canvas.manage`,
`canvas.version.view`, `canvas.version.create`, `canvas.version.restore`.

ACL por Board: `OWNER > EDITOR > COMMENTER > VIEWER`. Ambos controles son
necesarios: RBAC habilita la capacidad en la empresa y la ACL limita el Board.
El creador recibe OWNER dentro de la misma transacción.

## Archivos y seguridad

Los uploads continúan en el servicio de archivos. Canvas acepta sólo IDs de
`FileAsset` visibles en la empresa activa, guarda la relación y solicita URLs
firmadas al abrir. Los adapters reciben una URL efímera resuelta, no la
persisten. MIME, tamaño, checksum, variantes y cleanup siguen perteneciendo a
Files. Tiling/importación será un job que produce derivados y un manifiesto,
sin reemplazar el asset original.

## Rendimiento y extensión

- índices por tenant/board/page/layer/orden y revisión;
- endpoint batch y transacciones cortas;
- culling por bounds como siguiente incremento;
- viewport fetch por región compatible con R-tree/PostGIS futuro;
- adapters para image, tiled-image, PDF, SVG, DXF, DWG, DGN e IFC;
- `CanvasEntityLinkResolver` para módulos oficiales y RME3;
- futuro Canvas SDK con open/createHotspot/linkEntity/preview;
- Notas podrá enlazar `runly.canvas/CanvasBoard` sin reemplazar Excalidraw.

