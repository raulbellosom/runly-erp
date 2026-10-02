# Runly Canvas — plantillas de Board reales

## 1. Feature title

Plantillas de Board con comportamiento real y nuevo diálogo de creación.

## 2. Status

Approved (diseño aprobado en conversación 2026-10-01).

## 3. Context

`runly.canvas` (spec de fundación `2026-10-01-runly-canvas-foundation.md`) ya
ofrece seis plantillas al crear un Board. Esta es la primera de seis
iniciativas de mejora del módulo, en este orden acordado:

1. **Plantillas reales** (esta spec).
2. Solidez: realtime con deltas, conflictos por operación, cursores, UI de
   versiones, miniaturas.
3. Capa de datos: objetos enlazados a registros ERP con valores en vivo
   (primer caso: inventario) y vínculos inversos.
4. Herramientas de plano: fondo PDF vectorial, calibración y medición,
   conectores, alinear/distribuir, exportar.
5. Mapas geográficos (MapLibre + OpenFreeMap) e importación DXF.
6. Migración del plano de mesas de POS al motor de Canvas.

## 4. Problem

1. `templateType` sólo cambia el ícono de la tarjeta: todas las plantillas
   crean las mismas tres capas y los mismos ajustes, así que el usuario no
   entiende la diferencia entre ellas.
2. El editor ignora `CanvasBoard.settings`: la cuadrícula se dibuja siempre
   (paso fijo `GRID_STEP = 24`) y no existe ajuste a la cuadrícula aunque
   `settings.snapping` se guarde.
3. El catálogo de plantillas está duplicado: `boardMeta.js` (desktop) y
   `BOARD_TYPES` en `canvas-mirai-queries.js` (API), con textos distintos.
4. El estado vacío de una página es genérico; no guía al usuario hacia lo que
   la plantilla elegida espera (subir un plano, un PDF, colocar puntos).

## 5. Goals

1. Un catálogo único de plantillas en la API, consumido por `createBoard`, el
   diálogo de creación y MirAI.
2. Cada plantilla define ajustes (cuadrícula, ajuste, herramienta inicial),
   capas iniciales, estado vacío y textos explicativos.
3. El editor respeta `settings`: muestra u oculta la cuadrícula con el tamaño
   configurado y ajusta a ella al crear, mover y redimensionar.
4. El usuario puede cambiar esos ajustes después desde "Ajustes del Board".
5. El diálogo "Nuevo Board" explica cada plantilla con vista previa ilustrada,
   "Úsala cuando…" e "Incluye:".
6. Los Boards existentes siguen viéndose como hoy sin migración de datos.

## 6. Non-goals

1. Plantillas creadas por el usuario o Boards copiados como plantilla.
2. Unidades reales, calibración o medición (fase 4 del roadmap).
3. Conectores, alinear/distribuir (fase 4).
4. Capa de datos con valores en vivo (fase 3).
5. Fondos de página (`CanvasPage.background`) y adapters nuevos.
6. Contenido de ejemplo sembrado como objetos en el Board.
7. Ajuste a otros objetos (guías inteligentes); sólo ajuste a la cuadrícula.

## 7. User stories

1. Como usuario que crea un Board, quiero ver para qué sirve cada plantilla y
   qué incluye, para elegir la correcta sin adivinar.
2. Como usuario que dibuja un plano, quiero que las formas se ajusten a la
   cuadrícula, para que queden alineadas sin esfuerzo.
3. Como usuario que abre un Board recién creado, quiero que la página vacía me
   indique el primer paso propio de la plantilla, para empezar rápido.
4. Como editor, quiero activar o desactivar la cuadrícula y el ajuste, y
   cambiar su tamaño, para adaptar el Board a lo que dibujo.
5. Como usuario de MirAI, quiero que "créame un Board de diagrama" produzca el
   mismo Board que el diálogo.

## 8. UX requirements

Diálogo "Nuevo Board" (`CreateBoardDialog`):

- Header y footer fijos; sólo el cuerpo hace scroll (regla de modales).
- Rejilla de tarjetas de plantilla: cada una con una mini ilustración SVG
  (`preview`), nombre y una línea de descripción. `role="radiogroup"`.
