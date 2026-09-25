# Rediseño visual del chat ligero de invitados de llamada

Date: 2026-09-25
Status: In Progress (implemented; manual visual QA in a live dev environment pending — see docs/superpowers/verification/2026-09-25-guest-room-chat-visual-redesign.md)
Author: Claude Code (agent)
Spec file: docs/superpowers/specs/2026-09-25-guest-room-chat-visual-redesign-design.md
Plan file: docs/superpowers/plans/2026-09-25-guest-room-chat-visual-redesign.md (created after spec approval)

---

## 1. Feature title

Rediseño visual de `RoomChatView.jsx` (chat de invitados de videollamada) para que se sienta tan pulido como el `ChatWindow` de miembros, sin depender de sesión de miembro.

## 2. Status

In Progress — implemented; manual visual QA in a live dev environment
pending (see `docs/superpowers/verification/2026-09-25-guest-room-chat-visual-redesign.md`).

## 3. Context

`docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md` agregó
adjuntos al chat ligero del invitado (`RoomChatView.jsx`), reutilizando el
mismo componente presentacional que ya usaban `CallRoom.jsx` (miembro, hoy
retirado a favor de `ChatWindow`) y `GuestCallRoom.jsx` (invitado). El
usuario pidió reconsiderar que el invitado use "el chat normal"
(`ChatWindow`) — se investigó a fondo y se confirmó que **ningún** invitado
anónimo del sistema usa `ChatWindow` hoy, ni siquiera el del widget externo
de sitio web (`chat_guest_sessions`): `ChatWindow` depende de `useAuth()`
(sesión JWT de miembro) en más de una decena de hooks (mensajes, detalle de
conversación, búsqueda, hilos, fijados, reacciones, perfil, MirAI,
presencia, llamadas). Adaptar todo eso para un guest token anónimo sería un
cambio de arquitectura grande y de alto riesgo, y ampliaría mucho la
superficie de endpoints expuestos a usuarios anónimos.

Se presentaron dos caminos al usuario y eligió el de bajo riesgo: mantener
`RoomChatView` como componente propio (sin sesión), pero invertir en que su
apariencia sea de primer nivel — comparable a la burbuja/composer real de
`ChatMessageBubble.jsx`/`MessageComposer.jsx` — usando solo las partes
puramente presentacionales de esos componentes (agrupación de mensajes por
remitente, avatar solo en el último de un grupo, burbujas con "pico",
imagen+texto fusionados en una sola tarjeta), sin arrastrar nada de su
lógica dependiente de sesión (menús contextuales, reacciones, hilos,
menciones, reenviar, buscar).

## 4. Problem

El chat de invitado (`RoomChatView.jsx`) es visualmente plano comparado con
el chat real de la plataforma: cada mensaje repite el nombre del remitente y
la hora, no hay agrupación visual de mensajes consecutivos del mismo
remitente, la burbuja no tiene "pico" ni distinción de esquinas, y la
imagen con texto se muestra como dos elementos separados en vez de una
tarjeta fusionada. El resultado se siente como un prototipo, no como parte
de la misma plataforma que ve un miembro en `ChatWindow`.

## 5. Goals

1. Los mensajes consecutivos del mismo remitente se agrupan visualmente:
   el nombre y el avatar solo aparecen en el primer/último mensaje del
   grupo respectivamente (igual que `ChatMessageBubble.jsx`/
   `ChatMessageList.jsx`), no en cada burbuja.
2. Las burbujas tienen un radio de esquina que distingue "primero/medio/
   último de un grupo" (efecto "pico"), igual en espíritu al patrón de
   `bubbleRadius` de `ChatMessageBubble.jsx`, adaptado a valores Tailwind
   fijos (sin depender de las variables CSS del theme de chat de miembros).
3. Un mensaje con imagen + texto se renderiza como una sola tarjeta fusionada
   (imagen arriba a sangre, texto abajo con padding), igual en espíritu al
   patrón `MediaCaptionBubble`.
4. El composer tiene un acabado visual pulido (contenedor redondeado,
   estados disabled/enviando claros, spinner) consistente con el resto de
   `calls/` (mismos tonos slate/violet ya usados).
5. El auto-scroll respeta si el invitado se desplazó hacia arriba a leer
   historial (no lo interrumpe saltando al fondo en cada mensaje nuevo);
   aparece un botón "ir al último mensaje" cuando no está al fondo y llega
   un mensaje nuevo.

## 6. Non-goals

