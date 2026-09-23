# Call spotlight/pin UX overhaul (live) — Design

Date: 2026-09-22
Status: Approved
Module: `runly.chat` (`calls/`)

## 1. Feature title

Overhaul del spotlight/pin en vivo para llamadas 1:1 y grupales, en miembros e invitados.

## 2. Status

Approved

## 3. Context

`runly.chat`'s `calls/` ya soporta llamadas 1:1 y grupales sobre LiveKit
(`CallRoom.jsx` para miembros, `GuestCallRoom.jsx` para invitados sin cuenta),
con un pin local (no sincronizado) a spotlight introducido en
`docs/superpowers/specs/2026-09-10-call-spotlight-pin-and-hand-restyle-design.md`.
Ese diseño fue deliberadamente conservador: el pin solo se aplicaba si el
usuario lo activaba a mano, `GuestCallRoom.jsx` quedó fuera de alcance, y el
modo de screen-share mantuvo su comportamiento previo de cámaras flotando en
`DraggablePip` sobre la pantalla compartida, sin franja de participantes.

Revisando el código actual (`CallRoom.jsx`, `CallRoomLayout.jsx`,
`calls/lib/callLayout.js`, `DraggablePip.jsx`, `GuestCallRoom.jsx`):

- En 1:1 sin screen-share (`useFocusLayout`), el remoto siempre es el tile
  grande y el local siempre es un `DraggablePip` pequeño — sin forma de
  invertirlo.
- Con screen-share activo y sin pin manual, la pantalla ocupa toda la vista y
  las cámaras de los demás flotan como `DraggablePip`s arrastrables — nunca
  aparece la franja fija de participantes salvo que alguien fije manualmente.
- El botón de pin (`ParticipantTile`) usa `useCoarsePointer()` para mostrarse
  siempre en touch, pero varias rutas de render (el PiP local del focus
  layout, las burbujas de cámara durante screen-share) nunca reciben la prop
  `onPin`, así que el botón simplemente no existe ahí — no es un problema de
  CSS, es que la funcionalidad no está conectada.
- `GuestCallRoom.jsx` no comparte ningún componente con `CallRoom.jsx`: tiene
  su propio `Tile` interno, sin pin, sin `DraggablePip`, y renderiza la
  pantalla compartida como una celda más del grid (mismo síntoma que el punto
  4 de grabación, pero en vivo).
- En móvil, un selector de pestañas "Video / Pantalla / Chat"
  (`CallViewSwitcher.jsx`, helpers en `calls/lib/callChat.js`) separa la vista
  de cámaras de la vista de pantalla compartida en dos pestañas distintas.

## 4. Problem

1. En 1:1 no hay forma de intercambiar quién aparece en grande (como WhatsApp).
2. Con screen-share, la franja de participantes no aparece de forma
   consistente para todos los que están en la llamada — y nunca para quien
   está presentando.
3. El botón de "fijar a spotlight" no funciona en varios de los layouts donde
   debería estar disponible, especialmente en móvil.
4. Los invitados sin cuenta (`GuestCallRoom.jsx`) no tienen ninguna de estas
   capacidades — ven un grid plano sin pin, sin PiP arrastrable, sin franja.

## 5. Goals

1. **1:1 (member y guest), sin screen-share**: en móvil, tocar el PiP pequeño
   intercambia instantáneamente quién es el tile grande y quién es el PiP
   pequeño arrastrable (estilo WhatsApp). En desktop se mantiene sin cambios
   el botón existente de `layoutMode` (focus ↔ 50/50).
2. **Grupal (3+) o cualquier llamada con screen-share activo**: un layout de
   spotlight unificado — tile principal grande arriba/izquierda + franja de
   "los demás" (vertical en `lg+`, horizontal con scroll en móvil, pasando a
   2 filas con scroll cuando hay más de 4 miniaturas en la franja). Cualquier
   participante puede fijar (pin) a otra persona de la franja para que pase
   al tile principal; el botón de pin es visible y funcional en cada tile,
   incluyendo touch.
3. **Screen-share como spotlight automático**: en el momento en que alguien
   empieza a compartir pantalla, esa pantalla toma el tile principal
   automáticamente para todos los presentes (incluido quien presenta),
   sustituyendo cualquier pin manual previo. Cualquiera puede seguir fijando
   manualmente a otra cámara en su lugar (la pantalla pasa entonces a ser una
   miniatura más de la franja); al des-fijar, vuelve a seguir la pantalla
   compartida automáticamente. Se elimina el modo de cámaras flotando en
   `DraggablePip` durante screen-share — la franja fija lo sustituye siempre.
