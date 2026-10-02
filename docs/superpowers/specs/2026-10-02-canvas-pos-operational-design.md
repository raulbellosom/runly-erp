# Runly Canvas × POS (6a): vista de meseros sobre el motor de Canvas y mesas como datos

## 1. Feature title

Canvas Fase 6a — el plano operativo de POS usa el motor de Canvas; las mesas de POS se pueden conectar en cualquier Board.

## 2. Status

Approved (decisión delegada por el usuario, 2026-10-02).

## 3. Context

Última iniciativa del roadmap de Canvas. POS tiene su propio plano de mesas
con DOM/SVG: planificador (`FloorCanvas*.jsx`, ~1 300 líneas) y vista
operativa de meseros (`FloorOperationalCanvas.jsx`, 511 líneas, sólo lectura,
estados de mesa en vivo, pinch-zoom). Sus datos viven en `PosFloor`,
`PosFloorElement`, `PosTable` y son la fuente de verdad de la operación.

Decisión: **migrar el motor, no los datos**. POS conserva sus tablas, API y
reglas; Canvas aporta renderer, viewport (zoom/pan/pinch, ajuste) y hit-test.
La migración se hace en dos etapas: 6a (vista operativa, sólo lectura, menor
riesgo) y 6b (planificador, requiere edición de vértices de polígono en el
motor).

## 4. Problem

1. Dos motores de lienzo distintos con zoom/pan/gestos duplicados.
2. La vista operativa con un nodo DOM por elemento escala peor en salones
   grandes y en tablets modestas.
3. Un Board de Canvas no puede mostrar el estado de las mesas de un salón.

## 5. Goals

1. `Canvas2DRenderer` acepta **dibujantes por tipo** (`scene.drawers`) para
   tipos externos (`pos.table`, `pos.decor`, `pos.zone`, `pos.surface`).
2. `CanvasViewport` permite declarar qué objetos se abren con un toque en modo
   lectura (`isTappable`).
3. La vista operativa de POS se renderiza con `CanvasViewport` + adaptador
   `floorToObjects`, conservando: colores por estado, sillas, nombre, atenuado
   "mis mesas", superficie del salón, controles de zoom y ajustar.
4. Fuente de datos `pos_table` en Canvas: título, zona, estado y capacidad con
   tono por estado.

## 6. Non-goals

1. Planificador (6b).
2. Cambios en tablas o API de POS.
3. Migrar salones de POS a Boards.

## 7. User stories

1. Como mesero, quiero el mismo plano, igual de rápido o más, con zoom fluido.
2. Como gerente, quiero un Board con el plano del local donde cada mesa
   conectada muestre si está ocupada.

## 8. UX requirements

- Vista operativa: idéntica en contenido a la actual (estados con los mismos
  colores y textos, sillas, nombres, atenuado de mesas ajenas con "mis
  mesas", superficie del salón con borde). Toque/clic en una mesa abre el
  panel de acciones existente; tocar decoración no hace nada. Controles de zoom
  (acercar, alejar, ajustar) abajo a la derecha. Pinch y rueda como en Canvas.
- `pos_table` en "Conectar a datos": "Mesa de POS"; tono: AVAILABLE ok,
  RESERVED info, OCCUPIED warning, BILL_REQUESTED danger, DIRTY/DISABLED
  neutral; resumen "Ocupada · 4 personas".

## 9. Routes/screens

POS: pantalla de mesas (`PosTablesScreen`) → nuevo `FloorOperationalStage`.
Canvas: diálogo "Conectar a datos".

## 10. Data model

Sin cambios. Objetos del adaptador (sólo en memoria):

```js
{ id, type: 'pos.surface' | 'pos.zone' | 'pos.decor' | 'pos.table' | 'polygon',
  transform: { x, y, rotation }, geometry: { width, height, points? },
  style: {...}, properties: { kind, label, color, round, capacity, chairStyle, name, status, dimmed, tableId } }
```

## 11. Prisma impact

N/A.

## 12. API contract

Sólo Canvas: `pos_table` en `DATA_SOURCES` (`module: 'runly.pos'`,
`permission: 'pos.floor.read'`), con proveedor de resolución y búsqueda por
nombre (`PosTable` de la empresa, `enabled`).

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

Vista operativa: sin cambios (permisos de POS). `pos_table` como dato:
`pos.floor.read`.

## 19. Multi-company behavior

`pos_table` filtra por `companyId`.

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Decimales de Prisma serializados como string: el adaptador los convierte.
2. Elemento de mesa sin `tableId` o con mesa inexistente: se dibuja como mesa
   "Disponible" con su etiqueta, igual que hoy.
3. Polígonos con puntos absolutos: se convierten a puntos relativos a su caja.
4. Salón vacío: se muestra la superficie y se ajusta a ella.
5. Rotación de elementos: se respeta (`transform.rotation`).

## 24. Risks

1. Regresión visual en la operación diaria → pruebas puras del adaptador y
   de geometría de sillas; mantener los mismos colores/textos; el componente
   antiguo se elimina sólo cuando el nuevo compila y pasa pruebas.
2. Acoplamiento POS → Canvas → el motor se importa desde
   `runly.canvas/engine` y `components/CanvasViewport` (código del desktop,
   siempre presente aunque el módulo Canvas esté desactivado).

## 25. Acceptance criteria

1. Dados elementos de POS con decimales en string, cuando se adaptan, entonces
   los objetos tienen números y los polígonos puntos relativos 0..1.
2. Dada una mesa OCCUPIED con 4 de capacidad, cuando se dibuja, entonces usa
   el color de anillo `#d97706` y 4 sillas.
3. Dado un toque sobre una mesa en la vista operativa, entonces se llama
   `onTableClick` con la mesa; sobre decoración, no.
4. Dada una mesa de POS conectada en un Board, cuando está ocupada, entonces
   su tono es `warning` y su resumen empieza con "Ocupada".

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js`
- `npx eslint` de archivos tocados; `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: pantalla de mesas en tablet y escritorio, cambiar estados.

## 27. Rollback plan

Sin migraciones; revertir commits restaura `FloorOperationalCanvas`.

## 28. Future enhancements

1. 6b: planificador sobre el motor de Canvas.
2. Insertar un salón de POS completo en un Board como capa de datos.
