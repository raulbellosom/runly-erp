# atlas.chat — Paridad de funcionalidades del chat externo

- **Estado:** aprobado (self-approved 2026-09-08 por instrucción del usuario)
- **Módulo:** `atlas.chat` (CORE, raw-SQL con `prisma.$queryRaw`, no AME3)
- **Patrón de referencia:**
  - Operador: `apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx` + `hooks/useChatMessages.js` + `hooks/useExternalInbox.js`
  - Backend invitado: `apps/api/src/routes/chat/guest-service.js` + rutas `pub` en `apps/api/src/routes/chat/index.js`
  - Widget storefront: `packages/storefront-sdk/src/react/ChatWidget.jsx` + `useGuestChat.js` + `src/guestChat.js`

## 1. Qué entrega este spec

El chat de soporte externo (visitantes) tiene tres piezas de la misma función:

| Pieza | Rol | Estado hoy |
|---|---|---|
| **Bandeja externa** — `ExternalInboxScreen.jsx` | Lado operador dentro del ERP | `ExternalChatPane` a medida, subconjunto pobre de `ChatWindow` |
| **Widget storefront** — `ChatWidget.jsx` (`@raulbellosom/atlas-sdk/react`) | Lo que ve el visitante en el sitio del cliente | Texto + subida de archivo (rota), realtime, sin previews, sin typing/read |
| `ExternalChatWidget.jsx` (in-app) | — | **Código muerto**: cero imports en todo el repo |

El test site `C:\path\to\storefront` monta el widget storefront
vía `src/components/LiveChat.tsx` → `import { ChatWidget } from '@raulbellosom/atlas-sdk/react'`.
No usa `ExternalChatWidget.jsx`.

Este spec entrega:

1. **Limpieza**: borrar `ExternalChatWidget.jsx`, su carpeta `widget/` si queda vacía, y
   los 3 helpers huérfanos `saveGuestSession`/`loadGuestSession`/`clearGuestSession` de
   `chatUtils.js` (solo los usa ese widget).
2. **Backend**: fix del bug de adjuntos del invitado, endpoint de URL de adjunto público,
   typing bidireccional, read receipts, y borrado de mensaje del operador en el canal externo.
3. **UI operador**: `ChatWindow` gana `variant="external"` y `ExternalInboxScreen` lo
   reutiliza; se borra `ExternalChatPane`. El operador gana: paginación de historial,
   responder-a-mensaje, búsqueda en conversación, borrar/reenviar/selección múltiple,
   visor de adjuntos, vista de archivos, saltar-a-mensaje, indicadores de "escribiendo" y
   "visto por el visitante".
4. **Widget storefront**: previews inline de imagen/archivo, indicador "el agente está
   escribiendo", recibo de lectura "Visto", y envío de typing/read del propio visitante.

**No entrega** (fuera de alcance, sección 11): reacciones ni notas de voz en el widget
storefront; hilos, pins, MeridIAn y entity-references en conversaciones `external_support`
(ya bloqueados por diseño y se mantienen así); cola en worker para el fan-out de typing;
backfill de adjuntos huérfanos históricos.

## 2. Decisiones del brainstorm

| Tema | Decisión |
|---|---|
| Alcance | operador **y** widget storefront (paridad pragmática) |
| Enfoque operador | reutilizar `ChatWindow` con prop `variant`; borrar `ExternalChatPane` |
| Widget muerto in-app | **borrar** (no revivir): no lo usa nadie, ni el test site |
| Features del visitante | previews de imagen/archivo + typing/read. **No** responder-a-mensaje, **no** reacciones, **no** notas de voz |
| Forma del plan | un solo spec, un solo plan, ejecutado en 4 fases secuenciales con checkpoint entre fases |
| Exclusiones `external_support` | llamadas, MeridIAn, entity-refs y pins siguen bloqueados; hilos/reenvío heredan el comportamiento del tipo `direct` |

## 3. Limpieza de código muerto

Parte de la Fase 1 (primer commit, aislado).

