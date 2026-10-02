# Runly Canvas — mapas geográficos e importación DXF

## 1. Feature title

Canvas Fase 5 — páginas sobre mapa (OpenStreetMap) e importación de planos DXF con escala.

## 2. Status

Approved (decisión delegada por el usuario, 2026-10-01).

## 3. Context

Quinta iniciativa del roadmap. El usuario pidió "algún tipo de plano de
alguna API gratuita". No existe una API gratuita fiable de planos de
interiores; sí existen mapas abiertos: **OpenFreeMap** (estilos vectoriales
de OpenStreetMap sin clave ni límites declarados) renderizados con
**MapLibre GL JS** (BSD-3), y **Nominatim** (geocodificación OSM, máx. 1
petición/s, requiere User-Agent identificable). Para planos de interiores,
el formato más común es **DXF** (AutoCAD), legible con `dxf-parser` (MIT).

La escala real ya existe (fase 4a: `CanvasPage.calibration`, medición).

## 4. Problem

1. No se puede dibujar sobre un mapa real (sucursales, obras, rutas, terrenos).
2. Un plano de AutoCAD hay que convertirlo a PDF/imagen fuera de Runly y
   calibrar la escala a mano.

## 5. Goals

1. Una página puede tener **fondo de mapa**: se elige un lugar buscando una
   dirección; el mapa se mueve y hace zoom junto con el lienzo; las medidas
   salen en metros reales sin calibrar.
2. Nueva plantilla "Mapa de sitio".
3. Insertar un archivo **DXF**: se dibuja como imagen en la capa de fondo y,
   si el archivo declara unidades, la página queda calibrada automáticamente.
4. Proveedores configurables por instancia (estilo de mapa y geocodificador).

## 6. Non-goals

1. Mapa en miniaturas, exportaciones y enlaces públicos (sólo el editor).
2. Rotación del mapa, vista 3D, capas satelitales.
3. DXF editable como objetos vectoriales (se importa como imagen).
4. DWG, DGN, IFC.
5. Rutas o navegación.

## 7. User stories

1. Como gerente de operaciones, quiero ubicar mis sucursales en un mapa y
   conectar cada una a sus datos.
2. Como jefe de obra, quiero marcar zonas sobre el mapa del terreno y medir
   en metros.
3. Como arquitecto, quiero subir el DXF de la planta y que ya mida en metros.

## 8. UX requirements

- Diálogo "Fondo de mapa" (editores): campo de búsqueda "Buscar dirección o
  lugar" con botón "Buscar" (sin autocompletar, para respetar el límite de
  Nominatim), lista de resultados; al elegir uno, "Usar este lugar". Si la
  página ya tiene mapa: botón "Quitar mapa" (`ConfirmDialog` si hay objetos:
  "Los elementos se quedan donde están, pero el mapa desaparece.").