- Bajo la rejilla, panel de detalle de la plantilla seleccionada: "Úsala
  cuando…" (`useWhen`) y lista "Incluye:" (`includes[]`).
- Campo Nombre (requerido) con placeholder sugerido por plantilla
  (`namePlaceholder`); Descripción opcional.
- Móvil: tarjetas en una columna; el detalle aparece justo bajo la tarjeta
  seleccionada.
- Mientras carga el catálogo: `Skeleton` en la rejilla; si falla: `ErrorState`
  con reintento. El botón "Crear Board" queda deshabilitado sin catálogo.
- Las ilustraciones usan tokens de tema (sin colores fijos) y se ven bien en
  modo oscuro.

Editor:

- Cuadrícula visible sólo si `settings.grid.enabled`; paso base
  `settings.grid.size` en unidades de mundo; si en pantalla queda menor a 12
  px se duplica hasta superar ese umbral (comportamiento actual).
- Ajuste a la cuadrícula activo si `settings.snapping` **y** la cuadrícula
  está habilitada. Aplica a: rectángulo de creación, arrastre de objetos
  (esquina superior izquierda de la caja; en selección múltiple, la caja del
  grupo), redimensión (borde/esquina arrastrado) y extremos de línea/flecha.
  No aplica a rotación (ya tiene su propio ajuste con Shift).
- Mantener `Alt` desactiva el ajuste durante el gesto.
- Al abrir el Board se selecciona `settings.defaultTool` si el usuario puede
  editar; los usuarios de sólo lectura siempre empiezan en "Seleccionar".
- Página vacía: título, texto y botón de acción definidos por
  `emptyState` de la plantilla. Acciones admitidas: `insert-media` (abre el
  selector de imagen/PDF), `tool:<herramienta>` (elige esa herramienta) o
  ninguna. El selector de archivos sólo se abre por clic del usuario (los
  navegadores bloquean abrirlo sin gesto).
- Inspector sin selección: sección "Ajustes del Board" con interruptor
  "Mostrar cuadrícula", campo "Tamaño de cuadrícula" (4–200) e interruptor
  "Ajustar a la cuadrícula". Deshabilitados para VIEWER/COMMENTER.
- Todos los textos en español; sin emojis.

## 9. Routes/screens

Sin rutas nuevas. Pantallas modificadas, módulo `runly.canvas`:

- `/app/m/runly.canvas` — `CanvasHome` → `CreateBoardDialog`.
- `/app/m/runly.canvas/:boardId` — `BoardEditor`, `CanvasViewport`,
  `BoardInspector`.

## 10. Data model

Sin tablas nuevas. Se define la forma de `CanvasBoard.settings` (jsonb):

```js
{
  version: 2,
  grid: { enabled: boolean, size: number },   // size 4..200, unidades de mundo
  snapping: boolean,
  defaultTool: 'select' | 'rectangle' | 'hotspot' | ...  // herramienta del editor
}
```

Catálogo de plantilla (código, no base de datos), `apps/api/src/routes/canvas/canvas-templates.js`:

```js
{
  key, label, description, useWhen, includes: string[], namePlaceholder,
  icon,            // nombre de ícono lucide resuelto en el desktop
  preview,         // clave de ilustración SVG en el desktop
  settings,        // forma de arriba
  layers: [{ name, type: 'vector'|'hotspot'|'data', locked?, metadata? }],
  emptyState: { title, description, action: { label, kind } | null },
}
```

Capas por plantilla (orden de abajo hacia arriba):

| key | grid | snapping | defaultTool | capas |
|---|---|---|---|---|
| blank | off, 24 | off | select | Dibujo (vector), Hotspots (hotspot), Datos Runly (data) |
| plan | on, 20 | on | select | Plano base (vector, `metadata.mediaTarget`), Mobiliario (vector), Hotspots (hotspot) |
| technical-map | on, 40 | off | hotspot | Instalaciones (vector, `mediaTarget`), Puntos (hotspot) |
| diagram | on, 10 | on | rectangle | Formas (vector), Notas (vector) |
| layout | on, 20 | on | select | Espacios (vector, `mediaTarget`), Elementos (vector), Hotspots (hotspot) |
| pdf-review | off, 24 | off | select | Documento (vector, `mediaTarget`, `lockAfterInsert`), Anotaciones (vector), Hotspots (hotspot) |