- Borrar `apps/desktop/src/modules/atlas.chat/widget/ExternalChatWidget.jsx`.
- Si `apps/desktop/src/modules/atlas.chat/widget/` queda vacía, borrar la carpeta.
- Borrar de `apps/desktop/src/modules/atlas.chat/lib/chatUtils.js` las funciones
  `saveGuestSession`, `loadGuestSession`, `clearGuestSession` (líneas ~169–195). Verificado:
  solo las importa el widget que se borra.
- `grep -rn "ExternalChatWidget\|saveGuestSession\|loadGuestSession\|clearGuestSession"`
  sobre `apps/ packages/` (sin `node_modules`) debe quedar en cero tras el cambio.
- `pnpm --filter @atlas/desktop build` (o `pnpm build`) verde después.

## 4. Backend

Todo en `apps/api/src/routes/chat/`. Raw SQL. Sin modelos Prisma nuevos.

### 4.1 Fix: adjuntos del invitado nunca se enlazan al mensaje

**Bug actual.** El widget presigna un `chat_attachments` (ruta
`POST /public/chat/session/:token/attachments/presign`), sube el archivo, y luego envía un
mensaje con `metadata: { attachmentId, fileName, mimeType, sizeBytes }`. Pero
`guest-service.js#sendGuestMessage` inserta el mensaje y **nunca** hace
`UPDATE chat_attachments SET message_id = …`. `listGuestMessages` y `chatService.listMessages`
unen adjuntos por `a.message_id = m.id`, así que el archivo del invitado no se renderiza
ni para el visitante ni para el operador.

**Fix.** En `sendGuestMessage`, tras insertar el mensaje:

```js
// metadata.attachmentId llega validado por chatGuestMessageSchema (ver 4.6)
if (metadata?.attachmentId) {
  const linked = await prisma.$executeRaw`
    UPDATE chat_attachments
    SET message_id = ${msg.id}
    WHERE id = ${metadata.attachmentId}::uuid
      AND conversation_id = ${conversationId}::uuid
      AND message_id IS NULL
  `;
  if (linked > 0) {
    await prisma.$executeRaw`
      UPDATE chat_messages SET attachment_count = attachment_count + ${linked}
      WHERE id = ${msg.id}
    `;
  }
}
```

- `message_type` del mensaje del invitado con adjunto ya llega como `'file'` desde
  `sendFileMessage` — se mantiene.
- Sin backfill de filas huérfanas históricas (bajo valor; quedan sin `message_id` y
  simplemente no se muestran).
- `listGuestMessages` ya selecciona `attachments` vía subconsulta `json_agg`; una vez
  enlazados, aparecen. Añadir `objectKey` ya está; añadir nada más aquí.

### 4.2 URL firmada de adjunto para el invitado

Nuevo endpoint público:

```
GET /public/chat/session/:token/attachments/:attachmentId/url
→ 200 { data: { url: string, expiresIn: 300 } }
→ 401 sesión inválida · 404 adjunto no pertenece a la conversación de la sesión
```

Implementación (en `index.js`, junto a `pub.post(".../attachments/presign")`):

1. `guestService.resolveGuestSession(token)` → `session`.
2. Resolver la conversación de la sesión (misma subconsulta que en `presign`).
3. `SELECT bucket, object_key FROM chat_attachments WHERE id = :id AND conversation_id = :convId` — si vacío → 404.
4. `supabaseAdmin.storage.from(bucket).createSignedUrl(object_key, 300)` → devolver `signedUrl`.

No expone `object_key` crudo. TTL 300 s (el widget re-pide al renderizar).

### 4.3 Typing — invitado → operador

```
POST /public/chat/session/:token/typing   → 204 (fire-and-forget)
```

- Valida la sesión (`resolveGuestSession`), resuelve la conversación.
- `broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "guest_typing", { conversationId, at: new Date().toISOString() })`.
- Sin persistencia. Sin rate-limit de servidor más allá de lo que el cliente hace (throttle 3 s).
- El operador lo consume en `useExternalChatData` (ver 5.2): al recibir `guest_typing`,
  set de un estado `guestTyping=true` con timeout de 4 s que lo limpia.