- Acceso: acción del estado vacío de la plantilla "Mapa de sitio" ("Ubicar en
  el mapa") y opción "Fondo de mapa…" en el menú de escala (editores).
- Con mapa: indicador de escala "Mapa · metros"; la cuadrícula se oculta por
  defecto; la atribución "© OpenStreetMap" visible en la esquina inferior
  izquierda del lienzo (requisito de licencia).
- Si el mapa no carga: aviso discreto "No se pudo cargar el mapa" y el lienzo
  sigue funcionando.
- DXF: el selector de archivo acepta `.dxf`. Durante la conversión, el estado
  "Insertando…". Si se calibró: toast "Plano DXF insertado con escala en
  metros" (o la unidad). Errores: "No se pudo leer el DXF.".
- Textos en español, sin emojis.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` — `BoardEditor` (nuevo `MapBackdrop` bajo el
lienzo), `ScaleControl`, nuevo `MapLocationDialog`; inserción de medios.

## 10. Data model

Sin tablas. `CanvasPage.background` para mapa:

```js
{ type: 'map', origin: { lat, lng }, label: string | null, bbox: [south, north, west, east] | null }
```

Al fijarlo, la API pone `calibration = { a: {x:0,y:0}, b: {x:100,y:0}, distance: 100, unit: 'm' }`
y `coordinateSystem = { unit: 'm', axis: 'geo', origin }`. Las coordenadas de
mundo son metros sobre el plano tangente en `origin`:
`x = (mercX - mercX0) · cos(lat0)`, `y = -(mercY - mercY0) · cos(lat0)`.

Imagen DXF: `properties = { fileId, sourceFileId, name, naturalWidth, naturalHeight, dxf: { unit, width, height } }`.

## 11. Prisma impact

N/A.

## 12. API contract

- `GET /canvas/map-config` — `canvas.view`. `{ data: { enabled, styleUrl, attribution } }`
  (`CANVAS_MAPS=false` desactiva; `CANVAS_MAP_STYLE_URL` cambia el estilo;
  por defecto `https://tiles.openfreemap.org/styles/liberty`).
- `GET /canvas/geocode?q=` — `canvas.view`. Proxy a Nominatim
  (`CANVAS_GEOCODER_URL`, por defecto `https://nominatim.openstreetmap.org`)
  con User-Agent `RunlyERP/1.0`, cola global de 1 petición/s y caché en
  memoria de 24 h. `{ data: [{ label, lat, lng, bbox }] }` (máx. 5). 400 si
  `q` vacío o > 200 caracteres; 503 si está desactivado o el proveedor falla.
- `PATCH .../pages/:pageId` — `background` con `type: 'map'` se valida (lat
  −85..85, lng −180..180, bbox opcional de 4 números) y fija calibración y
  sistema de coordenadas; `background: null` quita el mapa y la calibración
  automática (sólo si la calibración es la automática).

## 13. SDK contract

`runly.canvas.getMapConfig(token)`, `runly.canvas.geocode(q, token)`.

## 14. Validator contract

N/A.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

Sin permisos nuevos (`canvas.view` para config/geocode, edición de página
para fijar el mapa).

## 19. Multi-company behavior

Sin datos por empresa; la caché del geocodificador es global por instancia
(consultas de direcciones públicas, sin datos del ERP).

## 20. Files/storage impact

DXF: se sube el `.dxf` original y el PNG resultante con el flujo de Files
existente (`runly.canvas/CanvasBoard/<boardId>`).

## 21. Export/import requirements

Importación DXF (entidades LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT,
MTEXT, INSERT con bloques; unidades `$INSUNITS` 1 in, 2 ft, 4 mm, 5 cm,
6 m). Exportación sin mapa (non-goal).

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Proveedor de mapa caído: el lienzo funciona sin fondo.
2. Página con mapa y calibración manual previa: fijar mapa la reemplaza por
   la automática (aviso en el diálogo).
3. DXF sin `$INSUNITS` o 0: se inserta sin calibrar.
4. DXF enorme (> 200 000 entidades): se rechaza con "El DXF es demasiado
   grande para importarlo.".
5. Página ya calibrada al insertar DXF: no se cambia la calibración.
6. Zoom del lienzo fuera del rango del mapa (0–22): el mapa se queda en su
   límite.

## 24. Risks

1. Política de uso de Nominatim → proxy con cola y caché; configurable para
   usar un servidor propio.
2. Tamaño de MapLibre (~800 KB) → carga diferida sólo en páginas con mapa.
3. Disponibilidad de OpenFreeMap → URL de estilo configurable.

## 25. Acceptance criteria

1. Dado el origen (19.4326, −99.1332), cuando se convierte a mundo y de
   vuelta, entonces el error es < 1e-6 grados.
2. Dado un zoom de lienzo 1 en el ecuador, cuando se calcula la cámara,
   entonces el zoom de MapLibre es log2(40075016.686 / 512) ± 0.001.
3. Dado `background: { type: 'map', origin: { lat: 95, lng: 0 } }`, cuando
   se hace PATCH, entonces 400.
4. Dada una búsqueda repetida, cuando se consulta dos veces, entonces el
   proveedor recibe una sola petición.
5. Dado un DXF en milímetros de 10 000 × 5 000, cuando se inserta en una
   página sin escala, entonces la página queda calibrada y medir el ancho de
   la imagen da "10 m".

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` de archivos tocados; `node --check apps/api/src/index.js`;
  `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: mapa de sitio con búsqueda; zoom/pan sincronizado; medir;
  insertar un DXF.

## 27. Rollback plan

Sin migraciones; revertir commits. Las páginas con `background.type = 'map'`
quedan con calibración automática y sin mapa visible.

## 28. Future enhancements

1. Mapa en exportaciones y enlaces públicos.
2. Capa satelital configurable.
3. DXF vectorial editable por capas.
4. Geolocalizar objetos de datos (sucursales con coordenadas).