4. **Móvil**: la pestaña "Pantalla" del selector `Video/Pantalla/Chat`
   desaparece; "Video" pasa a mostrar siempre el layout combinado (spotlight +
   franja) cuando hay screen-share, igual que en desktop. Queda un selector
   más simple: Video / Chat.
5. **Invitados**: `GuestCallRoom.jsx` obtiene exactamente el mismo
   comportamiento (swap 1:1, spotlight de grupo/pantalla, pin, franja) que
   `CallRoom.jsx`, compartiendo componentes en vez de duplicar lógica.

## 6. Non-goals

1. No hay pin sincronizado ni "spotlight para todos" — sigue siendo una
   preferencia local por viewer, sin canal de datos ni permisos nuevos.
2. No se cambia el botón de `layoutMode` (focus/50-50) en desktop para 1:1.
3. No se cambia nada del subsistema de grabación (Egress) — eso es
   `docs/superpowers/specs/2026-09-22-call-recording-layout-design.md`.
4. No se agrega ninguna ruta, endpoint ni modelo de datos — 100% frontend.
5. No se rediseña la interacción de reacciones, alzar la mano, ni el chat de
   la llamada — se mantienen como están (solo se reubican donde el layout
   cambie de estructura).

## 7. User stories

- Como usuario en una llamada 1:1 desde el móvil, quiero tocar mi propia
  cámara pequeña para pasar a verme grande a mí (o volver a tocarla para
  volver a ver grande al otro), como en WhatsApp.
- Como usuario en una llamada grupal, quiero poder fijar a la persona que
  está hablando para verla grande, y volver a ver el grid cuando quito el pin.
- Como usuario en una llamada con screen-share, quiero que la pantalla
  compartida se vea grande automáticamente sin tener que fijarla yo mismo, y
  poder seguir viendo a los demás en una franja aunque yo sea quien presenta.
- Como invitado externo sin cuenta que entro por link desde mi celular,
  quiero la misma experiencia de spotlight/pin que tiene un miembro interno.

## 8. UX requirements

### 8.1 `DirectFocusLayout` (1:1, sin screen-share)

- Desktop: sin cambios — botón existente `layoutMode` (`focus` = remoto
  grande + local en `DraggablePip`; `balanced` = grid 50/50).
- Móvil: siempre en modo "focus" (no se muestra el botón de `layoutMode`,
  igual que hoy en `isMobile`). El PiP pequeño (`DraggablePip`) es tocable:
  un tap que no fue arrastre (`wasDrag()` false) invierte cuál de los dos
  participantes es el tile grande vía un nuevo estado local
  `directSwapped` (booleano, no sincronizado, se reinicia a `false` si deja
  de haber exactamente 2 participantes o si arranca un screen-share).
- El PiP pequeño no lleva botón de pin — el tap directo en el propio PiP es
  la interacción completa (más descubrible que un ícono pequeño encima de un
  tile ya pequeño).

### 8.2 `SpotlightLayout` (grupal 3+, o cualquier llamada con screen-share)

- Tile principal: la "entrada efectiva de spotlight" (ver §8.3), a pantalla
  completa del área principal, con botón de pin (`PinOff` si es el fijado
  manualmente; `Pin` si es la pantalla compartida siguiendo el modo
  automático — fijarla explícitamente la deja igual de fijada que cualquier
  otra persona, sin caso especial).
- Franja de "los demás": cada tile lleva su propio botón de pin. Layout:
  - Desktop (`lg+`): columna vertical a la derecha, `overflow-y-auto`
    (sin cambios respecto a hoy).
  - Móvil: fila horizontal con scroll cuando la franja tiene 4 miniaturas o
    menos; 2 filas (`grid-rows-2` dentro de un contenedor con
    `overflow-x-auto`) cuando tiene 5 o más. Este umbral vive como constante
    nombrada en `callLayout.js` para poder ajustarlo sin buscarlo en JSX.
- Si hay screen-share y la pantalla no es el tile principal (alguien fijó a
  una persona en su lugar), la pantalla aparece como una miniatura más en la
  franja (comportamiento ya existente, sin cambios).

### 8.3 Resolución de quién es el spotlight (regla única, en `callLayout.js`)

```
effectiveMain = (pin manual válido) ?? (screenShareEntry) ?? null
```

- `null` → no hay `SpotlightLayout`; se usa el grid clásico (grupal sin pin
  ni screen-share) o `DirectFocusLayout` (1:1 sin screen-share).