### 4.4 Typing — operador → invitado

```
POST /chat/external/:conversationId/typing   (requirePermission("chat.support.manage"))
→ 204
```

- `broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_typing", { conversationId, at })`.
- Disparado desde el `onTyping` del `MessageComposer` cuando `variant === "external"`
  (throttle 3 s en cliente).
- El widget storefront lo consume vía `subscribeToReplies` extendido (ver 6.3).

### 4.5 Read receipts

**Migración** `prisma/migrations/<ts>_chat_guest_last_read/migration.sql`:

```sql
ALTER TABLE "chat_guest_sessions"
  ADD COLUMN IF NOT EXISTS "guest_last_read_at" timestamptz;
```

(No se toca `prisma/schema.prisma` para columnas de tablas de chat gestionadas por raw SQL;
si `chat_guest_sessions` **sí** está en el schema Prisma, añadir el campo allí también en la
misma migración — verificar en implementación y seguir el patrón existente del archivo.)

**Invitado marca leído:**

```
POST /public/chat/session/:token/read   → 204
```

- `UPDATE chat_guest_sessions SET guest_last_read_at = NOW() WHERE id = :sessionId`.
- `broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "guest_read", { conversationId, at })`.
- El operador (en `useExternalChatData`) marca sus propias burbujas como "Visto" cuando
  `guest_last_read_at >= message.created_at`.
- `listExternalInbox` y el detalle del operador exponen `guest_last_read_at` (ya se hace
  `gs.*`-style join; añadir `gs.guest_last_read_at` al SELECT de
  `chat-external-inbox-service.js#listExternalInbox`).

**Operador marca leído:** `chatExternalInboxService.markExternalRead` ya hace
`UPDATE chat_conversation_members SET last_read_at = NOW()`. Añadir al final:

```js
broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_read", {
  conversationId, at: new Date().toISOString(),
});
```

- El widget storefront consume `operator_read` → marca el último mensaje del visitante como "Visto".
- `listGuestMessages` devuelve además `operatorLastReadAt` (nuevo campo en el objeto de
  respuesta, no por mensaje): `SELECT MAX(last_read_at) FROM chat_conversation_members
  WHERE conversation_id = :convId AND user_id IS NOT NULL AND left_at IS NULL`. Permite que
  el "Visto" sobreviva recargas del widget.

### 4.6 Borrado de mensaje del operador (canal externo)

```
DELETE /chat/external/:conversationId/messages/:messageId
  (requirePermission("chat.support.manage"))
→ 200 { ok: true }
```

- Reutiliza `chatService.deleteMessage({ conversationId, messageId, authUserId })` (ya
  aplica la regla "solo el autor borra para todos" + soft-delete `deleted_at`).
