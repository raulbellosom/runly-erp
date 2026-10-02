# Runly Canvas — capa de datos: objetos conectados a registros con información en vivo

## 1. Feature title

Canvas Fase 3 — capa de datos (inventario primero) y referencias inversas.

## 2. Status

Approved (decisión delegada por el usuario, 2026-10-01).

## 3. Context

Tercera iniciativa del roadmap (plantillas → solidez → **capa de datos** →
herramientas de plano → mapas → POS). Hoy cada página tiene una capa
"Datos Runly" de tipo `data` sin comportamiento: un objeto ahí se comporta
igual que en una capa vectorial. Los vínculos existentes (`CanvasEntityLink`)
relacionan un objeto con un registro pero no muestran su estado.

`runly.inventory` es inventario de **activos**: `InvItem` (estado
`available | assigned | maintenance`, `adminStatus`, `locationId`,
`assignedToId`, `conditionId`) e `InvLocation` (nombre, descripción,
dirección). No maneja cantidades de stock.

Infraestructura reutilizada: `relation-targets-service.js` (catálogo
`EXTERNAL_RELATION_TARGETS`, `search`, `resolve` con permisos del módulo
dueño), `createUserAccessService.assertCompanyMember`, el canal Realtime del
Board y el inspector del editor.

## 4. Problem

1. La capa "Datos Runly" no se entiende porque no hace nada distinto.
2. Un plano de bodega no puede mostrar qué hay en cada ubicación ni en qué
   estado está cada equipo; hay que salir a Inventario.
3. Desde un registro del ERP no se sabe en qué Boards aparece.

## 5. Goals

1. Un objeto puede **conectarse a datos**: queda ligado a un registro y
   muestra en el lienzo su título, un resumen y un color de estado que se
   actualizan solos.
2. Fuentes v1: Ubicación de inventario y Artículo de inventario con métricas
   propias; cualquier otro tipo del catálogo de relaciones (vehículo,
   empleado, contacto, proyecto, tarea, evento, cuenta, archivo) con título
   y subtítulo.
3. Insertar un objeto de datos desde un registro (crea un rectángulo
   etiquetado y conectado) y conectar una forma existente desde el inspector.
4. La capa `data` tiene sentido: los objetos conectados se mueven a ella y
   se pueden ocultar o bloquear juntos. Las plantillas Plano, Mapa técnico y
   Distribución la incluyen.
5. Referencias inversas: la ficha del artículo de inventario muestra los
   Boards donde aparece.

## 6. Non-goals

1. Reglas de color configurables por el usuario (umbrales, fórmulas).
2. Editar el registro desde el lienzo (sólo lectura + enlace a su ficha).
3. Push en tiempo real desde Inventario; la actualización es por sondeo.
4. Fuentes de módulos RME3 personalizados.
5. Cantidades/stock (el inventario de Runly no las tiene).

## 7. User stories

1. Como encargado de almacén, quiero dibujar cada ubicación en el plano y ver
   cuántos equipos tiene y si alguno está en mantenimiento.
2. Como técnico, quiero colocar un equipo en el mapa técnico y ver su estado y
   a quién está asignado.
3. Como usuario de Inventario, quiero ver en la ficha de un equipo en qué
   Boards aparece y abrirlos.
4. Como editor, quiero ocultar todos los datos de una página con un clic.

## 8. UX requirements

Lienzo (objeto conectado):
- Contorno con el color del estado (`ok` verde, `info` azul, `warning` ámbar,
  `danger` rojo, `neutral` gris) y relleno suave del mismo color, salvo que
  el objeto tenga `fill`/`stroke` propios y `binding.tint === false`.
- Dentro de la caja (si mide ≥ 80×40 en pantalla): título en negrita y una
  línea de resumen (`summary`); si es más pequeña, sólo el título debajo.
- Insignia pequeña con ícono de base de datos en la esquina superior derecha.
- Registro sin acceso: título "Sin acceso", tono `neutral`. Registro
  inexistente: "Registro no disponible", tono `danger`.