1. Indicador de "escribiendo..." — requeriría plomería nueva de tiempo real
   (una señal efímera del invitado hacia los miembros, y del `MessageComposer`
   de miembro hacia el invitado a través del canal de datos de LiveKit, que
   hoy no existe para el chat de miembro dentro de una llamada). Se deja
   como mejora futura (§28).
2. Recibos de lectura ("visto"/doble check) — el invitado no tiene un
   concepto de "leído por" implementado ni forma de saberlo sin nueva
   plomería; fuera de alcance.
3. Colores de avatar por hash de usuario — se investigó y no existe ningún
   patrón así en el repo (todo usa un color fijo de acento); se mantiene el
   acento violeta único ya usado en `RoomChatView`/`ParticipantTile`, sin
   inventar un sistema nuevo de color-por-usuario.
4. Cualquier funcionalidad de miembro (buscar, fijar, reenviar, reaccionar,
   hilos, menús contextuales, MirAI) — el chat de invitado sigue siendo
   deliberadamente más simple, per la decisión de 2026-09-23 §8.2 y la
   decisión de este mismo hilo de no migrar a `ChatWindow`.
5. Cambios al layout de pantalla completa vs. panel lateral (ya resuelto
   por separado) ni a la lógica de adjuntos (ya resuelta en la spec de
   2026-09-25 de adjuntos) — esta spec es exclusivamente visual sobre los
   mismos datos/props que ya existen.

## 7. User stories

- Como invitado externo en una videollamada, quiero que el chat se vea y
  se sienta como parte de la misma plataforma (no como un prototipo aparte),
  para tener confianza en la herramienta que estoy usando.
- Como miembro anfitrión, quiero que la experiencia que ve mi invitado sea
  presentable, ya que refleja la imagen de la empresa que usa Runly ERP.

## 8. UX requirements

- Agrupación por remitente consecutivo (mismo criterio que
  `ChatMessageList.jsx`: mismo `senderName`+`senderKind`, sin separador de
  fecha ya que el chat de invitado no pagina historial de días distintos
  como el chat de miembro — si el rango de fechas cruza un día, un
  separador simple de fecha es aceptable pero no obligatorio para v1).
- Mensaje ajeno: avatar circular (28px, iniciales, acento violeta) solo en
  el último mensaje de un grupo consecutivo; en los demás mensajes del
  grupo, un espacio invisible del mismo ancho para mantener la alineación.
  Nombre del remitente (+ "· invitado" si aplica) solo en el primer mensaje
  del grupo.
- Mensaje propio: alineado a la derecha, sin avatar, sin nombre — igual que
  hoy.
- Radio de burbuja: `rounded-2xl` con la esquina del lado del "pico"
  reducida a `rounded-md` en el primer/medio/último mensaje de un grupo
  (mismo espíritu que `bubbleRadius`, valores Tailwind fijos, no variables
  CSS del theme de miembro).
- Imagen + texto en una sola tarjeta: contenedor `overflow-hidden
  rounded-2xl`, imagen `w-full` sin padding arriba, texto con
  `px-3 py-2` abajo. Sin caption, la imagen sola conserva su propio radio
  completo (comportamiento actual).
- Composer: contenedor `rounded-2xl border border-white/15 bg-white/5`
  (ya existente), sin cambios funcionales — solo pulir estados de
  focus/disabled y el spinner de "Subiendo...".
- Auto-scroll: solo baja automáticamente si el invitado ya estaba a menos de
  ~120px del fondo antes de que llegara el mensaje nuevo. Si no, aparece un
  botón flotante pequeño "↓ Nuevo mensaje" sobre el composer.
- Todo el texto de UI en español (ya es el caso).

## 9. Routes/screens

Sin rutas nuevas — cambios dentro de una pantalla ya existente.

| Route | Screen | Module | Description |
|---|---|---|---|
| (sin ruta, pública vía token) | `RoomChatView.jsx` (usado por `GuestRoomChat.jsx` dentro de `GuestCallRoom.jsx`) | runly.chat | Rediseño visual: agrupación por remitente, burbujas con pico, tarjeta imagen+texto fusionada, auto-scroll consciente de posición |

## 10. Data model

N/A — no se agregan ni cambian campos; se reutiliza exactamente la misma
forma de `messages`/`attachments` ya definida en la spec de adjuntos
(2026-09-25).

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A — cambio 100% frontend.

## 12. API contract

N/A — no se agrega ni modifica ningún endpoint.

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

N/A — sin cambios de autorización; el chat de invitado sigue gateado
exclusivamente por el guest token de sesión, como hoy.

## 19. Multi-company behavior

N/A — sin cambios de datos ni de scoping; cambio puramente de presentación
sobre datos que ya llegan correctamente scoped desde el backend.

## 20. Files/storage impact