- Tras borrar: `broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`,
  "new_operator_message", { conversationId, messageId, deleted: true })` para que el widget
  refresque (o el widget simplemente re-lista en el siguiente poll de 8 s — aceptable).

### 4.7 Validadores (`packages/validators/src/chat.js`)

- `chatGuestMessageSchema`: añadir `metadata` como objeto opcional con
  `attachmentId: z.string().uuid().optional()`, `fileName`, `mimeType`, `sizeBytes`
  numéricos/string opcionales. Hoy el endpoint hace `chatGuestMessageSchema.parse(body)` y
  probablemente descarta `metadata`; asegurarse de que pasa validado a `sendGuestMessage`.
- No hacen falta schemas nuevos para typing/read (sin body).

### 4.8 SDK interno (`packages/sdk/src/domains/chat.js`)

Añadir:

- `sendExternalTyping(conversationId, token)` → `POST /chat/external/:id/typing`.
- `deleteExternalMessage(conversationId, messageId, token)` → `DELETE /chat/external/:id/messages/:messageId`.

`listExternalMessages` ya existe y pega a `/chat/external/:id/messages` con `{ limit, before }`
— confirmar que soporta `before` (el backend ya lo lee, ver `index.js` línea ~744).

### 4.9 SDK storefront (`packages/storefront-sdk/src/guestChat.js`)

Añadir al dominio devuelto por `createGuestChatDomain`:

- `sendTyping(token)` → `POST /public/chat/session/:token/typing`.
- `markRead(token)` → `POST /public/chat/session/:token/read`.
- `getAttachmentUrl(token, attachmentId)` → `GET /public/chat/session/:token/attachments/:id/url` → `res.data.url`.
- `subscribeToReplies` (ver 6.3): añadir manejo de los eventos `operator_typing` y
  `operator_read` además de `new_operator_message` / `conversation_closed`. Firma nueva:
  `subscribeToReplies(conversationId, { onMessage, onTyping, onRead, onClose })`. Mantener
  compatibilidad: si el 2º arg es función, tratarlo como `onMessage` (el `ExternalChatWidget`
  muerto ya no existe, pero por si hay otros consumidores).
- `listMessages`: mapear el nuevo `operatorLastReadAt` de la respuesta (además del array).
  Cambiar el retorno de `Array` a `{ messages, operatorLastReadAt }` **rompe** a
  `useGuestChat`; en su lugar, adjuntar como propiedad no-enumerable o cambiar `useGuestChat`
  a la vez (ver sección 6). Decisión: `listMessages` devuelve `{ messages, operatorLastReadAt }`
  y se actualiza `useGuestChat` en el mismo cambio.

## 5. UI del operador — `ChatWindow` con `variant`

### 5.1 Prop `variant`

`ChatWindow` acepta `variant: "internal" | "external"` (default `"internal"`).

`ExternalInboxScreen.jsx` conserva su shell de 3 columnas — lista de conversaciones
(izquierda), panel central, `VisitorInfoPanel` (derecha) — más la barra superior con el
toggle de disponibilidad. El **panel central** deja de renderizar `ExternalChatPane` y
renderiza:

```jsx
<ChatWindow
  conversation={selected}
  variant="external"
  onClose={handleBack}          // botón "volver" en móvil
/>
```

`variant` es independiente del prop `embedded` existente (`"call" | null`) — no se
sobrecarga. En `variant === "external"`, `ChatWindow` no monta su propio
`ConversationProfilePanel` (el shell externo ya aporta `VisitorInfoPanel`); `membersView`
y sus disparadores quedan inertes en esta rama.

- `ExternalChatPane` se **borra** de `ExternalInboxScreen.jsx`.
- `VisitorInfoPanel`, `ReassignDropdown`, `useExpiryCountdown`, la lista
  `ExternalConversationItem` y el toggle de disponibilidad **se quedan** en
  `ExternalInboxScreen.jsx` (no son responsabilidad de `ChatWindow`).
- Las **plantillas** (`ChatTemplatePopover`) se mueven dentro de `ChatWindow` en la rama
  `variant === "external"`, en la fila inmediatamente encima del `MessageComposer` (hoy
  viven en `ExternalChatPane`). `ChatWindow` ya importa poco de esto; añadir el import y
  renderizarlo solo en esa rama, alimentando `vars` desde `conversation.guest_*` y
  `userProfile`.

### 5.2 Selección de datos — `hooks/useChatWindowData.js` (nuevo)

`ChatWindow` hoy llama ~10 hooks en su cuerpo (`useChatMessages`, `useSendMessage`,
`useMarkRead`, `useDeleteMessage`, `useDeleteAttachment`, `usePinMessage`,
`useToggleReaction`, `useChatPresence`, …). Para no ramificar dentro de `ChatWindow` y no
violar las reglas de hooks:

- Nuevo módulo `useChatWindowData(conversationId, variant)` que **siempre** llama a dos
  sub-hooks y devuelve el activo:
  - `useInternalChatData(conversationId, { enabled: variant === "internal" })`
  - `useExternalChatData(conversationId, { enabled: variant === "external" })`
- Cada sub-hook devuelve **la misma forma**:
  ```
  { messages, isLoading, hasMore, isLoadingMore, loadMore,
    sendMessage, markRead, deleteMessage, deleteAttachment,
    toggleReaction, typingUsers, guestLastReadAt }
  ```
- `useInternalChatData` = envoltorio delgado sobre los hooks existentes (sin cambios de
  comportamiento; `guestLastReadAt` = null, `typingUsers` = `mapTypingNames(typingUsersList)`).
- `useExternalChatData` = evolución de `useExternalInbox.js#useExternalMessages` +
  `useSendExternalMessage`:
  - `messages`: `atlas.chat.listExternalMessages(conversationId, { limit: 40 }, token)`,
    misma forma que `listMessages` interno (el backend ya usa `chatService.listMessages`).
  - `hasMore` / `loadMore`: paginación por `before = oldestMsg.created_at`, misma lógica
    que `useChatMessages` (extraer el patrón a un helper compartido si sale limpio; si no,
    duplicar las ~25 líneas — es aceptable).
  - Realtime: `subscribeToMultiBroadcast(`chat:conv:${conversationId}`, { new_guest_message,
    new_operator_message, guest_typing, guest_read, conversation_closed })`. `new_*` →
    invalidar/recargar; `guest_typing` → `typingUsers = [{ id: "guest", name: "El visitante" }]`
    con timeout 4 s; `guest_read` / snapshot inicial → `guestLastReadAt`.
  - `sendMessage(data)` → `atlas.chat.sendExternalMessage`; `markRead()` →
    `atlas.chat.markExternalRead`; `deleteMessage(id)` → `atlas.chat.deleteExternalMessage`;
    `toggleReaction` → el `useToggleReaction` existente ya funciona por conversación (se
    reusa tal cual, la ruta de reacciones no distingue tipo).
  - `deleteAttachment`: fuera de alcance para externo en v1 → no-op (el visor no ofrece
    borrar adjunto del visitante).
