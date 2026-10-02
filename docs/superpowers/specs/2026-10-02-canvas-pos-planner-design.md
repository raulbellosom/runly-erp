# Runly Canvas × POS (6b): diseñador de planos de POS sobre el motor de Canvas

## 1. Feature title

Canvas Fase 6b — rediseño del "Diseñador de planos" de POS con el motor de Canvas, sin reglas.

## 2. Status

Complete — Verified: 2026-10-02 (node --test desktop canvas+pos 85/85 y API 58/58, eslint de archivos tocados, build:web; PosFloorPlannerScreen.jsx 576 líneas). Smoke manual pendiente.

## 3. Context

6a migró la vista de meseros. El diseñador (`PosFloorPlannerScreen.jsx`, 898
líneas, + `FloorCanvas.jsx` 619, `FloorCanvasRulers.jsx`,
`FloorCanvasOverlays.jsx`, partes de `FloorCanvasDecor/Helpers`) sigue siendo
DOM con reglas, crosshair, superposición de dibujo de polígonos y menú
contextual propios. Los datos (`PosFloorElement`, `PosTable`) y el guardado
por lote (`PUT /pos/floors/:id/layout`, con publicación) no cambian. La API
ya acepta `rotation`.

## 4. Problem

1. Aspecto distinto al de Canvas y reglas que ocupan espacio sin aportar.
2. Zoom por pasos fijos, sin pan con arrastre/pinch como en Canvas.
3. Sin rotación de mesas ni muebles.
4. Archivo de pantalla por encima del límite blando (898 líneas).

## 5. Goals

1. El lienzo del diseñador usa `CanvasViewport`/`Canvas2DRenderer` con los
   dibujantes de POS: cuadrícula de puntos, zoom suave y pan (rueda, espacio,
   arrastre con dos dedos), ajustar a contenido, sin reglas ni crosshair.
2. Mismas capacidades: colocar elementos con clic (tamaño por defecto) o
   arrastre (tamaño dibujado), mover, redimensionar, **rotar** (nuevo),
   polígonos con dibujo punto a punto y **edición de vértices** (mover,
   insertar en punto medio, eliminar con doble clic), menú contextual
   (copiar, pegar, duplicar, eliminar, adelante, atrás), atajos existentes,
   deshacer/rehacer, guardar y publicar, panel de propiedades, móvil.
3. El motor gana capacidades genéricas reutilizables por Canvas:
   herramientas de creación externas, herramienta de polígono libre, edición
   de vértices de polígonos, `isSelectable` y `onContextMenu`.
4. `PosFloorPlannerScreen.jsx` baja de 800 líneas extrayendo estado e
   historial.

## 6. Non-goals

1. Cambios en datos, API o publicación de POS.
2. Selección múltiple en el diseñador de POS (sigue siendo uno a la vez).
3. Nuevos tipos de elemento.

## 7. User stories

1. Como administrador del restaurante, quiero diseñar el salón con la misma
   fluidez que un Board de Canvas.
2. Como administrador, quiero girar una mesa o una barra.
3. Como administrador, quiero ajustar los vértices de una zona poligonal.

## 8. UX requirements

- Barra superior del diseñador sin cambios (sucursal, plano, +Plano, editar,
  deshacer/rehacer, Guardar, Publicar).
- Panel izquierdo "Elementos" y panel de propiedades sin cambios de
  contenido.
- Lienzo: fondo `muted` del área, superficie del salón (tamaño del plano) con
  esquinas redondeadas; cuadrícula de puntos de 20 px con ajuste (Alt lo
  desactiva); sin reglas.
- Controles flotantes abajo a la derecha (mismo estilo que Canvas): alejar,
  porcentaje (clic = 100 %), acercar, ajustar, mostrar/ocultar cuadrícula. Se
  elimina el botón de reglas.
- Herramienta activa con indicación superior centrada como en Canvas
  ("Arrastra para dibujar: Mesa cuadrada · clic para tamaño estándar · Esc
  para cancelar"; polígono: "Haz clic para añadir puntos · doble clic o Enter
  para terminar").
- Polígono seleccionado: asas en cada vértice (arrastrar), asas pequeñas en
  puntos medios (arrastrar crea vértice), doble clic en un vértice lo elimina
  (mínimo 3).
- Clic derecho sobre un elemento abre el menú contextual existente en esa
  posición; sobre vacío, sólo "Pegar" si hay algo copiado.

## 9. Routes/screens

POS → `PosFloorPlannerScreen` con nuevo `FloorPlannerStage`.

## 10. Data model

Sin cambios. Estado del diseñador (cliente): elementos con `rotation`
añadido (leído de `el.rotation`, enviado en el guardado).

## 11. Prisma impact

N/A.

## 12. API contract

Sin cambios; el guardado envía `rotation`.

## 13. SDK contract

N/A.

## 14. Validator contract

N/A.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

Sin cambios (`pos.floor.manage`).

## 19. Multi-company behavior

Sin cambios.

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Coordenadas negativas: se mantienen ≥ 0 como hoy.
2. Polígono movido/redimensionado/rotado: los puntos absolutos se recalculan
   desde sus puntos relativos.
3. Tamaño mínimo 20 × 20 como hoy.
4. Elementos con id temporal (`temp_*`) se siguen guardando sin id.
5. Superficie del salón no seleccionable ni movible.

## 24. Risks

1. Regresión en una pantalla de configuración de producción → pruebas puras
   del adaptador ida y vuelta; el viejo `FloorCanvas` se borra sólo cuando el
   nuevo compila y pasa pruebas.
2. Cambios en `CanvasViewport` afectan a Canvas → todas las capacidades
   nuevas son opcionales y con valores por defecto que preservan el
   comportamiento actual; pruebas de Canvas siguen pasando.

## 25. Acceptance criteria

1. Dado un elemento movido en el lienzo, cuando se confirma, entonces el
   reducer recibe un solo paso de historial con `x/y` redondeados y ≥ 0.
2. Dado un polígono con puntos absolutos, cuando se adapta y se vuelve a
   convertir sin cambios, entonces los puntos son iguales (±0,01).
3. Dado un vértice arrastrado, cuando se suelta, entonces la caja del
   polígono se recalcula para contener todos los puntos.
4. Dada una mesa rotada 30°, cuando se guarda, entonces el payload incluye
   `rotation: 30`.
5. Dado el diseñador, entonces no hay reglas en pantalla.

## 26. Verification plan

- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js`
- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `npx eslint` de archivos tocados; `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: crear salón, colocar todos los tipos, polígono, editar
  vértices, rotar, menú contextual, deshacer, guardar, publicar, vista de
  meseros.

## 27. Rollback plan

Sin migraciones; revertir commits.

## 28. Future enhancements

1. Selección múltiple y alinear en POS.
2. Exportar el plano del salón a PDF con el exportador de Canvas.