- Cuando **empieza** un nuevo screen-share (transición de "nadie comparte" a
  "X comparte", o de "X comparte" a "Y comparte" — otro presentador toma el
  control), cualquier pin manual existente se limpia automáticamente para que
  la pantalla gane el spotlight. Implementado como un efecto que observa la
  identidad de `screenShareEntry` y limpia `pinnedIdentity` en cada cambio de
  identidad (incluyendo la transición a "ninguno" si el share termina, para
  no dejar un pin fantasma).
- Fijar manualmente a alguien después de eso vuelve a tomar el spotlight con
  normalidad (regla ya existente); des-fijar devuelve el control automático a
  la pantalla mientras siga activa.

### 8.4 Selector móvil `Video/Chat`

- Se elimina la pestaña "Pantalla" de `CallViewSwitcher.jsx` y el estado
  `mobileView: "screen"` de `calls/lib/callChat.js` (`CALL_VIEWS` pasa a
  `["video", "chat"]`; `shouldShowScreenSegment` se elimina —ya no hace
  falta— y `nextCallView` ya no necesita colapsar `"screen"`).
- "Video" siempre renderiza lo que corresponda: `DirectFocusLayout`,
  `SpotlightLayout`, o el grid clásico, según las reglas de arriba.

### 8.5 `GuestCallRoom.jsx`

- Recibe exactamente los mismos componentes compartidos (`ParticipantTile`,
  `DraggablePip`, `DirectFocusLayout`, `SpotlightLayout`,
  `resolvePinnedEntry`/`spotlightStrip` de `callLayout.js`) que
  `CallRoom.jsx`, en vez de su `Tile` interno actual.
- Los invitados obtienen pin local igual que los miembros — es una
  preferencia de vista por viewer, no requiere ningún permiso.

## 9. Routes/screens

No hay rutas nuevas — cambios dentro de pantallas ya existentes.

| Route | Screen | Module | Description |
|---|---|---|---|
| (sin ruta) | `CallRoomLayout.jsx` | runly.chat | Nuevo `SpotlightLayout` unificado + `DirectFocusLayout` con swap táctil |
| (sin ruta) | `GuestCallRoom.jsx` | runly.chat | Reemplaza su grid propio por los mismos componentes compartidos |
| (sin ruta) | `CallViewSwitcher.jsx` | runly.chat | Pierde el segmento "Pantalla" |

## 10. Data model

N/A — sin cambios de datos, todo el estado es local a React (mismo patrón que
el pin actual: `useState` en el componente de sala, nunca persistido ni
sincronizado por data-channel).

## 11. Prisma impact

N/A

## 12. API contract

N/A — no se toca `apps/api`.

## 13. SDK contract

N/A

## 14. Validator contract

N/A

## 15. Module manifest impact

N/A

## 16. Navigation impact

N/A

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — pin/swap es una preferencia de vista local, disponible para cualquier
participante (miembro o invitado) sin gate de permiso, igual que el pin
actual.

## 19. Multi-company behavior

N/A — sin acceso a datos, no aplica scoping por compañía.

## 20. Files/storage impact

N/A

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — ninguna de estas interacciones es una acción de negocio auditable.

## 23. Edge cases

1. El participante fijado (manual o automáticamente vía screen-share) sale de
   la llamada: el pin se limpia (mismo efecto ya existente que compara
   `pinnedIdentity` contra `participants`), cae al layout correspondiente
   (grid, o de vuelta a la pantalla compartida si sigue activa).
2. Dos personas comparten pantalla "al mismo tiempo" (una empieza justo
   cuando la otra termina): `screenShareEntry` ya resuelve a una sola entrada
   (el primer match), así que el efecto de auto-limpieza de pin ve una sola
   transición de identidad — comportamiento determinista, sin parpadeo doble.
3. En 1:1, un screen-share arranca mientras `directSwapped` está en `true`
   (el usuario se había puesto a sí mismo en grande): el layout cambia de
   `DirectFocusLayout` a `SpotlightLayout` (la pantalla gana el spotlight) y
   `directSwapped` se reinicia a `false` para que, si el share termina, el
   1:1 vuelva a su default (remoto grande).
4. Llamada grupal que baja a 2 participantes (alguien sale): si había un pin
   activo sobre quien queda, se mantiene `SpotlightLayout` en vez de saltar a
   `DirectFocusLayout` — solo se usa `DirectFocusLayout` cuando la llamada
   *no* tiene pin ni screen-share activo (ver regla única §8.3); si no hay
   pin, ahí sí cae a `DirectFocusLayout`.
