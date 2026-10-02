# Runly Canvas — panel de capas y elementos, acciones rápidas y cambio de forma

## 1. Feature title

Panel izquierdo con árbol de capas y elementos, menú de acciones rápidas (clic derecho / pulsación larga) y conversión de formas.

## 2. Status

Complete — Verified: 2026-10-02 (node --test desktop canvas+pos 110/110, API 66/66, eslint de archivos tocados, build:web). Smoke manual pendiente (sobre todo arrastrar en móvil y pulsación larga).

## 3. Context

El panel izquierdo (`PagesLayersPanel.jsx`) lista páginas y capas en una sola
columna con una ayuda fija abajo. Con muchas páginas, las capas quedan fuera
de vista. No hay forma de ver los elementos de una capa, ir a ellos,
ocultarlos o bloquearlos individualmente, ni reordenarlos. No hay menú
contextual en el lienzo de Canvas (POS sí lo tiene en su diseñador) y una
forma creada no puede cambiar de tipo. `@dnd-kit` (con sensores táctiles),
`Accordion` y `DropdownMenu` ya existen en el repo.

## 4. Problem

1. Ayuda de capas siempre visible ocupando espacio.
2. Lista de páginas larga empuja las capas fuera de vista.
3. Sin inspector/árbol de elementos ni forma de enfocarlos.
4. Sin ocultar/bloquear por elemento ni reordenar arrastrando (en móvil
   tampoco).
5. Sin acciones rápidas en el lienzo.
6. No se puede convertir un rectángulo en círculo, etc.

## 5. Goals

1. **Páginas** como sección plegable con lista de altura máxima (≈5 filas,
   scroll interno) y la página activa siempre visible en la cabecera de la
   sección.
2. **Capas** como árbol: cada capa se pliega y despliega mostrando sus
   elementos (de arriba hacia abajo en orden visual), con contador, ojo y
   candado por capa y **por elemento**, y botón **Enfocar** (animación de
   pan/zoom hasta el elemento y destello de 1 s).
3. **Arrastrar y soltar** con asa (`GripVertical`): reordenar capas;
   reordenar elementos dentro de una capa y moverlos a otra capa. Funciona con
   mouse, teclado y táctil (pulsación de 200 ms sobre el asa).
4. Ayuda de tipos de capa **plegable** (cerrada por defecto, se recuerda).
5. **Acciones rápidas**: clic derecho en el lienzo o pulsación larga sobre un
   elemento en pantallas táctiles abre un menú en ese punto.
6. **Cambiar forma**: rectángulo ⇄ elipse ⇄ triángulo ⇄ rombo; línea ⇄
   flecha. Desde el inspector y desde el menú.

## 6. Non-goals

1. Grupos/anidar elementos.
2. Renombrar capas (se puede añadir después).
3. Bibliotecas (entrega siguiente).

## 7. User stories

1. Como editor, quiero ver qué hay en la capa "Mobiliario" y saltar a una mesa
   concreta.
2. Como editor en tablet, quiero reordenar elementos arrastrándolos con el
   dedo.
3. Como editor, quiero ocultar un solo elemento sin ocultar toda su capa.
4. Como editor, quiero convertir un recuadro en círculo sin redibujarlo.

## 8. UX requirements

Panel izquierdo (desktop y hoja en móvil):

- `Accordion` con secciones "Páginas" (abierta si hay ≤ 5 páginas, cerrada si
  hay más; la cabecera muestra la página activa) y "Capas" (siempre abierta).
- Fila de capa: chevron para plegar, ícono/etiqueta de tipo, nombre,
  contador, ojo, candado, asa. Clic en el nombre = capa activa.
- Fila de elemento (indentada): ícono por tipo, nombre (`properties.name` o
  `objectLabel`), ojo, candado, botón Enfocar (`LocateFixed`) y asa. Clic =
  seleccionar (y cambiar a su capa). Elemento seleccionado resaltado.
  Elementos ocultos o bloqueados atenuados con su ícono visible.
- Capas con más de 50 elementos muestran los primeros 50 y "Mostrar todos
  (N)".
- Ayuda de tipos: fila "¿Qué es cada capa?" plegable al final.
- Lectores: ven el árbol y Enfocar; sin asas, ojo ni candado editables.