- Las conversaciones `enabled:false` no disparan red ni suscripciones.

`ChatWindow` reemplaza sus llamadas directas por:
```js
const data = useChatWindowData(conversationId, variant);
```
y usa `data.messages`, `data.loadMore`, etc. Los hooks que **solo** aplican a interno
(`usePinnedMessages`, `useChatConversationDetail`, `useMeridianStatus`, `useCalls`,
`useChatConversations`) quedan gateados por `variant === "internal"` /
`conversation?.type` como ya lo están por `type` hoy — auditar que ninguno dispare para
`external_support`.

### 5.3 Gating ya presente — auditar y mantener

`ChatWindow` / `ChatHeader` ya tienen `conversation?.type !== "external_support"` para:
llamadas de voz/vídeo, botón MeridIAn, `MeridianPanel`, `onAskMeridian`. `MessageComposer`
ya oculta entity-refs para `external_support` (`canAttachEntityRefs`). `usePinnedMessages`
solo corre para `channel`/`group`. **Añadir** gating `variant === "external"` para:

- Ítems del menú "more": ocultar "Archivar" y "Eliminar conversación" (el soporte se
  cierra con el botón "Cerrar" del shell externo — que se mantiene en el header, ver 5.4).
- `ForwardMessageModal`: el destino se elige de `useChatConversations` (lista interna del
  operador). Reenviar **desde** una conversación externa **hacia** conversaciones internas
  es válido y útil → se permite. Reenviar hacia otra externa no aplica (no aparece en la
  lista). Sin cambios extra.

### 5.4 Header en modo externo

`ChatHeader` gana una rama para `variant === "external"`:

- Avatar + nombre del visitante (de `conversation.guest_name ?? guest_email`), subtítulo =
  `guest_page_url` acortada.
- Sin botones de llamada/MeridIAn/perfil/pin.
- **Sí**: buscar (lupa), toggle de vista de archivos, menú "more" reducido (solo
  "Seleccionar mensajes"), y un botón **"Cerrar"** que llama `atlas.chat.closeExternal`
  (hoy vive en `ExternalChatPane`; se mueve aquí). Badge de estado (`open`/`pending`/`closed`).
- En `status === "closed"`: `MessageComposer` oculto (igual que hoy), se muestra
  `EmptyState`/aviso "Conversación cerrada".