5. Invitado sin cámara ni pantalla (solo audio): `ParticipantTile` ya
   maneja "sin video" con el avatar de inicial — sin cambios necesarios.
6. Franja con exactamente 5 miniaturas en móvil: cruza el umbral a 2 filas —
   se verifica visualmente que 4 sigue en 1 fila y 5 ya en 2 filas.

## 24. Risks

1. Riesgo: unificar `GuestCallRoom.jsx` sobre los componentes compartidos
   podría introducir una regresión visual para invitados si algún estilo
   asumía implícitamente "solo hay un puñado de participantes, sin pin".
   Mitigación: se prueba manualmente con 1, 2 y 4+ participantes invitados
   antes de cerrar la tarea.
2. Riesgo: quitar la pestaña "Pantalla" cambia un hábito de navegación que
   algún usuario ya aprendió. Mitigación: es una simplificación neta (una
   pestaña menos, mismo contenido visible siempre en "Video"), documentado
   en este spec para quien reporte "¿dónde quedó Pantalla?".
3. Riesgo: el umbral de 4→2 filas en la franja móvil es una elección de
   diseño sin validación de usuario. Mitigación: vive como constante nombrada
   fácil de ajustar si en uso real se ve mal.

## 25. Acceptance criteria

1. Given una llamada 1:1 en móvil sin screen-share, when el usuario toca el
   PiP pequeño, then el PiP pequeño y el tile grande intercambian de
   participante instantáneamente, sin recargar la llamada.
2. Given una llamada grupal de 3+ sin pin ni screen-share, then se ve el grid
   clásico (sin cambios).
3. Given una llamada grupal, when cualquier participante toca el botón de pin
   sobre otro tile (grid o franja), then ese participante pasa a ser el tile
   principal para quien tocó el pin (y solo para esa persona).
4. Given una llamada sin pin, when alguien empieza a compartir pantalla, then
   todos los presentes (incluido quien comparte) ven la pantalla como tile
   principal con una franja de cámaras debajo/al lado, sin burbujas
   flotantes.
5. Given un pin manual activo sobre una persona, when otra persona empieza a
   compartir pantalla, then el spotlight cambia automáticamente a la pantalla
   compartida para todos los que tenían ese pin.
6. Given screen-share activo y spotlight en la pantalla, when un participante
   fija manualmente a otra persona, then esa persona pasa al tile principal y
   la pantalla compartida aparece como miniatura en la franja, solo para
   quien hizo el pin.
7. Given la franja de la vista de spotlight en móvil, when tiene 5 o más
   miniaturas, then se muestra en 2 filas con scroll horizontal en vez de 1.
8. Given un invitado sin cuenta en `GuestCallRoom.jsx`, then tiene disponibles
   swap 1:1, pin grupal, y spotlight automático de pantalla compartida, con
   el mismo comportamiento que un miembro.
9. Given el selector de vista en móvil, then solo muestra "Video" y "Chat" (ya
   no existe "Pantalla") y "Video" incluye el layout combinado cuando
   corresponde.

## 26. Verification plan

- `pnpm build` — sin errores de build.
- `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js` —
  cobertura de la nueva regla de resolución de spotlight (pin válido, screen-
  share como fallback, auto-clear al cambiar de presentador) y del cálculo de
  1 vs. 2 filas en la franja.
- Manual (dev server, `pnpm dev`, en un dispositivo real o DevTools en modo
  móvil 390px y desktop 1440px):
  - 1:1 en móvil: tap en el PiP intercambia posiciones repetidamente.
  - Grupal 3-6 participantes: pin/unpin desde grid y desde franja.
  - Screen-share arranca con y sin pin previo activo; distinto presentador
    toma el control; se detiene el share.
  - Franja móvil con 4 vs. 5+ miniaturas (1 fila vs. 2 filas).
  - Flujo completo repetido en `GuestCallRoom.jsx` vía un link de invitado.
  - Selector móvil solo muestra Video/Chat.

## 27. Rollback plan

- Cambios exclusivamente de frontend, sin migración ni estado persistido —
  revertir el/los commits del PR restaura el comportamiento anterior sin
  ningún paso adicional de limpieza de datos.

## 28. Future enhancements

1. Spotlight sincronizado/host-controlled (mismo non-goal que el spec de
   2026-09-10, sigue fuera de alcance).
2. Animación de transición al intercambiar posiciones en `DirectFocusLayout`.
3. Recordar la última preferencia de layout por conversación (hoy se
   reinicia cada llamada).
