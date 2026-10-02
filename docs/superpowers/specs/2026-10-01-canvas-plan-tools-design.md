# Runly Canvas — herramientas de plano (4a): escala, medición, alinear y exportar

## 1. Feature title

Canvas Fase 4a — escala real, medición, alinear/distribuir y exportación.

## 2. Status

Approved (decisión delegada por el usuario, 2026-10-01).

## 3. Context

Cuarta iniciativa del roadmap. Se divide en 4a (esta spec) y 4b (conectores
pegados a formas y fondo PDF nítido). `CanvasPage.calibration` y
`coordinateSystem` existen desde la fundación sin interfaz. `jspdf` y
`pdfjs-dist` ya son dependencias del desktop.

## 4. Problem

1. Un plano no puede medirse en unidades reales: todo está en píxeles.
2. No hay forma de alinear ni distribuir varios objetos.
3. No se puede sacar el Board del sistema (imprimir, enviar por correo).

## 5. Goals

1. Calibrar la escala de una página trazando una línea de longitud conocida.
2. Herramienta "Medir" (M) para distancias en unidades reales.
3. Medidas del objeto seleccionado (ancho, alto, longitud, área, perímetro)
   en unidades reales cuando la página está calibrada.
4. Alinear (izquierda, centro, derecha, arriba, medio, abajo) y distribuir
   (horizontal/vertical) la selección múltiple.
5. Exportar la página actual a PNG y PDF.

## 6. Non-goals

1. Cotas persistentes dibujadas en el plano.
2. Escala distinta por capa.
3. Exportar todas las páginas en un PDF (sólo la actual).
4. Conectores y PDF nítido (4b).

## 7. User stories

1. Como encargado de obra, quiero calibrar el plano con una pared de 5 m y
   medir cualquier distancia en metros.
2. Como editor, quiero ver el área en m² de una zona dibujada.
3. Como editor, quiero alinear varios estantes con un clic.
4. Como usuario, quiero exportar el plano a PDF para imprimirlo.

## 8. UX requirements

- Indicador de escala junto a los controles de zoom: "Sin escala" o
  "1 m = 42 px"; menú con "Calibrar escala" y "Quitar escala" (editores).
- "Calibrar escala" activa la herramienta de calibración: el usuario
  arrastra una línea; al soltar se abre un diálogo "Calibrar escala" con
  "Longitud real" (número > 0) y "Unidad" (`SelectField`: m, cm, mm, ft) y
  "Guardar".
- Herramienta "Medir" (M, botón en la barra inferior con ícono `Ruler`):
  arrastrar muestra una línea discontinua con la longitud en una etiqueta;
  la medición queda visible hasta Esc, otro clic o cambiar de herramienta.
  Disponible también para lectores. Shift restringe a 45°.
- Inspector de un objeto: sección "Medidas" con ancho/alto (o longitud para
  líneas), área y perímetro para formas cerradas, en la unidad calibrada o en
  px; sin calibración muestra la pista "Calibra la escala para medir en
  unidades reales.".
- La etiqueta de tamaño durante redimensionar usa la unidad calibrada.
- Multiselección: sección "Alinear" con 6 botones de alineación y 2 de
  distribución (éstos deshabilitados con menos de 3 objetos). Los objetos en
  capas bloqueadas no se mueven.
- Barra superior: menú "Exportar" (ícono `Download`) con "Imagen PNG" y
  "PDF". La exportación usa tema claro y fondo blanco, incluye imágenes
  (si el almacenamiento permite CORS) y los datos conectados visibles. El
  PDF incluye nombre del Board, página, fecha y escala si existe.
- Textos en español, sin emojis, componentes `@runly/ui`.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` — `BoardEditor`, `CanvasViewport`,
`CanvasToolbar`, `EditorTopBar`, inspector; nuevos `ScaleControl`,
`CalibrateDialog`, `MeasuresSection`, `ExportMenu`.

## 10. Data model

Sin tablas nuevas. `CanvasPage.calibration`:

```js
{ a: { x, y }, b: { x, y }, distance: number, unit: 'm' | 'cm' | 'mm' | 'ft' } | null
```

## 11. Prisma impact

N/A.

## 12. API contract

`PATCH /canvas/boards/:id/pages/:pageId` ya acepta `calibration`; se añade
validación: `null` o la forma de arriba con puntos finitos distintos,
`distance` finito > 0 y `unit` en la lista. 400 si no es válida.

## 13. SDK contract

Sin cambios (`updatePage` existe).

## 14. Validator contract

N/A.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

Calibrar = editar página (`canvas.edit` + EDITOR). Medir y exportar: cualquier
rol con acceso al Board.

## 19. Multi-company behavior

Sin cambios.

## 20. Files/storage impact

Exportar descarga en el navegador; no se guarda en Files.

## 21. Export/import requirements

PNG (2× la escala del mundo, máx. 8000 px por lado) y PDF (A4, orientación
según la proporción, imagen ajustada con márgenes de 10 mm, encabezado con
nombre del Board, página, fecha y escala).

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Calibración con los dos puntos iguales o longitud ≤ 0: el diálogo no
   permite guardar; la API responde 400.
2. Objetos rotados: alinear usa sus límites (bounding box) y mueve
   `transform.x/y` por la diferencia.
3. Distribuir con 2 objetos: botones deshabilitados.
4. Página vacía: "Exportar" deshabilitado.
5. Imágenes sin CORS: se exportan como marcadores (igual que miniaturas).
6. Lectores no ven "Calibrar" ni "Quitar escala".

## 24. Risks

1. Exportaciones grandes consumen memoria → límite de 8000 px por lado.
2. Descarga en Tauri → usar el helper de descarga existente del repo si lo
   hay; si no, enlace `blob:` con `download`.

## 25. Acceptance criteria

1. Dada una línea calibrada de 420 px = 10 m, cuando se mide una distancia de
   84 px, entonces se muestra "2 m".
2. Dado un rectángulo de 210×84 px con 42 px = 1 m, cuando se selecciona,
   entonces el inspector muestra 5 m × 2 m, área 10 m² y perímetro 14 m.
3. Dados 3 objetos, cuando se alinean a la izquierda, entonces sus límites
   izquierdos coinciden con el menor.
4. Dados 3 objetos, cuando se distribuyen en horizontal, entonces los espacios
   entre ellos son iguales.
5. Dada una calibración con `distance: 0`, cuando se hace PATCH, entonces
   responde 400.
6. Dada una página con contenido, cuando se exporta a PDF, entonces se
   descarga un archivo `.pdf` con el nombre del Board.

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` de archivos tocados y `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: calibrar, medir, ver medidas, alinear, exportar PNG/PDF.

## 27. Rollback plan

Sin migraciones; revertir commits. Las calibraciones guardadas quedan como
JSON inerte.

## 28. Future enhancements

1. Cotas persistentes.
2. Exportar todas las páginas.
3. Imprimir a escala exacta (1:50, 1:100).