`ChatHeader` está en ~340 líneas dentro de `ChatWindow.jsx` (1112 líneas). Extraer
`ChatHeader` a `components/ChatHeader.jsx` como parte de esta fase para no cruzar el límite
de 1000 líneas de `ChatWindow.jsx` al añadir la rama externa. Mantener la API de props.

### 5.5 `VisitorInfoPanel` — "Visto por el visitante"

Añadir una línea bajo "Estado": si `conversation.guest_last_read_at` existe, mostrar
`Visto {formatRelative(guest_last_read_at)}`; si no, "Aún no leído". El dato llega en el
row de `listExternalInbox` (ver 4.5).

### 5.6 Indicador de "escribiendo"

`ChatMessageList` ya renderiza `typingUsers`. En modo externo, `useChatWindowData` alimenta
`typingUsers = [{ name: "El visitante" }]` cuando llega `guest_typing`. El
`MessageComposer` del operador, en `variant === "external"`, pasa `onTyping` →
`atlas.chat.sendExternalTyping(conversationId, token)` con throttle de 3 s (mismo patrón
que `sendTyping` interno).

## 6. Widget storefront — `packages/storefront-sdk/src/react/ChatWidget.jsx`

Hecho a mano, **estilos inline**, **sin dependencias nuevas**, iconos SVG propios (el
widget corre embebido en sitios de terceros; no hay Tailwind ni `@atlas/ui`).

### 6.1 Previews inline de imagen/archivo

En `renderChat`, para cada mensaje con `msg.attachments?.length`:

- Resolver URL con `sdk.guestChat.getAttachmentUrl(session.token, att.id)`. Cachear en un
  `Map` en ref (`attUrlCacheRef`) por `att.id`; re-pedir si el render ocurre >4 min después
  (TTL de la firma es 300 s — pedir "a demanda" al montar cada burbuja es suficiente;
  aceptamos que una imagen vista >5 min podría necesitar reintento — añadir `onError` en el
  `<img>` que limpia la cache y re-pide una vez).
- **Imagen** (`mimeType` empieza con `image/`): `<img>` con `maxWidth: 180, maxHeight: 180,
  borderRadius: 8, cursor: pointer, objectFit: cover`. Click → overlay lightbox inline
  (posición `fixed`, `inset: 0`, `zIndex: 10000`, fondo `rgba(0,0,0,0.85)`, la imagen
  centrada a tamaño natural con `maxWidth/maxHeight: 90%`, click en cualquier lado cierra).
  El lightbox es un componente local dentro del archivo.
- **No imagen**: tarjeta con icono (`ClipIcon` ya existe), `att.fileName`, tamaño
  formateado, y un `<a href={url} target="_blank" rel="noopener">` "Descargar".
- Mientras se resuelve la URL: placeholder gris con spinner CSS inline.
- Aplica tanto a burbujas del visitante como del operador.

### 6.2 Envío de typing/read del visitante

- `textarea onChange`: además de `setTextInput`, llamar `sendTypingThrottled()` (throttle
  3 s con un ref de timestamp) → `sdk.guestChat.sendTyping(session.token)`.
- Cuando `open === true && screen === "chat"` y el documento tiene foco: llamar
  `sdk.guestChat.markRead(session.token)` al abrir y cada vez que llega un mensaje nuevo
  del operador estando abierto. Debounce 1 s.

### 6.3 Recepción — `useGuestChat` + `subscribeToReplies`

`subscribeToReplies` (en `guestChat.js`) pasa a firma de objeto:
`subscribeToReplies(conversationId, { onMessage, onTyping, onRead, onClose })` y añade
`.on('broadcast', { event: 'operator_typing' }, …)` y `{ event: 'operator_read' }`.

`useGuestChat` gana estado y lo expone:

- `operatorTyping` (bool): `onTyping` → `true` + timeout 4 s → `false`.
- `operatorLastReadAt` (string|null): de `onRead` y del `operatorLastReadAt` que ahora
  devuelve `listMessages` (al cargar y al resumir por código).
- `sendTyping(token)` y `markRead(token)` reexportados del dominio SDK (o thin wrappers que
  usan `session.token`).