Inspector (un objeto seleccionado, forma o texto excepto línea/flecha/imagen):
- Sección "Datos Runly":
  - Sin conexión: botón "Conectar a datos".
  - Conectado: título, tipo de fuente, resumen, métricas (lista
    etiqueta/valor), botón "Abrir ficha" (si hay `url`), "Cambiar" y
    "Desconectar".
- Diálogo "Conectar a datos" (Dialog, header/footer fijos): `SelectField`
  de fuente (sólo fuentes de módulos instalados y con permiso), `ComboboxField`
  con búsqueda del registro (debounce 250 ms), botón "Conectar".

Barra inferior: nuevo botón "Insertar datos" (ícono `Database`) que abre el
mismo diálogo con el texto "Insertar"; crea un rectángulo de 200×100 en el
centro de la vista, en la capa de datos, conectado y con el título como
texto de la forma.

Ficha de artículo de inventario: sección "En Canvas" con la lista de Boards
(nombre, plantilla, botón "Abrir") o nada si no aparece en ninguno.

## 9. Routes/screens

- `/app/m/runly.canvas/:boardId` — `BoardEditor` (inspector, toolbar, nuevo
  `DataBindingDialog`).
- `/app/m/runly.inventory/...` detalle de artículo — `InventoryItemDetail`
  añade `CanvasReferences`.

## 10. Data model

Sin tablas nuevas. `CanvasObject.properties.binding`:

```js
{ source: 'inventory_location' | 'inventory_item' | <tipo del catálogo de relaciones>, id: '<uuid>', tint?: boolean }
```

Respuesta de resolución por referencia:

```js
{ title, subtitle?, summary?, url?, tone: 'ok'|'info'|'warning'|'danger'|'neutral',
  metrics?: [{ label, value }], restricted?: true, missing?: true }
```

Plantillas: Plano, Mapa técnico y Distribución añaden una capa
`{ name: 'Datos Runly', type: 'data' }` al final.

## 11. Prisma impact

N/A. Sin migración.

## 12. API contract

- `GET /canvas/data-sources` — `canvas.view`. `{ data: [{ key, label, module, installed, allowed }] }`.
- `GET /canvas/data-sources/:source/search?q=` — `canvas.view` + permiso de
  la fuente. `{ data: [{ id, title, subtitle }] }` (máx. 20). 403 sin permiso,
  404 fuente desconocida.
- `POST /canvas/boards/:boardId/bindings/resolve` — `canvas.view` + ACL
  VIEWER. Body `{ refs: [{ source, id }] }` (máx. 500). Respuesta
  `{ data: { '<source>:<id>': Resolution } }`.
- `GET /canvas/references?moduleKey=&entityType=&entityId=` — `canvas.view`.
  Boards accesibles para el usuario donde el registro aparece por
  `CanvasEntityLink` o por `binding`. `{ data: [{ boardId, name, templateType }] }`.
- Batch de objetos: `properties.binding`, si viene, se valida (fuente
  conocida, `id` UUID); si no, 400.

Fuentes y su resolución:

| source | módulo / permiso | resolución |
|---|---|---|
| `inventory_location` | runly.inventory / `inventory.item.read` | título = nombre; métricas: total, disponibles, asignados, en mantenimiento; summary "N equipos · M en mantenimiento"; tono `warning` si hay en mantenimiento, `ok` si hay equipos, `neutral` si está vacía |
| `inventory_item` | runly.inventory / `inventory.item.read` | título = nombre, subtítulo = etiqueta de activo; métricas: estado, asignado a, ubicación, condición; tono por estado (`available` ok, `assigned` info, `maintenance` warning; `adminStatus` distinto de `registered` → danger, summary "Dado de baja") |
| otros tipos del catálogo de relaciones | módulo y permiso del catálogo | `relationTargets.resolve` → título/subtítulo/url, tono `neutral` |

## 13. SDK contract

`runly.canvas`: `listDataSources(token)`, `searchDataSource(source, q, token)`,
`resolveBindings(boardId, refs, token)`, `listReferences({ moduleKey, entityType, entityId }, token)`.