- `metadata.mediaTarget`: la inserción de imagen/PDF coloca los objetos en esa
  capa (la primera que lo tenga) en vez de la capa activa.
- `metadata.lockAfterInsert`: tras insertar medios en esa capa, se bloquea.
- La capa activa inicial es la primera capa `vector` que **no** sea
  `mediaTarget`, o la primera capa si no hay otra.
- Páginas nuevas (`createPage`) reciben las capas de la plantilla del Board.

## 11. Prisma impact

N/A. Sin modelos nuevos ni modificados; sin migración. `settings` ya es jsonb.

## 12. API contract

- `GET /canvas/templates` — auth + `canvas.view`. Respuesta
  `{ data: Template[] }` con los campos públicos del catálogo (todos los de la
  sección 10). 401/403 estándar.
- `POST /canvas/boards` — sin cambios de forma. Cambios de comportamiento:
  `templateType` desconocido → `blank`; `settings` se toma de la plantilla
  (si el cliente envía `settings`, se fusiona sobre los de la plantilla y se
  valida); las capas iniciales salen de la plantilla.
- `PATCH /canvas/boards/:boardId` — `settings` se valida: `grid.size` entero
  4–200, booleanos donde corresponde, `defaultTool` dentro de la lista de
  herramientas; siempre se guarda con `version: 2`. Error 400 con mensaje en
  español si no es válido.
- `POST /canvas/boards/:boardId/pages` — capas iniciales según la plantilla.

## 13. SDK contract

`runly.canvas.listTemplates(token) → Promise<{ data: Template[] }>` en
`packages/sdk/src/domains/canvas.js`.

## 14. Validator contract

N/A en `@runly/validators`. La validación de `settings` vive en
`canvas-service.js` (`normalizeBoardSettings`), igual que el resto de
validaciones del módulo.

## 15. Module manifest impact

N/A. Sin permisos ni navegación nuevos.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

`GET /canvas/templates` usa `canvas.view`. Cambiar ajustes sigue requiriendo
`canvas.edit` + ACL EDITOR (ruta `PATCH` existente).

## 19. Multi-company behavior

El catálogo es global y estático (no contiene datos de empresa). Los ajustes
se guardan por Board, que ya está acotado por `companyId`.

## 20. Files/storage impact

N/A. La inserción de medios sigue usando `FileAsset`; sólo cambia la capa
destino.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

Sin acciones nuevas. `BOARD_CREATED` y `BOARD_UPDATED` ya registran
`settings` en `after`/`before`.

## 23. Edge cases

1. Boards existentes tienen `settings = { grid: { enabled: false, size: 10 },
   snapping: true }` (default antiguo) o `null`. Si `settings.version !== 2`,
   el editor usa los ajustes de la plantilla de su `templateType`; así un
   Board antiguo "En blanco" no gana ajuste a 10 px de golpe. El primer
   cambio en "Ajustes del Board" guarda `version: 2`.
2. Boards antiguos conservan sus capas (Vectores/Hotspots/Datos Runly); no hay
   `mediaTarget` y la inserción usa la capa activa como hoy.
3. `templateType` desconocido o retirado → se trata como `blank`.
4. Capa `mediaTarget` bloqueada u oculta al insertar: se inserta en la capa
   activa y se avisa con toast "La capa Documento está bloqueada".
5. Ajuste con zoom muy bajo: el ajuste usa `grid.size` en mundo, no el paso
   visual duplicado.
6. Objetos ya existentes fuera de la cuadrícula no se mueven al activar el
   ajuste; sólo se ajustan al moverlos.
7. Usuario VIEWER/COMMENTER: no se le aplica `defaultTool` de creación.
8. MirAI crea un Board con `templateType`: obtiene capas y ajustes idénticos al
   diálogo porque ambos pasan por `createBoard`.