`listMessages` del dominio pasa a devolver `{ messages, operatorLastReadAt }`;
`useGuestChat` se actualiza en todos sus call-sites (`useEffect` de restauración,
`resumeByCode`, poll de 8 s) para leer `.messages`.

### 6.4 Render de "escribiendo" y "Visto"

- **Escribiendo**: cuando `operatorTyping`, una fila al final del área de mensajes con el
  avatar del operador y tres puntos animados (keyframes CSS inline vía un `<style>` que el
  widget ya podría necesitar; si no hay `<style>`, animar opacidad con `setInterval` en un
  pequeño componente — preferible el `<style>` con `@keyframes`).
- **Visto**: bajo la **última** burbuja del visitante, si
  `operatorLastReadAt && new Date(operatorLastReadAt) >= new Date(lastGuestMsg.created_at)`,
  texto pequeño gris `Visto`. Si no, y el mensaje ya tiene id real (no `temp-`), `Enviado`.

### 6.5 Reconstrucción del `dist`

El paquete `@raulbellosom/atlas-sdk` se consume compilado (`main: ./dist/index.js`). Tras
los cambios: `pnpm --filter @raulbellosom/atlas-sdk build`. El test site consume el paquete
publicado/enlazado — **no** se publica una versión nueva como parte de este spec; se deja
nota en el plan de que el deploy del widget requiere `pnpm build` del paquete y re-deploy
del sitio. Verificación local: `pnpm --filter @raulbellosom/atlas-sdk build` verde + typecheck.

## 7. Modelo de datos

Una sola migración: `ALTER TABLE chat_guest_sessions ADD COLUMN guest_last_read_at timestamptz`.
Nada más. Sin índices nuevos (la columna se lee siempre junto al row de la sesión por PK/FK).

## 8. Seguridad / privacidad

- Endpoints públicos nuevos (`/typing`, `/read`, `/attachments/:id/url`) validan la sesión
  con `resolveGuestSession` (token opaco, hash SHA-256, TTL idle 30 min). El de URL de
  adjunto además comprueba `conversation_id` del adjunto contra la conversación de la
  sesión → un token no puede leer adjuntos de otra conversación.
- `/typing` y `/read` no persisten nada salvo `guest_last_read_at`; no aceptan body →
  superficie de abuso mínima (a lo sumo, ruido de broadcast; el `broadcaster` es
  fire-and-forget y ya se usa así en todo el chat de invitados).
- Throttle de cliente (3 s typing, 1 s read) evita floods desde el widget legítimo. No se
  añade rate-limit de servidor en v1 (consistente con el resto de `pub`).
- El fix de adjuntos usa `WHERE … AND message_id IS NULL AND conversation_id = :convId` →
  un `attachmentId` ajeno o ya usado no se enlaza.
- El operador sigue detrás de `requirePermission("chat.support.manage")` para todo el
  canal externo, incluido `/typing` y `DELETE …/messages/:id`.

## 9. Pruebas

### Backend — `node --test`, `apps/api/src/routes/chat/__tests__/`

- `guest-service.test.js` (nuevo o extendido):
  - `sendGuestMessage` con `metadata.attachmentId` válido → el `chat_attachments` queda con
    `message_id` y `chat_messages.attachment_count` incrementado.
  - `attachmentId` de otra conversación → no se enlaza, sin error.
  - `listGuestMessages` devuelve `operatorLastReadAt` (MAX de `last_read_at` de miembros).
- Endpoints (test de ruta con app Hono montada, patrón de `chat-service.test.js`):
  - `GET /public/chat/session/:token/attachments/:id/url` → 200 con `url`; 404 si el
    adjunto no es de la conversación; 401 si el token es inválido.
  - `POST /public/chat/session/:token/typing` y `.../read` → 204; `read` setea
    `guest_last_read_at`.
  - `POST /chat/external/:id/typing` → 204 (con permiso), 403 sin permiso.
  - `DELETE /chat/external/:id/messages/:messageId` → 200; borra solo si el operador es
    autor; soft-delete (`deleted_at`).