Menú de acciones rápidas (`DropdownMenu` posicionado en el punto):

- Sobre elemento: Enfocar · Editar texto / Abrir hotspot (según tipo) ·
  Duplicar · Copiar · Cambiar forma ▸ · Mover a capa ▸ · Traer al frente ·
  Enviar al fondo · Ocultar · Bloquear/Desbloquear · Conectar a datos (si
  aplica) · Eliminar (destructivo).
- Sobre vacío: Pegar (si hay algo copiado) · Seleccionar todo · Ajustar
  vista.
- Selección múltiple (clic derecho sobre un elemento seleccionado): acciones
  que aplican a todos (Duplicar, Copiar, Traer al frente, Enviar al fondo,
  Ocultar, Bloquear, Eliminar, Mover a capa).
- Táctil: pulsación larga (450 ms) sobre un elemento lo selecciona y abre el
  menú; la pulsación larga en vacío sigue iniciando la selección por área. La
  opción "Agregar a la selección" del menú reemplaza el antiguo gesto de
  pulsación larga sobre un elemento.
- Copiar/Pegar también con Ctrl+C / Ctrl+V (portapapeles interno de la
  sesión; pega desplazado 24 px).

Cambiar forma: en el inspector, `Choice` "Forma" para formas cerradas
(Rectángulo, Elipse, Triángulo, Rombo) y para líneas (Línea, Flecha);
conserva posición, tamaño, estilo, vínculos y datos; se deshace con Ctrl+Z.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` — `BoardEditor`; nuevo panel de capas, menú
contextual, inspector.

## 10. Data model

Sin tablas. `CanvasObject.properties`: `hidden?: boolean`, `locked?: boolean`,
`name?: string` (máx. 120). Cambio de forma modifica `type`, `geometry.points`
y `properties.shape`.

## 11. Prisma impact

N/A.

## 12. API contract

Sin cambios (batch de objetos ya acepta `type` y `properties`; reordenar
capas ya existe).

## 13–19

N/A.

## 20–22

N/A.

## 23. Edge cases

1. Elemento oculto: no se dibuja ni se puede seleccionar en el lienzo; sí en
   el árbol (selección permitida para mostrarlo/enfocarlo).
2. Elemento bloqueado: se dibuja, no se puede seleccionar desde el lienzo ni
   editar; sí desde el árbol para desbloquearlo.
3. Mover un elemento a una capa bloqueada: no permitido (fila destino
   deshabilitada).
4. Mover un hotspot a una capa que no es de tipo hotspot: no permitido.
5. Cambiar forma de un elemento conectado con flechas: los conectores siguen
   funcionando.
6. Deshacer cambio de forma restaura el tipo (añadir `type` a los campos
   seguidos por el historial).
7. Enfocar un elemento en una capa oculta: muestra aviso "La capa está
   oculta".

## 24. Risks

1. Conflicto de gestos táctiles (scroll del panel vs. arrastre) → arrastre
   sólo desde el asa, con retardo de 200 ms y tolerancia de 6 px.
2. Muchas operaciones al reordenar → un solo lote con las posiciones nuevas
   de los elementos afectados.

## 25. Acceptance criteria

1. Dada una capa con 3 elementos, cuando se arrastra el último al primer
   lugar, entonces el lienzo lo pinta encima de los demás y queda un solo
   paso de deshacer.
2. Dado un elemento arrastrado a otra capa, entonces su `layerId` cambia y
   queda arriba de esa capa.
3. Dado Enfocar, entonces la vista se anima ≤ 400 ms hasta encuadrar el
   elemento y destella.
4. Dado un rectángulo, cuando se elige "Elipse", entonces se dibuja una
   elipse con la misma caja y Ctrl+Z vuelve al rectángulo.
5. Dada una pulsación larga sobre un elemento en táctil, entonces se abre el
   menú de acciones en ese punto.
6. Dado un elemento oculto, entonces no se dibuja y su fila aparece atenuada.

## 26. Verification plan

`node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js`,
`npx eslint` de archivos tocados, `pnpm --filter ./apps/desktop build:web`.

## 27. Rollback plan

Revertir commits; `properties.hidden/locked/name` quedan como JSON inerte.

## 28. Future enhancements

1. Renombrar capas y elementos desde el árbol.
2. Grupos.
3. Buscar dentro del árbol.