## 24. Risks

1. El ajuste a la cuadrícula se siente brusco en gestos finos → `Alt` lo
   desactiva y el tamaño es configurable.
2. Desalineación entre catálogo y desktop (ilustraciones/íconos por clave) →
   el desktop usa un fallback (ícono `Square`, ilustración en blanco) para
   claves desconocidas; test que verifique que cada `preview`/`icon` del
   catálogo tiene entrada en el desktop.
3. Cambiar la lógica de `createBoard` rompe tests existentes → actualizar
   `canvas-service.test.js` en el mismo cambio.

## 25. Acceptance criteria

1. Dado el catálogo, cuando se llama `GET /canvas/templates`, entonces
   devuelve las seis plantillas con `useWhen`, `includes`, `settings`, `layers`
   y `emptyState`.
2. Dado `templateType: 'plan'`, cuando se crea un Board, entonces la página 1
   tiene las capas Plano base, Mobiliario y Hotspots y `settings` con
   cuadrícula 20 y ajuste activo.
3. Dado un Board "Diagrama", cuando el editor lo abre con rol EDITOR, entonces
   la herramienta activa es Rectángulo; con rol VIEWER es Seleccionar.
4. Dado ajuste activo con tamaño 20, cuando se arrastra un rectángulo desde
   (13, 27), entonces su esquina queda en (20, 20); con `Alt` presionado queda
   en (13, 27).
5. Dado un Board "En blanco", cuando se abre, entonces no se dibuja cuadrícula.
6. Dado un Board creado antes de este cambio con plantilla `blank`, cuando se
   abre, entonces no se le aplica ajuste a la cuadrícula.
7. Dado un Board "Revisión de PDF", cuando se insertan páginas de un PDF,
   entonces quedan en la capa Documento y esa capa queda bloqueada.
8. Dado el inspector sin selección, cuando el editor cambia el tamaño de
   cuadrícula a 30, entonces se guarda `settings.grid.size = 30` y la
   cuadrícula se redibuja; un valor 2 o 500 es rechazado.
9. Dado el diálogo "Nuevo Board", cuando se selecciona "Plano", entonces se ve
   su "Úsala cuando…" y su lista "Incluye:".
10. Dado MirAI con `canvas.board.create` y `templateType: 'diagram'`, cuando
    se ejecuta, entonces el Board tiene las mismas capas y ajustes que uno
    creado desde el diálogo.

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/` (catálogo, `createBoard`
  por plantilla, `normalizeBoardSettings`, MirAI usa el catálogo).
- `node --test apps/desktop/src/modules/runly.canvas/` (función de ajuste,
  resolución de ajustes efectivos con `version` antiguo, mapa de
  ilustraciones/íconos).
- `pnpm lint` y `pnpm --filter ./apps/desktop build:web`.
- Smoke manual en el dev server existente (no reiniciarlo): crear un Board de
  cada plantilla, comprobar capas, cuadrícula, herramienta inicial, estado
  vacío y ajuste; abrir un Board antiguo.
- Revisar el checklist `docs/ai-context/ui-screen-audit-checklist.md` para el
  diálogo y el editor.
- Actualizar `apps/api/src/manifests/official/help/runly.canvas/overview.md`
  con la explicación de las plantillas.

## 27. Rollback plan

Sin migraciones. Revertir el commit restaura el comportamiento anterior; los
`settings` con `version: 2` guardados entretanto son jsonb compatible y el
código anterior los ignora sin error.

## 28. Future enhancements

1. Plantillas definidas por el usuario (guardar un Board como plantilla).
2. Unidades en metros, calibración y regla para "Plano" (fase 4).
3. Capa de datos con inventario para "Distribución" (fase 3).
4. Fondo geográfico para "Mapa técnico" (fase 5).
5. Conectores y alineación para "Diagrama" (fase 4).
6. Fondo PDF vectorial para "Revisión de PDF" (fase 4).
7. Ajuste a otros objetos (guías inteligentes).