- Broadcasts: usar un `broadcaster` stub que capture llamadas y aserta `guest_typing`,
  `operator_typing`, `guest_read`, `operator_read` con el canal y payload correctos.

### Frontend operador — `apps/desktop/src/modules/atlas.chat/`

- `hooks/__tests__/useChatWindowData.test.js` (nuevo): con `variant="external"` selecciona
  la rama externa (mock de `atlas.chat.listExternalMessages`), expone la forma común, y
  `loadMore` pagina por `before`. Con `variant="internal"` no dispara llamadas externas.
- Actualizar cualquier test existente de `ExternalInboxScreen` / `ExternalChatPane` (si los
  hay) al nuevo render con `ChatWindow`.

### Frontend widget — `packages/storefront-sdk/`

- Test de reducer/estado de `useGuestChat` (si el paquete tiene runner; si no, test de
  `guestChat.js` puro): `subscribeToReplies` enruta `operator_typing` → `onTyping`,
  `operator_read` → `onRead`; `listMessages` devuelve `{ messages, operatorLastReadAt }`.

### Verificación en vivo (manual, tras implementar)

- `pnpm dev` + widget del test site apuntando al API local: enviar imagen desde el widget →
  se ve como miniatura en el widget y en la Bandeja externa; abrir lightbox.
- Operador escribe → widget muestra "escribiendo"; operador abre la conversación → widget
  muestra "Visto".
- Visitante escribe → Bandeja externa muestra "El visitante está escribiendo"; panel
  derecho muestra "Visto {hora}" tras marcar leído.
- QA responsive 390 y 1440 de la Bandeja externa (checklist de 14 aspectos), sobre todo el
  panel central ahora que es `ChatWindow` completo.

## 10. Alcance de implementación — un plan, 4 fases

Ejecutar en orden, commit(s) por fase, checkpoint entre fases:

1. **Fase 1 — Limpieza + Backend.** Borrado del widget muerto y helpers (commit aislado).
   Migración. Fix de adjuntos. Endpoints: URL de adjunto, typing ×2, read ×2, delete
   externo. Validadores. SDK interno + SDK storefront (métodos nuevos; `subscribeToReplies`
   nueva firma; `listMessages` nuevo retorno). Tests backend. `pnpm build` + `node --test`
   verdes.
2. **Fase 2 — `useChatWindowData` + rama interna.** Extraer `ChatHeader` a su archivo.
   Crear `useChatWindowData` / `useInternalChatData` / `useExternalChatData`. Cablear
   `ChatWindow` a `useChatWindowData` **sin** cambiar comportamiento interno (regresión
   cero para el chat principal). Tests. `pnpm build` + suite de chat verdes.
3. **Fase 3 — `variant="external"` en `ChatWindow` + `ExternalInboxScreen`.** Rama de
   header externo, plantillas movidas, gating de menú, "Visto por el visitante" en
   `VisitorInfoPanel`, `onTyping` externo. Borrar `ExternalChatPane`. Tests. QA responsive.
4. **Fase 4 — Widget storefront.** Previews + lightbox, typing/read (envío y recepción),
   `useGuestChat` actualizado, `subscribeToReplies` extendido, rebuild del `dist`. Test de
   `guestChat.js`. Verificación en vivo con el test site.

## 11. Fuera de alcance

- Reacciones y notas de voz en el widget storefront.
- Responder-a-mensaje / hilos / pins / MeridIAn / entity-refs en `external_support` (los
  bloqueos existentes se mantienen; hilos y reenvío heredan el comportamiento `direct`).
- Cola en worker para el fan-out de typing/read (fire-and-forget en proceso, como el resto
  del chat de invitados).
- Backfill de `chat_attachments` huérfanos históricos.
- Publicar una versión nueva de `@raulbellosom/atlas-sdk` y re-desplegar el test site (se
  documenta como paso de deploy, no se ejecuta aquí).
- Revivir `ExternalChatWidget.jsx` o añadir una pestaña de configuración/preview del chat
  en `WebsiteSettingsScreen.jsx`.
