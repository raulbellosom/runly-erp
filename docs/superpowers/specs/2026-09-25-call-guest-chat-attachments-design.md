# Chat de invitados de llamada con adjuntos

Date: 2026-09-25
Status: In Progress (implemented; manual QA in a live dev environment pending — see docs/superpowers/verification/2026-09-25-call-guest-chat-attachments.md)
Author: Claude Code (agent)
Spec file: docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md
Plan file: docs/superpowers/plans/2026-09-25-call-guest-chat-attachments.md (created after spec approval)

---

## 1. Feature title

Chat de invitados de llamada con adjuntos (soporte de archivos en el chat de `GuestCallRoom`).

## 2. Status

In Progress — implemented; manual QA in a live dev environment pending
(see `docs/superpowers/verification/2026-09-25-call-guest-chat-attachments.md`).

## 3. Context

`docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md` §8.2 ("Chat de
invitados unificado") ya hizo que los mensajes del invitado de una llamada
(`call_guest`) se lean/escriban en la conversación real (`chat_messages`,
`chat_conversations`), en vez de la tabla efímera `call_message`. Esa misma
spec decidió explícitamente que el invitado **no** monta el `ChatWindow`
completo (esa ruta pública no tiene `AuthProvider`/sesión de miembro) y
mantiene su propia UI ligera (`GuestRoomChat`/`RoomChatView`), documentando
esa decisión para evitar ambigüedad futura.

Esa UI ligera es solo texto plano: no puede adjuntar archivos, aunque el
invitado y los miembros ya comparten la misma conversación real y aunque el
`ChatWindow` de los miembros ya sabe renderizar mensajes con adjuntos de
cualquier remitente (el invitado incluido) sin cambios adicionales, porque
`sender_call_guest_id` en `chat_messages` ya existe desde la migración de
esa misma spec.

Por separado, este mismo trabajo también corrigió dos bugs de UI reportados
sobre la videollamada: el halo verde de "hablando" se recortaba contra el
borde redondeado del tile (`ParticipantTile.jsx`, fix de CSS ya aplicado,
fuera del alcance de esta spec), y el chat del invitado ocupaba toda la
pantalla en escritorio en vez de abrirse como panel lateral igual que a los
miembros (`GuestCallRoom.jsx`, fix de layout ya aplicado, también fuera del
alcance de esta spec). Esta spec cubre exclusivamente la brecha de
funcionalidad que queda: el invitado no puede compartir archivos.

Existe ya un precedente productivo idéntico en este mismo repo: el chat de
invitados del widget externo de sitio web (`chat_guest_sessions`, distinto de
`call_guest`) sí soporta adjuntos hoy — `POST
/public/chat/session/:token/attachments/presign` y `GET
/public/chat/session/:token/attachments/:attachmentId/url`
(`apps/api/src/routes/chat/index.js`), más el link en `sendGuestMessage`
(`apps/api/src/routes/chat/guest-service.js`), con tests dedicados en
`apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`. Esta
spec replica ese mismo patrón, ya probado en producción, para `call_guest`.

## 4. Problem

Un invitado externo admitido a una videollamada no puede adjuntar un
archivo (imagen, PDF, documento) en el chat de la llamada — solo puede
escribir texto plano. Dado que sus mensajes ya se persisten en la
conversación real de la llamada (visible para los miembros en `ChatWindow`
durante y después de la llamada), esta limitación es una brecha de
capacidad entre invitados y miembros sobre exactamente la misma
conversación, no una limitación técnica de fondo — la vía para adjuntos ya
existe y funciona para otro tipo de invitado (`chat_guest_sessions`) sobre
la misma tabla (`chat_attachments`).

## 5. Goals

1. Un invitado admitido a una llamada puede adjuntar una imagen o un
   documento a un mensaje desde el chat de `GuestCallRoom` (panel lateral en
   escritorio, vista de chat en móvil), y ese mensaje llega como un mensaje
   normal con adjunto a la conversación real de la llamada.
2. Los miembros ven ese adjunto igual que cualquier otro adjunto en
   `ChatWindow`, en vivo durante la llamada y después de que termine —
   sin cambios en el lado de miembro (ya funciona porque el mensaje sigue el
   mismo camino que cualquier `chat_messages` con adjunto).
3. Un invitado puede ver/descargar adjuntos enviados por cualquier otro
   participante (miembro u otro invitado) en el chat de esa misma llamada.
4. La subida y lectura de adjuntos del invitado queda estrictamente
   limitada a su propia sesión de `call_guest` admitida y a la única
   conversación asociada a esa llamada — sin acceso cruzado a otras
   llamadas o conversaciones.

## 6. Non-goals

1. Notas de voz / grabación de audio desde el chat del invitado (solo texto
   + adjunto de archivo, igual que el alcance ya existente del chat de
   invitado del widget externo de sitio web).
2. Paridad completa con `ChatWindow` para el invitado (reacciones,
   menciones, referencias a entidades, editar/eliminar mensajes, reenviar,
   apertura de documentos Office) — el invitado conserva su UI ligera
   propia, según la decisión ya tomada en 2026-09-23 §8.2; esta spec solo
   agrega enviar/ver adjuntos a esa UI existente.
3. Subir el límite de tamaño/tipo de archivo por encima de lo ya vigente
   para el otro flujo de invitado no autenticado (widget externo).
4. Cambios al barrido de adjuntos huérfanos (`orphan-attachment-sweep-job.js`)
   — ya cubre cualquier fila de `chat_attachments` sin importar qué tipo de
   invitado (o miembro) la subió.
5. Unificar ambos flujos de invitado (`chat_guest_sessions` y `call_guest`)
   en un solo servicio compartido — se deja como mejora futura (§28).

## 7. User stories

- Como invitado externo admitido a una videollamada, quiero adjuntar una
  captura de pantalla o un documento en el chat de la llamada, para
  compartir contexto con los miembros sin salir de la llamada.
- Como miembro en una videollamada con invitados, quiero ver los archivos
  que comparte un invitado en el mismo chat de la llamada, para no tener
  que pedirle que los envíe por otro medio.
- Como miembro, quiero seguir viendo esos archivos después de que la
  llamada termine, en la conversación normal de `runly.chat`.

## 8. UX requirements

- El chat del invitado (`RoomChatView`, usado tanto en el panel lateral de
  escritorio como en la vista de pantalla completa de móvil) agrega un
  botón de clip ("Adjuntar archivo", ícono `Paperclip` de `lucide-react`,
  mismo set de íconos ya usado en `calls/`) junto al textarea del composer.
- Al seleccionar un archivo: se muestra un estado de "Subiendo..." (spinner
  `Loader2`) inline en el composer; el envío del mensaje queda deshabilitado
  hasta que la subida termine o se cancele.
- Errores de validación (tipo no permitido, tamaño excedido, falla de red)
  se muestran como texto inline debajo del composer
  (`text-xs text-red-400`, tema oscuro fijo de `RoomChatView`), con los
  mismos textos ya usados por el chat de miembro:
  - "Tipo de archivo no permitido."
  - "Archivo demasiado grande (máx. 20 MB)."
  - "Error subiendo el archivo." (fallback genérico)
- Un mensaje con adjunto se renderiza en `RoomChatView` así:
  - Imagen (`image/*`): miniatura inline (`<img>`, `max-h-48 rounded-lg`),
    clic abre la imagen en una pestaña nueva vía URL firmada.
  - Cualquier otro tipo permitido: una "ficha" con nombre de archivo + un
    botón "Descargar" que resuelve una URL firmada bajo demanda (no se
    pre-cargan URLs para archivos no vistos, igual que el patrón ya usado
    en `getGuestAttachmentUrl`/`getAttachmentSignedUrl`).
  - Sin menú contextual, sin reacciones, sin reenviar — fuera de alcance
    (Non-goal 2).
- No hay cambio en el toggle pantalla-completa-vs-panel-lateral (ya
  corregido por separado) ni en el aviso/copy del chat del invitado más
  allá de lo ya retirado en 2026-09-23 §8.2.
- Todo texto de la UI en español, siguiendo la convención del resto de
  `runly.chat`.

## 9. Routes/screens

Sin rutas nuevas — cambios dentro de pantallas ya existentes.

| Route | Screen | Module | Description |
|---|---|---|---|
| (sin ruta, pública vía token) | `GuestCallRoom.jsx` / `GuestRoomChat.jsx` / `RoomChatView.jsx` | runly.chat | El composer del chat de invitado gana botón de adjuntar; los mensajes con adjunto se renderizan con miniatura o ficha de descarga |

## 10. Data model

### New models

Ninguno.

### Modified models

Ninguno. Se reutilizan `chat_attachments` y `chat_messages` (ambas tablas
raw-SQL, sin modelo Prisma) tal como quedaron después de la migración de
2026-09-23 (`chat_messages.sender_call_guest_id` ya existe). `chat_attachments`
ya permite `uploaded_by_user_id IS NULL` — el flujo de invitado del widget
externo ya inserta sin ese campo — por lo que un adjunto de `call_guest` se
inserta de la misma forma (sin `uploaded_by_user_id`, sin necesidad de una
columna equivalente para `call_guest`; la atribución al invitado se
resuelve, igual que hoy, a través de `chat_messages.sender_call_guest_id`
del mensaje al que el adjunto queda enlazado).

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A — no se toca `prisma/schema.prisma` ni se
requiere migración; `chat_attachments`/`chat_messages` son tablas raw-SQL ya
preparadas por la migración de 2026-09-23.

## 12. API contract

Todos los endpoints de invitado usan el mismo mecanismo de autorización que
ya usa `/calls/guest/*` hoy: el guest token de sesión (`call_guest.session_token_hash`)
como bearer token o `?gt=`, sin `requirePermission` (no es un usuario
autenticado del sistema). Ningún endpoint nuevo de miembro.

### POST /calls/guest/attachments/presign

Auth: guest token (bearer o `?gt=`), scoping vía `resolveAdmittedGuestForMessage`
(mismo helper que ya usa `postGuestMessage`).
Body: `{ fileName: string, mimeType: string, sizeBytes: number }`
Response éxito: `{ data: { attachmentId: string, uploadUrl: string } }` (201)
Response error:
- 422 `{ error: "fileName, mimeType, sizeBytes son requeridos." }`
- 422 `{ error: "Tipo de archivo no permitido." }`
- 422 `{ error: "Archivo demasiado grande (máx. 20 MB)." }`
- 404 `{ error: "..." }` si el guest token no resuelve a un invitado admitido con llamada en vivo (mismo error que ya usa `resolveAdmittedGuestForMessage`)
- 500 `{ error: "Error generando URL de subida." }`

Mismo `ALLOWED_MIME` y límite (20MB) que
`/public/chat/session/:token/attachments/presign`
(`apps/api/src/routes/chat/index.js:827-833`): `image/*`,
`application/pdf`, `text/plain`, `application/msword`,
`application/vnd.openxmlformats*`.

### GET /calls/guest/attachments/:attachmentId/url

Auth: guest token (bearer o `?gt=`), mismo scoping.
Response éxito: `{ data: { url: string, expiresIn: 300 } }`
Response error: 404 `{ error: "Adjunto no encontrado." }` si el adjunto no
pertenece a la conversación de la llamada del invitado.

### POST /calls/guest/messages (modificado)

Body actual: `{ body: string }`. Nuevo body: `{ body: string, metadata?: { attachmentId: string } }`.
`body` deja de requerir mínimo 1 carácter cuando `metadata.attachmentId`
está presente (mensaje solo-adjunto), pero sigue siendo obligatorio un
`body` no vacío o un `attachmentId` — igual que la regla ya vigente para
mensajes de miembro con adjunto.
Response: sin cambio de forma (`{ data: { message } }`).
Errores: sin cambio (422 `"Mensaje inválido."`, más los ya existentes).

## 13. SDK contract

Domain: `runly.calls.guest` (`packages/sdk/src/domains/calls.js`)

- `presignAttachment(guestToken, { fileName, mimeType, sizeBytes })` — `POST /calls/guest/attachments/presign` — retorna `{ data: { attachmentId, uploadUrl } }`
- `getAttachmentUrl(guestToken, attachmentId)` — `GET /calls/guest/attachments/:attachmentId/url` — retorna `{ data: { url, expiresIn } }`
- `sendMessage(guestToken, body, metadata)` (modificado) — agrega `metadata` opcional al body de `POST /calls/guest/messages`; `metadata` se omite del payload cuando no se pasa, preservando compatibilidad con las llamadas actuales de `useGuestCall.js`.

## 14. Validator contract

`packages/validators/src/calls.js`:

- `callRoomMessageSchema` (modificado): `body: z.string().trim().max(4000)` (se
  quita `.min(1)`), se agrega `metadata: z.object({ attachmentId: z.string().uuid() }).optional()`,
  y un `.refine` que exige `body.length > 0 || metadata?.attachmentId` (mensaje: "El mensaje no puede estar vacío.").
- `callGuestAttachmentPresignSchema` (nuevo): `{ fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }`.

## 15. Module manifest impact

N/A — `runly.chat`/llamadas son funcionalidad core existente; no se agrega
manifest, dependencia ni módulo nuevo.

## 16. Navigation impact

N/A — sin navegación nueva; la pantalla de invitado ya es una ruta pública
sin entrada de menú.

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — los endpoints de invitado no usan RBAC de `runly.identity`; se
autorizan exclusivamente por el guest token de sesión, igual que el resto
de `/calls/guest/*` hoy (ninguno de esos endpoints lleva `requirePermission`).
El lado de miembro (lectura de adjuntos vía `ChatWindow`) sigue pasando por
los permisos de chat ya vigentes en `chat-attachments-service.js`, sin
cambios.

## 19. Multi-company behavior

Las filas de `chat_attachments`/`chat_messages` heredan el `conversation_id`
ya scoped por compañía a través de `chat_conversations`. El presign y la
lectura de invitado se limitan además a la única conversación de la llamada
a la que ese `call_guest` fue admitido, resuelta vía el mismo
`resolveAdmittedGuestForMessage`/`liveCallById` que ya usa `postGuestMessage`
— un guest token nunca resuelve a una llamada de otra compañía porque se
emite exclusivamente al admitir a ese invitado en esa llamada.

## 20. Files/storage impact

Sí. Reutiliza el bucket de Supabase Storage `runly-chat` (el mismo que ya
usan todos los adjuntos de chat — ningún bucket nuevo). Convención de
`objectKey`: `conversations/${conversationId}/guest/${crypto.randomUUID()}.${ext}`
— idéntica al prefijo ya usado por el flujo de invitado del widget externo
(`apps/api/src/routes/chat/index.js:847`), reutilizado tal cual para que
ambos tipos de invitado compartan una sola convención (se distinguen del
adjunto de un miembro solo por el segmento `/guest/`, que ya existe en
producción). Sin fila en `FileAsset` — los adjuntos de chat nunca han usado
`FileAsset`; usan la tabla dedicada `chat_attachments`, sin cambios aquí.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — los mensajes/adjuntos de chat (de miembro o de invitado) nunca se han
escrito en `AuditLog`; esta funcionalidad no cambia eso.

## 23. Edge cases

1. El invitado presigna una subida y luego es expulsado/removido o sale de
   la llamada antes de enviar el mensaje — la fila queda con
   `message_id IS NULL` y la barre el `sweepOrphanChatAttachments` ya
   existente (sin cambio necesario para `call_guest`).
2. El invitado envía un mensaje con un `attachmentId` viejo o ajeno (de otra
   llamada, o ya enlazado) — el `UPDATE ... WHERE id=... AND conversation_id=...
   AND message_id IS NULL` scoped hace no-op, igual que el comportamiento ya
   probado para el invitado del widget externo (`guest-attachment-link.test.js`:
   "does not bump attachment_count when nothing was linked").
3. El estado del invitado cambia (silenciado/removido) entre el presign y el
   envío — `postGuestMessage` ya vuelve a resolver
   `resolveAdmittedGuestForMessage` al enviar, así que un invitado removido
   falla el envío (y por lo tanto el enlace del adjunto) igual que ya falla
   hoy un mensaje de texto plano de un invitado removido.
4. La llamada termina entre el presign y el envío — `loadCall` en
   `call-messages-service.js` ya resuelve el `conversationId` de cualquier
   fila de `call` sin importar su estado en vivo; sin cambio de
   comportamiento.
5. Subida grande mientras la cámara/micrófono del invitado siguen publicando
   — la subida corre en un `fetch()` PUT aparte hacia Supabase Storage, sin
   relación con la conexión RTC de LiveKit; sin contención nueva.
6. El invitado cierra y reabre el panel de chat (escritorio) a mitad de una
   subida — el estado de la subida vive en el composer local; si el
   invitado navega fuera antes de terminar, cae en el caso 1 (barrido
   posterior).

## 24. Risks

1. Riesgo: un endpoint de subida de archivos no autenticado (solo con guest
   token, sin RBAC) amplía la superficie de ataque anónima (subidas
   abusivas, de gran tamaño o maliciosas). Mitigación: se reutiliza
   exactamente la misma lista blanca (`image/*`, PDF, texto, doc/docx) y el
   mismo límite de 20MB ya probados en producción para el widget externo; el
   guest token en sí solo se emite tras el flujo existente de
   invitación/código/admisión de sala de espera (`joinAsGuest`), así que un
   atacante necesita ya tener una invitación o código válido de llamada
   antes de poder llamar a este endpoint.
2. Riesgo: un invitado malicioso podría intentar leer `GET
   /calls/guest/attachments/:id/url` con IDs de adjuntos fuera de su
   conversación. Mitigación: la consulta se limita al `conversationId`
   propio del invitado (vía su `call_guest` → `call.conversationId`),
   idéntico al patrón ya implementado y probado para
   `chat_guest_sessions`.
3. Riesgo: divergencia entre las dos implementaciones paralelas de "adjunto
   de invitado no autenticado" (`call_guest` vs. `chat_guest_sessions`) con
   el tiempo. Mitigación: esta spec replica deliberadamente las constantes y
   la forma de la implementación del widget externo en vez de inventar unas
   nuevas; una extracción a un helper compartido queda como mejora futura
   (§28).

## 25. Acceptance criteria

1. Dado un invitado admitido en escritorio con el panel de chat abierto,
   cuando adjunta y envía un PNG menor a 20MB, entonces el mensaje aparece
   en su propia vista con una miniatura inline, y aparece en el
   `ChatWindow` de un miembro (en vivo) con el nombre del invitado como
   remitente y un adjunto de imagen descargable.
2. Dado el mismo escenario después de que la llamada terminó, cuando un
   miembro reabre la conversación en `ChatWindow`, entonces el mensaje con
   adjunto del invitado sigue presente y descargable.
3. Dado un invitado que intenta adjuntar un video de 30MB, cuando lo
   selecciona, entonces la subida se rechaza con "Archivo demasiado grande
   (máx. 20 MB)." y no se envía ningún mensaje.
4. Dado un invitado que intenta adjuntar un archivo `.exe`, cuando lo
   selecciona, entonces se rechaza con "Tipo de archivo no permitido." y no
   se envía ningún mensaje.
5. Dado un invitado que presigna una subida pero nunca envía el mensaje
   (cierra la pestaña), cuando el barrido de huérfanos corre después de su
   umbral, entonces la fila pendiente de `chat_attachments` y su objeto en
   storage se eliminan.
6. Dado un `attachmentId` de la conversación de otra llamada, cuando el
   invitado intenta enviar un mensaje referenciándolo, entonces el mensaje
   se envía solo como texto (sin adjunto enlazado, sin error) — mismo
   comportamiento no-op ya cubierto por los tests existentes del flujo de
   invitado de sitio web.
7. Dado un invitado en móvil (chat reemplaza el video), cuando adjunta y
   envía un archivo, entonces el flujo funciona igual que en escritorio —
   sin regresión del fix de layout ya aplicado por separado.

## 26. Verification plan

- `pnpm build` — sin errores de build.
- `node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js` — pasan los tests existentes más los nuevos de enlace de adjunto.
- Nuevos tests unitarios que reflejan `guest-attachment-link.test.js` para el path de `call_guest`: scoping del presign, no-op de enlace con id ajeno/viejo, incremento de `attachment_count`.
- `node --check` sobre cada archivo backend nuevo/modificado.
- Manual: unirse a una llamada como invitado por un link real (entorno de dev), adjuntar una imagen desde el panel lateral, confirmar que aparece para un miembro en `ChatWindow` en vivo y que persiste tras colgar.
- Manual: confirmar que los mensajes de error (tamaño/tipo) se ven correctamente en la UI del invitado, en escritorio y en móvil.
- Manual: confirmar que el flujo de invitado en móvil (chat reemplaza el video) sigue funcionando sin regresión.

## 27. Rollback plan

Totalmente aditivo — sin migración de base de datos. Revertir el/los
commits elimina los dos endpoints nuevos de invitado, los métodos nuevos
del SDK, y la UI de adjuntar archivo del composer del invitado; el manejo
de `metadata.attachmentId` en `postGuestMessage` vuelve a texto plano
únicamente, igual que el comportamiento de hoy. No se requiere limpieza de
datos — los adjuntos ya enviados siguen siendo válidos y legibles por los
miembros a través de los endpoints de adjunto ya existentes del lado de
miembro, sin importar quién los enlazó originalmente.

## 28. Future enhancements

1. Notas de voz desde el chat de invitado (requeriría el mismo manejo de
   `durationMs` que ya usa el composer de miembro).
2. Un `createGuestAttachmentService` compartido, consumido tanto por
   `chat_guest_sessions` (sitio web) como por `call_guest` (videollamada),
   para eliminar la duplicación actual entre ambas implementaciones de
   presign/enlace/lectura.
3. Reutilizar el renderer de adjuntos enriquecido del lado de miembro
   (miniaturas, menú contextual, apertura de Office) dentro del chat de
   invitado, si la paridad de UX del invitado se vuelve prioridad más
   adelante.
