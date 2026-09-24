# Call spotlight polish, round 2 — Design

Date: 2026-09-23
Status: Approved
Module: `runly.chat` (`calls/`)

## 1. Feature title

Ajustes de spotlight en llamadas: aspect ratio de miniaturas con cámara de
celular, chat de invitados unificado con la conversación real, cámara y
pantalla compartida como entidades independientes, y prioridad visual por voz
activa.

## 2. Status

Approved

## 3. Context

`docs/superpowers/specs/2026-09-22-call-spotlight-pin-overhaul-design.md`
introdujo el `SpotlightLayout` unificado (tile principal + franja de
miniaturas) compartido entre `CallRoom.jsx` (miembros) y `GuestCallRoom.jsx`
(invitados). `docs/superpowers/specs/2026-09-06-chat-in-call-panel-design.md`
ató el chat en vivo a la conversación real (`ChatWindow embedded="call"`) —
pero solo para llamadas **sin invitados**; en cuanto hay un invitado
(`hasGuests`), `CallChatPanel.jsx` cambia a `roomMode="call"` y monta
`CallRoomChat`/`RoomChatView`, un chat efímero respaldado por la tabla
`call_message` (introducida en
`docs/superpowers/specs/2026-09-06-call-guest-access-design.md`, que dejó
explícitamente como no-goal "Persisting guest chat into `chat_messages` / the
org conversation").

Revisando el código actual tras esos dos specs (`ParticipantTile.jsx`,
`SpotlightLayout.jsx`, `calls/lib/callLayout.js`, `CallRoom.jsx`,
`CallChatPanel.jsx`, `guest-service.js`, la migración
`20260906000000_call_guest_access`):

- `ParticipantTile`/`TrackRenderer` usa `object-cover` (`fit="auto"`) para
  cualquier tile que no sea el principal — franja de `SpotlightLayout`, grid
  clásico de 3+, y el `DraggablePip`. `object-cover` no distorsiona el video,
  pero para una cámara de celular en vertical forzada a un tile
  `aspect-video` (horizontal), el recorte es tan agresivo que el resultado se
  percibe como una imagen alargada/deformada — la cámara de escritorio, cuyo
  aspect ratio ya se parece al del tile, no muestra el problema.
- `hasGuests ? "call" : "conversation"` en `CallRoom.jsx` es la única señal
  que decide si el chat en vivo es la conversación real o el chat efímero.
  Los invitados ya piden nombre (obligatorio) y correo (opcional) para unirse
  (`call_guest.display_name`/`email`), pero ese nombre nunca llega a
  `chat_messages` — sus mensajes viven y mueren en `call_message`.
- En `SpotlightLayout`/`spotlightStrip` (`calls/lib/callLayout.js`), cuando
  quien comparte pantalla es también el spotlight automático (caso más común:
  nadie fijó a nadie), `others` lo excluye por completo por identidad — su
  cámara (si la tiene encendida) desaparece de la franja aunque LiveKit siga
  publicando ambos tracks (`Track.Source.Camera` y `Track.Source.ScreenShare`)
  de forma independiente para ese participante.
- `RoomEvent.ActiveSpeakersChanged` ya está suscrito en `CallRoom.jsx` (dispara
  `refresh()`), y LiveKit ya expone `room.activeSpeakers` /
  `participant.isSpeaking` — no hay ninguna pieza de infraestructura de voz
  activa por construir, solo falta usarla en el render.

## 4. Problem

1. Un participante que se une desde el celular (cámara en vertical) se ve
   alargado/deformado en la franja de miniaturas del spotlight, a diferencia
   de una cámara de escritorio en la misma franja.
2. El chat de una llamada con invitados es un chat "externo" efímero que no
   se guarda en la conversación — a pesar de que el invitado ya se identificó
   con nombre y correo al unirse, lo que haría posible tratarlo como
   cualquier otro remitente de esa conversación.
3. Cuando alguien comparte pantalla y esa pantalla es el spotlight (caso
   automático, sin pin manual), su propia cámara deja de mostrarse en
   cualquier parte de la interfaz — solo se ve o la pantalla o la cámara,
   nunca ambas, aunque LiveKit las trate como dos tracks independientes.
4. La franja de miniaturas es estática: no hay ninguna señal visual de quién
   está hablando ni una reordenación que traiga al frente a quien tiene la
   palabra, a diferencia de Teams/Meet/WhatsApp.

## 5. Goals

1. Un tile de cámara (franja de `SpotlightLayout`, grid clásico, y
   `DraggablePip`) cuyo track de video sea de orientación vertical se
   renderiza centrado y completo (`object-contain`, sin recorte agresivo),
   sin afectar cámaras horizontales, que mantienen el recorte actual.
2. Con o sin invitados, `CallChatPanel` siempre muestra el `ChatWindow` real
   atado a `Call.conversationId` para los miembros. Los mensajes de un
   invitado quedan persistidos en `chat_messages` (atribuidos por su nombre,
   igual que hoy se atribuyen los del chat externo de sitio web vía
   `chat_guest_sessions`), visibles para siempre en esa conversación. El
   invitado ve el historial completo de la conversación (no solo lo posterior
   a su ingreso) a través de su propio endpoint de sondeo (`/calls/guest/*`),
   que pasa a leer/escribir `chat_messages` en vez de `call_message`.
3. Cuando quien comparte pantalla es también el spotlight, su cámara (si está
   encendida) aparece como una miniatura más en la franja — la pantalla
   compartida sigue siendo el tile principal. Cámara y pantalla se tratan
   siempre como dos entidades independientes, nunca una sustituyendo a la
   otra.
4. Cualquier tile (franja, grid, PiP) de un participante actualmente en
   `room.activeSpeakers` muestra un anillo/resplandor sutil. Además, la
   franja de `SpotlightLayout` reordena para traer al frente a quien habla,
   con un debounce (~1.5 s de estabilidad) para no generar parpadeo con cada
   pico de audio.

## 6. Non-goals

1. No hay spotlight sincronizado ni host-controlled — sigue siendo
   preferencia local por viewer (mismo non-goal heredado del spec de
   2026-09-22).
2. No se toca la composición grabada (LiveKit Egress). El layout `speaker`
   del composite grabado (`2026-09-22-call-recording-layout-design.md`) es
   una plantilla de LiveKit fuera de este repo — este spec es exclusivamente
   sobre la UI en vivo.
3. No se corrige a nivel de códec/track ninguna metadata de rotación de video
   — el fix del aspect ratio es puramente de presentación (CSS/`object-fit`)
   basado en las dimensiones ya decodificadas del frame, no una
   reinterpretación de la orientación real de la cámara.
4. No cambia el flujo de ingreso de invitados (nombre obligatorio, correo
   opcional, lobby, códigos/links) — ver
   `2026-09-06-call-guest-access-design.md`. Solo cambia dónde viven sus
   mensajes de chat.
5. `chat_guest_sessions` (el invitado del inbox externo de sitio web,
   `runly.chat`) es una entidad completamente distinta a `call_guest` — no se
   fusionan, no se reutiliza esa tabla ni sus rutas.
6. No se elimina la tabla `call_message` ni su modelo Prisma en este spec —
   deja de escribirse (queda vacía hacia adelante) pero no se dropea; una
   limpieza de esquema es un follow-up separado y explícitamente fuera de
   alcance aquí (ver `#28`).
7. No se agrega ninguna preferencia de usuario para desactivar el
   reordenamiento por voz activa — es siempre-on, como en Teams/Meet.
8. No cambia el layout clásico de grid (3+ sin pin/pantalla) ni
   `DirectFocusLayout` para reordenar por voz activa — solo reciben el
   indicador visual, no reordenamiento (no hay "franja" que reordenar ahí).

## 7. User stories

- Como participante viendo la franja de miniaturas en una llamada, quiero que
  la cámara de alguien conectado desde su celular se vea completa y centrada,
  no alargada, igual de legible que una cámara de escritorio.
- Como anfitrión de una llamada con un invitado externo, quiero que los
  mensajes que escriba el invitado queden en la misma conversación de
  siempre, visibles después de la llamada como cualquier otro mensaje.
- Como invitado externo que ya di mi nombre para unirme, quiero escribir en
  el mismo chat que ven los demás, con historial completo, sin que se me
  redirija a un chat aparte que desaparece al colgar.
- Como usuario compartiendo mi pantalla, quiero que mi cámara se siga viendo
  en una miniatura mientras mi pantalla es el foco principal, en vez de
  desaparecer.
- Como usuario en una llamada grupal, quiero identificar de un vistazo quién
  está hablando, y que esa persona suba al frente de la franja como en
  Teams/Meet.

## 8. UX requirements

### 8.1 Aspect ratio de cámaras verticales en tiles pequeños

- `TrackRenderer` (dentro de `ParticipantTile.jsx`) detecta, al cargar
  metadata del `<video>` (`videoWidth`/`videoHeight`, evento
  `loadedmetadata` + `resize` por si cambia a mitad de llamada — p. ej. el
  usuario gira el teléfono), si el track de cámara es de orientación vertical
  (`videoHeight > videoWidth`).
- Cuando `fit === "auto"` (el valor que usan la franja, el grid de 3+, y el
  `DraggablePip` hoy) y el track es de cámara vertical, se usa
  `object-contain` (centrado, sin recorte) en vez de `object-cover`. Cámaras
  horizontales y cualquier caso donde el caller ya pide `fit="contain"`
  explícitamente (tile principal) no cambian.
- El screen-share nunca se ve afectado por esta detección — sigue forzando
  `contain` como hoy (`isScreen` ya fuerza `contain` en el código actual).
- Sin flash/salto visible: mientras no haya metadata aún (primer frame), se
  mantiene el comportamiento actual (`cover`) hasta que se conoce la
  orientación real, para no re-layoutear dos veces de forma perceptible.

### 8.2 Chat de invitados unificado

- `CallRoom.jsx`: `CallChatPanel` deja de recibir `roomMode`/`callId`
  condicionados por `hasGuests` — siempre `roomMode="conversation"`. Se
  elimina la rama `"call"` de `CallChatPanel.jsx` (`CallRoomChat`,
  `RoomChatView`, `GuestRoomChat`, `roomChat.js`/`mergeRoomMessages` quedan
  sin uso y se retiran; `useCallRoomMessages` idem si queda huérfano).
- Miembro: sin cambio visible salvo que ahora también aplica cuando hay
  invitados — mismo `ChatWindow embedded="call"` de siempre, con los mensajes
  del invitado apareciendo igual que cualquier mensaje (nombre del invitado
  como remitente, sin badge especial más allá de lo que ya exista para
  remitentes no-miembro en el chat externo de sitio web, si algo).
- Invitado (`GuestCallRoom.jsx`/`GuestCallScreen.jsx`): mantiene su propia UI
  ligera de chat (no monta el `ChatWindow` completo — esa ruta no tiene
  `AuthProvider`/sesión de miembro; ver §10 y riesgos §24). Cambia únicamente
  qué respalda esa UI: en vez de `call_message` indexado por `callId`, los
  mismos endpoints (`POST /calls/guest/messages`, `GET /calls/guest/state`,
  mismo guest token de sesión) ahora leen/escriben `chat_messages` de la
  conversación real, devolviendo el historial completo de esa conversación,
  no solo lo posterior al join.
  Ningún cambio de layout/copy en la UI del invitado salvo quitar el aviso
  "Chat temporal de la llamada — no se guarda en la conversación" (ya no es
  cierto).

### 8.3 Cámara y pantalla compartida independientes

- `spotlightStrip` (`calls/lib/callLayout.js`): `others` deja de excluir por
  completo al participante que es `mainEntry` cuando `mainIsSharing` — en su
  lugar, si ese participante también tiene un track de cámara vivo, se agrega
  como una entrada más de `others` con `preferSource="camera"` (misma
  identidad, dos tiles: uno implícito como main-pantalla, otro explícito en
  la franja como cámara). Si no tiene cámara encendida, no se agrega nada
  (comportamiento actual sin cambio).
- Aplica igual en `CallRoomLayout.jsx`, `GuestCallRoom.jsx` (ambos ya
  delegan en el mismo `SpotlightLayout`/helper) — un solo cambio en
  `callLayout.js` cubre miembros e invitados.
- El grid clásico (3+ sin pin ni pantalla) no se ve afectado — solo aplica
  cuando hay `SpotlightLayout` activo.

### 8.4 Prioridad e indicador de voz activa

- `ParticipantTile` acepta un nuevo prop `speaking` (booleano); cuando es
  `true`, agrega un anillo/resplandor sutil (`ring-2 ring-emerald-400` o
  similar, a definir en el plan de implementación con el resto de la
  paleta ya usada en `calls/`) alrededor del tile, en cualquier layout
  (franja, grid, `DraggablePip`, tile principal).
- `CallRoom.jsx`/`GuestCallRoom.jsx` derivan el set de identidades hablando
  desde `room.activeSpeakers` (ya se refresca vía `RoomEvent
  .ActiveSpeakersChanged`, que ya dispara `refresh()`) y lo pasan hacia abajo.
- Nuevo helper puro en `calls/lib/callLayout.js`, `orderBySpeaking(others,
  speakingIds, stableOrderRef)` (nombre indicativo, el plan define la firma
  exacta): reordena `others` trayendo al frente a quien esté hablando, pero
  solo cambia el orden cuando el conjunto de "quién habla ahora" lleva
  ~1.5 s estable — evita que la franja salte con cada pico de audio de una
  conversación normal. Sin voz activa reciente, el orden es el actual
  (orden de llegada/participants).
- Sin reordenamiento en el grid clásico ni en `DirectFocusLayout` — solo el
  anillo visual ahí.

## 9. Routes/screens

Sin rutas nuevas — cambios dentro de pantallas ya existentes.

| Route | Screen | Module | Description |
|---|---|---|---|
| (sin ruta) | `ParticipantTile.jsx` | runly.chat | Detección de orientación vertical + `speaking` ring |
| (sin ruta) | `SpotlightLayout.jsx` | runly.chat | Franja incluye cámara del sharer + reordenamiento por voz |
| (sin ruta) | `calls/lib/callLayout.js` | runly.chat | `spotlightStrip` no excluye la cámara del sharer; nuevo helper de orden por voz |
| (sin ruta) | `CallRoom.jsx` | runly.chat | `CallChatPanel` siempre en modo conversación; deriva `activeSpeakers` |
| (sin ruta) | `GuestCallRoom.jsx` | runly.chat | Deriva `activeSpeakers`; su chat pasa a leer/escribir `chat_messages` |
| (sin ruta) | `CallChatPanel.jsx` | runly.chat | Se retira la rama `roomMode="call"` |
| (a retirar) | `CallRoomChat.jsx`, `RoomChatView.jsx`, `GuestRoomChat.jsx`, `calls/lib/roomChat.js`, `hooks/useCallRoomMessages.js` | runly.chat | Chat efímero de llamada (lado miembro), reemplazado por 8.2 |

## 10. Data model

- `chat_messages` (sin modelo Prisma — raw SQL por convención existente en
  todo `runly.chat`, ver comentario en `prisma/schema.prisma` junto a
  `ChatMiraiRun`): nueva columna nullable `sender_call_guest_id UUID
  REFERENCES call_guest(id) ON DELETE SET NULL`, hermana de la ya existente
  `sender_guest_id` (que sigue apuntando exclusivamente a
  `chat_guest_sessions`, sin cambios). Un mensaje con `sender_type = 'guest'`
  tiene exactamente una de las dos poblada (invariante de aplicación, no un
  `CHECK` nuevo — mismo nivel de garantía que hoy tiene `sender_user_id` vs.
  `sender_guest_id`).
- `call_guest` (modelo Prisma existente): sin cambios de esquema. Su relación
  `messages CallMessage[]` deja de crecer en la práctica (nadie escribe
  `call_message` nuevos) pero no se toca el modelo.
- `call_message` (modelo Prisma existente): sin cambios de esquema, deja de
  recibir escrituras nuevas (ver non-goal #6).
- Ninguna tabla nueva.

## 11. Prisma impact

- `chat_messages` no tiene modelo Prisma (raw SQL) — el cambio es
  exclusivamente una migración SQL forward, sin tocar
  `prisma/schema.prisma` para esa tabla.
- `CallGuest`/`CallMessage` (modelos existentes): sin cambios de schema. No
  se requiere `pnpm db:generate` más allá de lo que ya esté al día.
- Nueva migración forward (`prisma/migrations/<timestamp>_chat_messages_call_guest_sender/migration.sql`):
  `ALTER TABLE chat_messages ADD COLUMN sender_call_guest_id UUID REFERENCES
  call_guest(id) ON DELETE SET NULL;` + índice
  `CREATE INDEX ... ON chat_messages(sender_call_guest_id) WHERE
  sender_call_guest_id IS NOT NULL;`.

## 12. API contract

- `POST /calls/guest/messages` (existente, `guest-routes.js` →
  `messagesService.postGuestMessage`): sin cambio de forma de
  request/response para el cliente (`{ body }` → `{ data: { message } }`).
  Cambia internamente: inserta en `chat_messages` (`conversation_id` del
  `call.conversationId`, `sender_type='guest'`, `sender_call_guest_id`,
  `body`) en vez de `call_message`.
- `GET /calls/guest/state` (existente, `guest-routes.js` →
  `guestService.getGuestState`): el campo `messages` en la respuesta pasa a
  poblarse leyendo `chat_messages` por `conversation_id`, historial completo
  (sin filtro de `created_at >= call.startedAt`), en vez de `call_message`
  filtrado por `call_id`. Forma de cada mensaje en el array sin cambios de
  campos (`id`, `body`, `senderName`, `senderKind`, `createdAt`) — solo
  cambia la fuente y ahora puede incluir mensajes de miembros anteriores a la
  llamada (parte del historial completo).
- **Retirados** (dead code, sin reemplazo — los miembros pasan a usar los
  endpoints normales de chat vía `ChatWindow`): `POST /calls/:callId/messages`
  y `GET /calls/:callId/messages` (`apps/api/src/routes/calls/index.js`,
  ~líneas 178-185), y con ellos `postMemberMessage`/`listMessages`/
  `listMessagesGuarded` en `call-messages-service.js` — solo
  `postGuestMessage` (reescrito) sobrevive en ese archivo, más una función de
  lectura para `getGuestState` (nombre a definir en el plan).
- Ningún endpoint nuevo.
- Autorización sin cambios en los endpoints de invitado: el guest token de
  sesión (`call_guest.session_token_hash`) sigue siendo el único mecanismo de
  auth — nunca se expone un JWT de miembro ni se toca RLS como
  `authenticated` para el invitado (la escritura/lectura sigue yendo por la
  API con `service_role`, igual que hoy).

## 13. SDK contract

Sin cambios de firma en `runly.calls.guest.sendMessage`/`state` — mismos
parámetros, mismo shape de respuesta (ver §12).

## 14. Validator contract

Sin nuevos schemas Zod — el body de `POST /calls/guest/send-message` no
cambia de forma.

## 15. Module manifest impact

N/A — `runly.chat` es un módulo core existente (no RME3), sin cambios de
manifest.

## 16. Navigation impact

N/A

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — sin cambios de permisos. El acceso de invitados sigue gobernado
exclusivamente por su guest token de sesión (ver `call-guest-access` spec),
nunca por un permission key de Runly.

## 19. Multi-company behavior

N/A — el mensaje de invitado se inserta en la conversación ya existente
(`Call.conversationId`), que ya está scoped a su `company_id`; no se
introduce ningún nuevo punto de entrada de datos fuera de ese scoping
existente.

## 20. Files/storage impact

N/A — no hay adjuntos nuevos en el chat de invitados (no cambia respecto a
hoy: el chat efímero tampoco soportaba adjuntos).

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — un mensaje de chat (de miembro o de invitado) no es una acción de
negocio auditable, mismo criterio que el resto de `chat_messages` hoy.

## 23. Edge cases

1. Cámara vertical que cambia a horizontal a mitad de llamada (usuario gira
   el teléfono): el listener de `resize` en `TrackRenderer` reevalúa la
   orientación y cambia de `contain` a `cover` (o viceversa) sin remount del
   `<video>`.
2. Invitado sin cámara compartiendo pantalla: sin cambio — `spotlightStrip`
   ya no agrega nada a la franja si no hay track de cámara vivo (§8.3).
3. Invitado que se une, escribe, y luego es expulsado (`KICKED`) o se le
   revoca el link: sus mensajes ya escritos en `chat_messages` permanecen
   (igual que si un miembro es removido de una conversación — el historial
   no se borra retroactivamente).
4. Dos invitados con el mismo `display_name` en la misma llamada: cada
   mensaje se atribuye por `sender_call_guest_id` (fila única por sesión de
   invitado), no por nombre — no hay ambigüedad en la atribución aunque el
   nombre visible se repita.
5. Llamada donde nunca hubo invitados: `CallChatPanel` se comporta
   exactamente igual que hoy (ya era `roomMode="conversation"` siempre en
   ese caso) — sin regresión.
6. El participante que comparte pantalla apaga su cámara mientras sigue
   compartiendo: su tile de cámara en la franja desaparece (ya no hay track
   vivo) — la pantalla sigue siendo el tile principal, sin cambios ahí.
7. Nadie habla (silencio total): `room.activeSpeakers` vacío — sin anillo en
   ningún tile, franja en su orden por defecto (sin reordenar).
8. Dos personas hablan a la vez y luego una se calla dentro de la ventana de
   debounce de 1.5 s: el helper de orden solo compromete un nuevo orden
   cuando el conjunto de hablantes activos lleva ese tiempo estable — evita
   doble reordenamiento en ese lapso.

## 24. Risks

1. Riesgo: el invitado no tiene sesión de miembro (`AuthProvider`), por lo
   que no puede montar el `ChatWindow` real (depende de hooks
   autenticados vía JWT/Supabase). Mitigación: el invitado conserva su UI de
   chat propia y ligera (polling vía guest token), solo cambia el
   almacenamiento subyacente a `chat_messages` — "el mismo chat" se cumple a
   nivel de datos/historial compartido, no de componente React compartido
   (documentado explícitamente en §8.2 para evitar ambigüedad futura).
2. Riesgo: exponer el historial completo de la conversación a un invitado
   externo es una ampliación real de superficie de datos respecto al diseño
   previo (`2026-09-06-call-guest-access-design.md` lo dejaba fuera a
   propósito). Mitigación: decisión explícita del usuario/producto
   (confirmada 2026-09-23) de que el historial completo es aceptable — un
   invitado ya requiere un link/código válido para ese `conversationId`
   específico, no puede listar ni acceder a otras conversaciones.
3. Riesgo: la detección de orientación por `videoWidth`/`videoHeight` puede
   no disparar a tiempo en navegadores lentos, mostrando `cover` por un
   instante antes de corregir a `contain`. Mitigación: aceptable — mismo
   comportamiento que hoy hasta que se resuelve, sin regresión, solo mejora.
4. Riesgo: reordenar la franja por voz activa puede sentirse "saltón" pese al
   debounce, especialmente en llamadas con muchos participantes hablando por
   turnos rápidos. Mitigación: el umbral de 1.5 s vive como constante
   nombrada en `callLayout.js`, fácil de ajustar tras probarlo en uso real
   (mismo patrón que `STRIP_TWO_ROW_THRESHOLD`).
5. Riesgo: retirar `CallRoomChat.jsx`/`RoomChatView.jsx`/`GuestRoomChat.jsx`
   podría dejar referencias huérfanas si algún otro flujo los importa fuera
   de lo relevado en este spec. Mitigación: `Grep` de todos los imports antes
   de eliminar, como parte de la verificación del plan.

## 25. Acceptance criteria

1. Given un participante conectado desde un celular en vertical con la
   cámara encendida, when aparece como miniatura en la franja del
   spotlight (o en el grid clásico, o en el `DraggablePip`), then se ve
   completo y centrado, sin recorte agresivo — una cámara de escritorio en
   el mismo lugar no cambia su apariencia actual.
2. Given una llamada con un invitado externo admitido, when el invitado o un
   miembro escribe en el chat de la llamada, then el mensaje aparece en
   `chat_messages` de la conversación real, visible para los miembros en el
   `ChatWindow` normal después de colgar.
3. Given un invitado que se une a una llamada de una conversación con
   historial previo, when abre el chat de la llamada, then ve todos los
   mensajes previos de esa conversación, no solo los posteriores a su
   ingreso.
4. Given una llamada sin ningún invitado, then el comportamiento del chat en
   vivo es idéntico al actual (sin regresión).
5. Given alguien compartiendo pantalla con la cámara encendida y sin pin
   manual activo, when se ve el `SpotlightLayout`, then la pantalla es el
   tile principal y la cámara de esa misma persona aparece como una
   miniatura independiente en la franja.
6. Given ese mismo escenario pero con la cámara apagada, then no aparece
   ninguna miniatura extra para esa persona (sin cambio respecto a hoy).
7. Given un participante hablando activamente, then su tile muestra un
   anillo/resplandor en cualquier layout donde aparezca.
8. Given dos o más participantes en la franja del spotlight y uno de ellos
   habla de forma sostenida (~1.5 s), then ese participante sube al frente
   de la franja; el orden no cambia con picos de audio aislados de menos de
   ese umbral.
9. Given el grid clásico (3+ sin pin/pantalla) o `DirectFocusLayout`, when
   alguien habla, then se ve el anillo de voz activa pero el orden de los
   tiles no cambia.

## 26. Verification plan

- `pnpm build` — sin errores de build.
- `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js` —
  cobertura de: `spotlightStrip` ya no excluye la cámara del sharer cuando es
  el main; nuevo helper de orden por voz activa (estable tras el debounce,
  sin reordenar por debajo del umbral, vuelve al orden por defecto sin
  hablantes).
- `node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js` —
  reescrito contra `chat_messages`: inserta con `sender_call_guest_id`
  correcto, `state`/lectura devuelve historial completo de la conversación
  (incluye mensajes anteriores al join del invitado), atribución por nombre
  correcta incluso con dos invitados con el mismo `display_name`.
- Migración: `pnpm db:migrate` aplica limpio contra la instancia de
  desarrollo; `pnpm db:generate` sin cambios inesperados (no hay modelo
  Prisma para `chat_messages`, así que no debería generar diffs de schema
  fuera de lo esperado).
- Manual (`pnpm dev`, dispositivo real o DevTools en modo móvil):
  - Unir un celular real (cámara vertical) a una llamada grupal; confirmar
    que su miniatura en la franja se ve completa y centrada, no alargada.
  - Llamada con invitado: escribir desde el invitado y desde un miembro;
    colgar; reabrir la conversación normal (`runly.chat`) y confirmar que
    ambos mensajes están ahí.
  - Invitado se une a una conversación con mensajes previos: confirma que ve
    el historial completo al abrir el chat de la llamada.
  - Compartir pantalla con cámara encendida sin pin manual: confirmar que la
    propia cámara del presentador aparece en la franja.
  - Hablar en una llamada de 3+: confirmar el anillo de voz activa y el
    reordenamiento con el debounce (no salta con carraspeos/ruido breve).
- `Grep` de `CallRoomChat|RoomChatView|GuestRoomChat|roomChat\.js` tras
  retirarlos, para confirmar que no quedan imports huérfanos.

## 27. Rollback plan

- Cambios de UI en vivo (§8.1, 8.3, 8.4): exclusivamente frontend, sin
  estado persistido — revertir el/los commits restaura el comportamiento
  anterior sin pasos adicionales.
- Chat de invitados (§8.2): la migración solo agrega una columna nullable con
  `ON DELETE SET NULL` — revertirla (`ALTER TABLE chat_messages DROP COLUMN
  sender_call_guest_id`) es seguro y no afecta filas existentes de
  `sender_type IN ('user','system')` ni las del guest de sitio web
  (`sender_guest_id`). Revertir el código (endpoints + UI de invitado) hace
  que las llamadas nuevas vuelvan a usar `call_message`, que sigue existiendo
  intacto (nunca se dropeó).

## 28. Future enhancements

1. Eliminar formalmente `call_message`/`CallGuestJoinAttempt` relacionados a
   chat si tras un período queda confirmado que nada más los usa —
   limpieza de esquema explícitamente diferida (non-goal #6).
2. Permitir que un invitado vea un badge visual distinto al de un miembro en
   `ChatWindow` (hoy se atribuye por nombre igual que el chat externo de
   sitio web, sin badge adicional) — pulido visual, no bloqueante.
3. Umbral de debounce de voz activa configurable o ajustado tras uso real
   (mismo patrón de "constante nombrada, fácil de tunear" que
   `STRIP_TWO_ROW_THRESHOLD`).
4. Extender la detección de orientación vertical al layout de grabación
   (Egress) si en el futuro se decide reemplazar la plantilla por defecto de
   LiveKit por una propia (contradice el non-goal #2 de este spec y del spec
   de grabación — requeriría su propio spec).