## 14. Validator contract

N/A (validación en `canvas-service.js` / `canvas-data-sources.js`).

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A (la sección "En Canvas" se renderiza junto al `RunlyDetail`, no dentro
del blueprint).

## 18. RBAC/permissions

Sin permisos nuevos. Cada fuente exige el permiso de lectura de su módulo
(`assertCompanyMember`). Sin permiso, la resolución devuelve
`restricted: true` (el Board sigue visible; sólo se oculta el dato).

## 19. Multi-company behavior

Todas las consultas filtran por `companyId` activo; IDs de otra empresa
resuelven como `missing`. Las referencias inversas sólo devuelven Boards de
la empresa activa a los que el usuario tiene acceso (owner/colaborador).

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A (conectar/desconectar es una actualización de objeto, ya trazada por
`revision`/`updatedById`; los objetos no tienen auditoría individual).

## 23. Edge cases

1. Fuente de un módulo desinstalado: `missing` con título "Registro no
   disponible"; el diálogo no la ofrece.
2. Más de 500 referencias en una página: el cliente divide en lotes de 500.
3. Objeto conectado en una capa oculta: no se resuelve (sólo objetos
   visibles).
4. Conectar un objeto que está en una capa bloqueada: el botón aparece
   deshabilitado (igual que el resto del inspector).
5. Página sin capa `data` (Boards antiguos con capas propias o plantilla
   Diagrama): el objeto se queda en su capa.
6. Usuario de enlace público: no se resuelven datos (el enlace público no
   expone datos del ERP); los objetos se ven como formas normales.
7. El mismo registro en varios objetos: se resuelve una sola vez.

## 24. Risks

1. Coste de resolver muchos objetos → resolución agrupada por fuente con una
   consulta por fuente (`groupBy` para ubicaciones) y caché de cliente de
   30 s; sondeo cada 60 s sólo con la pestaña visible.
2. Filtro JSON en referencias inversas sin índice → acotado por `companyId`
   y `deletedAt IS NULL`; aceptable para el volumen actual, índice GIN como
   mejora futura.

## 25. Acceptance criteria

1. Dada una ubicación con 3 equipos (1 en mantenimiento), cuando se resuelve,
   entonces `summary` es "3 equipos · 1 en mantenimiento" y `tone` es
   `warning`.
2. Dado un artículo asignado, cuando se resuelve, entonces `tone` es `info` y
   las métricas incluyen "Asignado a".
3. Dado un usuario sin `inventory.item.read`, cuando se resuelve, entonces
   la referencia vuelve con `restricted: true`.
4. Dado un ID de otra empresa, cuando se resuelve, entonces vuelve `missing`.
5. Dado un rectángulo seleccionado, cuando se conecta a una ubicación,
   entonces `properties.binding` se guarda, el objeto pasa a la capa de datos
   y el lienzo muestra título, resumen y color.
6. Dado "Insertar datos" con un artículo, cuando se confirma, entonces se
   crea un rectángulo conectado en la capa de datos.
7. Dado un artículo que aparece en un Board, cuando se abre su ficha,
   entonces la sección "En Canvas" lista ese Board.
8. Dado un batch con `binding.source: 'nope'`, cuando se envía, entonces
   responde 400.

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` de archivos tocados y `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: plano con ubicaciones conectadas, cambiar el estado de un
  equipo en Inventario y ver el cambio en ≤ 60 s; ficha del artículo con
  "En Canvas".

## 27. Rollback plan

Sin migraciones. Revertir commits; `properties.binding` queda como JSON
inerte que el código anterior ignora.

## 28. Future enhancements

1. Reglas de color configurables y leyenda.
2. Push de cambios de Inventario al canal del Board.
3. Fuentes de módulos RME3 (resolver genérico del Builder).
4. Arrastrar registros desde un panel lateral.
5. Índice GIN sobre `properties->binding`.
6. Referencias inversas en vehículos, empleados y proyectos.