N/A — sin cambios de almacenamiento; los adjuntos siguen resolviéndose con
`onResolveAttachmentUrl` tal como quedó en la spec de 2026-09-25.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A

## 23. Edge cases

1. Un grupo de mensajes consecutivos del mismo remitente que incluye un
   mensaje con adjunto en medio del grupo — el adjunto se renderiza dentro
   de su propia burbuja (fusionada si tiene caption), sin romper la
   agrupación visual del resto de mensajes de texto del grupo.
2. El invitado scrollea hacia arriba a mitad de una ráfaga de mensajes
   nuevos — el auto-scroll no debe interrumpir su lectura; el botón
   "↓ Nuevo mensaje" debe aparecer y funcionar.
3. Un mensaje `senderKind` distinto (miembro vs. invitado) interrumpe la
   agrupación aunque el `senderName` coincidiera por casualidad — el
   criterio de agrupación debe considerar ambos campos, no solo el nombre.
4. Un solo mensaje sin vecinos del mismo remitente (grupo de tamaño 1) debe
   verse como hoy: burbuja con las 4 esquinas completas, avatar y nombre
   visibles (es "primero y último" a la vez).
5. Mensajes intercalados entre invitado y miembro en tiempo real (vía el
   merge de polled + LiveKit echo) no deben parpadear o re-agrupar de forma
   visualmente brusca cuando el echo local es reemplazado por la fila
   confirmada del poll — el `key` de cada burbuja debe ser estable (ya lo es,
   por `m.id ?? local:...`, ver `mergeRoomMessages`).

## 24. Risks

1. Riesgo: la lógica de agrupación (`isFirst`/`isLast`) podría desincronizarse
   entre re-renders si no es un cálculo puro derivado de `messages` en cada
   render. Mitigación: implementarla como una función pura (`useMemo` sobre
   `messages`), igual que `enrichWithGroupInfo` en `ChatMessageList.jsx`, sin
   estado local propio que pueda quedar desactualizado.
2. Riesgo: cambiar el auto-scroll a "consciente de posición" podría regresar
   a un comportamiento peor si el cálculo de "está al fondo" es incorrecto
   (ej. nunca detecta el fondo y el usuario deja de ver mensajes nuevos sin
   darse cuenta). Mitigación: umbral generoso (120px, igual que
   `ChatMessageList.jsx`) y botón "↓ Nuevo mensaje" siempre visible como red
   de seguridad cuando no se hace auto-scroll.

## 25. Acceptance criteria

1. Dado tres mensajes seguidos del mismo invitado, when se renderizan,
   then el nombre aparece solo sobre el primero y el avatar solo junto al
   último; los tres tienen esquinas de burbuja distintas (primero/medio/
   último).
2. Dado un mensaje con una imagen y un texto (caption), when se renderiza,
   then aparece como una sola tarjeta con la imagen arriba sin recorte de
   bordes y el texto debajo con padding, no como dos elementos separados.
3. Dado que el invitado scrolleó hacia arriba y llega un mensaje nuevo,
   when eso ocurre, then la vista NO salta automáticamente al fondo y
   aparece el botón "↓ Nuevo mensaje"; al hacer clic, baja al último
   mensaje.
4. Dado que el invitado está a menos de 120px del fondo y llega un mensaje
   nuevo, when eso ocurre, then la vista sí baja automáticamente, sin
   necesidad de clic.
5. Dado el mismo escenario en móvil (chat en pantalla completa) y en
   escritorio (panel lateral), when se compara visualmente, then el
   comportamiento de agrupación/burbujas es idéntico en ambos.

## 26. Verification plan

- `pnpm build` — sin errores de build (cambio solo `.jsx`, sin
  `node --check` posible).
- Revisión manual en el navegador (dev server) simulando varios mensajes
  seguidos del mismo remitente, un mensaje con imagen+caption, y scroll
  manual hacia arriba durante una ráfaga de mensajes — confirmar los 5
  criterios de aceptación.
- Confirmar que ningún test existente de `roomChat.js`/`mergeRoomMessages`
  se rompe (`node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/`
  si existen pruebas ahí para esa función).

## 27. Rollback plan

Cambio 100% frontend, sin estado persistido ni migración — revertir el
commit restaura el comportamiento visual anterior sin pasos adicionales.

## 28. Future enhancements

1. Indicador de "escribiendo..." bidireccional entre invitado y miembros
   (requiere nueva señal efímera de miembro → canal de datos de LiveKit,
   ver Non-goal 1).
2. Recibos de lectura para el invitado.
3. Separadores de fecha si el historial de una llamada larga cruza más de
   un día calendario.
