# Grabación de llamadas (atlas.calls)

Date: 2026-09-13
Status: Proposed
Author: Claude Code (agent)
Spec file: docs/superpowers/specs/2026-09-13-atlas-calls-recording-design.md
Plan file: docs/superpowers/plans/2026-09-13-atlas-calls-recording.md (created after spec approval)

---

## 1. Feature title

Grabación de llamadas (audio + video) en atlas.calls, con salida HLS a Supabase Storage.

## 2. Status

Proposed

## 3. Context

`atlas.calls` (dentro de `atlas.chat`) ya cubre todo el ciclo de vida de una videollamada sobre LiveKit self-hosted: iniciar/unirse/salir/terminar, enlaces de invitado con código y sala de espera, admisión/expulsión/silenciar invitados, chat dentro de la llamada, reacciones, alzar la mano, spotlight/pin y compartir pantalla (ver `docs/superpowers/specs/2026-08-27-atlas-calls-livekit-design.md` y los specs de acceso de invitados/reacciones posteriores). No existe ninguna pieza de grabación: ni botón, ni integración con el servicio Egress de LiveKit, ni almacenamiento de archivos de grabación. El `docker-compose.yml` del instalador (`infra/installer/docker-compose.yml`) solo define los servicios `livekit`, `livekit-redis` y `livekit-caddy` bajo el perfil `livekit`/`livekit-tls`; no hay servicio `egress`.

## 4. Problem

Una vez que una llamada termina, no queda ningún registro reproducible de lo que se dijo o mostró — solo los metadatos de la llamada (duración, participantes) y los mensajes de texto enviados dentro del panel de chat de la llamada. Para reuniones con invitados externos (candidatos, clientes, socios), entrevistas, o sesiones que alguien no pudo atender en vivo, no hay forma de revisarlas después, compartirlas con quien faltó, o conservarlas con fines de cumplimiento.

## 5. Goals

1. Un usuario con el permiso `chat.calls.record` puede iniciar y detener la grabación de una llamada activa desde `CallRoom.jsx`.
2. Todos los participantes (miembros internos e invitados externos) ven un aviso visible y persistente mientras la llamada se está grabando.
3. Al terminar de procesarse, la grabación aparece como una entrada reproducible en una nueva vista "Grabaciones" de la conversación y como mensaje de sistema en el chat.
4. Las grabaciones de más de 90 días se eliminan automáticamente del storage y de la base de datos.
5. Una grabación olvidada no puede correr indefinidamente: un tope duro de duración la detiene sola.

## 6. Non-goals

1. Grabación por pista separada de cada participante (`track` egress) — solo composición de sala completa (`room composite`).
2. Descarga del archivo original fuera del formato HLS servido.
3. Transcripción o subtítulos automáticos.
4. Plazo de retención configurable por empresa — 90 días fijos en esta versión.
5. Personalización de layout/calidad de la composición más allá de lo que LiveKit Egress ofrece por defecto.
6. Grabar únicamente audio o únicamente video como modo aparte — siempre audio+video juntos.

## 7. User stories

- Como anfitrión o moderador con `chat.calls.record`, quiero iniciar la grabación de una llamada para poder revisarla después o compartirla con quien no pudo asistir.
- Como participante de una llamada, quiero ver un aviso claro y visible de que se está grabando para saberlo antes de hablar.
- Como invitado externo que entra por enlace, quiero ver el mismo aviso de grabación aunque no tenga cuenta en Atlas.
- Como miembro de la conversación, quiero encontrar las grabaciones pasadas en un solo lugar sin tener que buscar en todo el historial del chat.
- Como administrador, no quiero que las grabaciones viejas se acumulen generando costo de almacenamiento indefinidamente.

## 8. UX requirements

- **Botón de grabar**: en la barra de controles de `CallRoom.jsx`, junto a silenciar/cámara/compartir pantalla. Solo visible si el usuario tiene `chat.calls.record`. Ícono alterna grabar/detener; mientras `ACTIVE` muestra un punto rojo parpadeante.
- **Aviso de consentimiento**: barra persistente y no descartable ("Esta llamada se está grabando") visible en `CallRoom.jsx` para miembros y en `GuestCallRoom.jsx` para invitados, mientras el estado de la grabación sea `ACTIVE`. Aparece/desaparece junto con el cambio de estado — no requiere acción del usuario para cerrarla mientras graba.
- **Vista "Grabaciones"**: mismo patrón de vista de intercambio que "Archivos" en `ChatWindow.jsx` (estado `filesView` → nuevo estado `recordingsView`, mismo botón de header). Lista con fecha, duración, quién la inició y un reproductor HLS inline (librería `hls.js` para navegadores sin soporte nativo; `<video>` nativo en Safari, que sí reproduce HLS). Estado vacío con `EmptyState` ("Aún no hay grabaciones"). Una entrada en `PROCESSING` muestra un spinner y no es reproducible todavía; una en `FAILED` muestra un ícono de error con tooltip explicando que no se pudo procesar.
- **Mensaje de sistema**: al pasar a `READY`, se publica un mensaje de sistema en la conversación con una tarjeta de la grabación (mismo tratamiento visual que los mensajes de sistema de inicio/fin de llamada ya existentes) y una acción "Ver grabación" que abre el reproductor.
- **Errores al iniciar**: si el Egress no puede arrancar (LiveKit/Egress inalcanzable, mal configurado), toast de error y el estado de la llamada no cambia — el botón vuelve a su estado "no grabando".
- Todo el texto de UI en español, siguiendo las convenciones existentes del módulo.

## 9. Routes/screens

No se agregan rutas nuevas. Se modifican pantallas existentes y se agrega un componente de vista dentro de la ventana de chat ya existente:

| Route | Screen | Module | Description |
|---|---|---|---|
| (sin ruta nueva) | `CallRoom.jsx` | atlas.chat | Botón de grabar + banner de aviso |
| (sin ruta nueva) | `GuestCallRoom.jsx` | atlas.chat | Banner de aviso para invitados |
| (sin ruta nueva) | `ChatWindow.jsx` (nuevo `recordingsView`) | atlas.chat | Toggle de vista, igual que `filesView` |
| (nuevo componente, sin ruta) | `ChatRecordingsGallery.jsx` | atlas.chat | Lista + reproductor HLS de grabaciones de la conversación |

## 10. Data model

### New models

**CallRecording** — una grabación de una llamada.
- `id` (uuid v7)
- `callId` — llamada a la que pertenece
- `conversationId` — denormalizado para listarlas por conversación sin join a `call`
- `status` — `STARTING | ACTIVE | PROCESSING | READY | FAILED`
- `startedByUserId` — quién la inició
- `egressId` — id de LiveKit Egress, usado para `stopEgress`/`listEgress`
- `playlistObjectKey` — ruta del `.m3u8` en Supabase Storage (bucket `atlas-chat`), null hasta `READY`
- `sizeBytes` — tamaño total aproximado de los segmentos, null hasta `READY`
- `durationMs` — duración real, null hasta `READY`
- `startedAt`, `endedAt` (nullable), `createdAt`
- `expiresAt` — `endedAt + 90 días`, usado por el job de limpieza; null mientras no ha terminado
- `failureReason` — texto corto, solo cuando `status = FAILED`

### Modified models

N/A — no se modifica ningún modelo existente. `Call`/`CallGuest`/`CallLink`/`CallInvite` quedan igual; `CallRecording` se relaciona con `Call` vía `callId`.

## 11. Prisma impact

New models: `CallRecording`
Modified models: N/A
New migration required: Yes
Migration safety notes: tabla nueva, sin columnas agregadas a tablas existentes — migración aditiva de bajo riesgo.

## 12. API contract

Todos los endpoints viven en `apps/api/src/routes/calls/index.js`, delegando a un nuevo `call-recording-service.js` (mismo patrón que `call-guest-service.js`/`call-links-service.js`). Auth requerido en todos (dentro del router `internal` con `authMiddleware`), salvo que el estado de grabación viaje también dentro de `GET /calls/guest/state` (ya público, sin auth, para invitados).

### POST /calls/:callId/recording/start

Auth: required
Permission: `chat.calls.record`
Response success: `{ data: { id, status: "STARTING" } }`
Response error: `409` si ya hay una grabación activa para esa llamada; `501` si LiveKit/Egress no está configurado; `500` si `startRoomCompositeEgress` falla.

### POST /calls/:callId/recording/stop

Auth: required
Permission: `chat.calls.record`
Response success: `{ data: { id, status: "PROCESSING" } }`
Response error: `404` si no hay grabación activa para esa llamada.

### GET /calls/conversations/:conversationId/recordings

Auth: required
Permission: `chat.conversations.read` (ver grabaciones es tan permisivo como ver la conversación misma; iniciar/detener sí requiere `chat.calls.record`)
Response: `{ data: CallRecording[] }` (incluye `playlistUrl` firmada cuando `status = READY`)

## 13. SDK contract

Domain: `atlas.calls` (`packages/sdk/src/domains/calls.js`)

- `startRecording(callId, token)` — `POST /calls/:callId/recording/start` → `{ data: { id, status } }`
- `stopRecording(callId, token)` — `POST /calls/:callId/recording/stop` → `{ data: { id, status } }`
- `listRecordings(conversationId, token)` — `GET /calls/conversations/:conversationId/recordings` → `{ data: CallRecording[] }`

El estado de grabación activa de una llamada (para el banner de consentimiento) viaja dentro de la respuesta ya existente de `getCall`/`getCurrentCall` (miembros) y de `GET /calls/guest/state` (invitados) como un campo nuevo `recording: { active: boolean }` — no se agrega un endpoint de polling aparte.

## 14. Validator contract

En `@atlas/validators` no se agrega nada (los tres endpoints no reciben body). Si en el plan de implementación se decide validar query params de `listRecordings` (paginación futura), se documentará ahí — fuera de alcance de este spec.

## 15. Module manifest impact

N/A — `atlas.chat`/`atlas.calls` no es un módulo AME3 (es un módulo core existente basado en modelos Prisma), no usa `defineAtlasModule`/manifest de módulo custom. Esta función extiende esa base de código existente, no crea un módulo nuevo.

## 16. Navigation impact

N/A — no se agrega ningún ítem de navegación nuevo; "Grabaciones" es una vista dentro de una conversación de chat ya abierta, no una pantalla con ruta propia.

## 17. Blueprint impact

N/A — no es una entidad AME3/blueprint-driven.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `chat.calls.record` | `POST /calls/:callId/recording/start`, `POST /calls/:callId/recording/stop` | No (gatea la visibilidad del botón de grabar, no un ítem de navegación) |

Se agrega a `apps/api/src/permission-catalog.js` bajo el grupo `chat` existente (junto a `chat.access`, `chat.conversations.read`, etc.), `order: 60`. Se debe correr `pnpm db:seed` para que quede disponible en instalaciones existentes.

## 19. Multi-company behavior

`CallRecording.conversationId` hereda el scoping ya existente de `chat_conversations` (una conversación pertenece a una sola `company_id`). Todas las consultas de `call-recording-service.js` filtran por `callId`/`conversationId` ya resueltos a través de `assertMember`/`assertCanManageCall`, exactamente como hace hoy `call-guest-service.js` — nunca se confía en el `companyId` del token del llamante, siempre se deriva de la conversación de la llamada (mismo patrón documentado en `call-guest-service.js` para el envío de notificaciones). No hay caso en el que una grabación sea intencionalmente visible entre compañías.

## 20. Files/storage impact

- Bucket: `atlas-chat` (el mismo que ya usan los adjuntos de chat), bajo un nuevo prefijo `recordings/<conversationId>/<callRecordingId>/` para los segmentos `.ts` y el `.m3u8`.
- Subida: LiveKit Egress escribe directamente ahí vía el endpoint S3-compatible de Supabase Storage (salida `SegmentedFileOutput` apuntando a ese endpoint con credenciales S3 de Supabase) — la API de Atlas no sube bytes, solo orquesta inicio/fin y lee el resultado.
- No se usa `FileAsset` — `CallRecording` es su propia tabla con su propio ciclo de vida (incluida la limpieza automática a 90 días), a diferencia de los archivos normales de chat.
- Reproducción: `GET /calls/conversations/:conversationId/recordings` devuelve una URL firmada de corta duración para el `.m3u8` (mismo mecanismo de signed URL que ya usa `getAttachmentSignedUrl` para adjuntos).

## 21. Export/import requirements

N/A

## 22. Audit log requirements

| Action key | Trigger | Payload |
|---|---|---|
| `chat.call_recording.start` | `POST /calls/:callId/recording/start` | after: `{ id, callId, startedByUserId }` |
| `chat.call_recording.stop` | `POST /calls/:callId/recording/stop` | after: `{ id, callId, status: "PROCESSING" }` |
| `chat.call_recording.auto_delete` | job de limpieza (90 días) | before: `{ id, expiresAt }` |

## 23. Edge cases

1. El host inicia grabar y se desconecta sin detenerla: el job de limpieza/monitoreo (mismo `setInterval` de 30s que ya usa `sweepAbandonedGuests`) debe forzar `stopEgress` cuando la llamada (`Call.status`) ya no está `RINGING`/`ACTIVE`, para no dejar un Egress huérfano grabando una sala vacía.
2. Tope duro de duración (4 horas, ver Riesgos) alcanzado: el mismo sweep llama `stopEgress` aunque nadie lo haya pedido, y marca la razón en un campo de estado si aplica.
3. Dos usuarios con `chat.calls.record` intentan iniciar grabación casi simultáneamente: el segundo `POST /start` debe fallar con `409` (ya hay una `CallRecording` en `STARTING`/`ACTIVE` para ese `callId`), nunca crear dos Egress para la misma sala.
4. La llamada termina (`endCall`) mientras graba: el sweep detecta que `Call.status` salió de `RINGING`/`ACTIVE` y detiene el Egress activo asociado, transicionando la grabación a `PROCESSING`.
5. `listEgress` reporta `EGRESS_FAILED`: la grabación pasa a `FAILED` con `failureReason`, no se publica mensaje de sistema, y la entrada en "Grabaciones" muestra el estado de error sin reproductor.
6. Un invitado sin cuenta ve el banner de grabación: el campo `recording.active` debe viajar en la respuesta ya pública `GET /calls/guest/state`, sin exponer `egressId` ni ningún dato interno de LiveKit.
7. Grabación en curso y la conversación tiene 0 bytes de video (llamada solo de audio, cámaras apagadas todo el tiempo): el composite sigue siendo válido — Egress compone lo que haya, aunque sea solo audio con un fondo/avatar por defecto de LiveKit.
8. Un usuario pierde el permiso `chat.calls.record` (cambio de rol) mientras una grabación que él inició sigue activa: la grabación sigue corriendo con normalidad (no depende del permiso en curso, solo lo necesitó para iniciarla) — pero ya no puede detenerla él mismo si perdió el permiso; cualquier otro usuario con `chat.calls.record` sí puede.

## 24. Risks

1. Riesgo: LiveKit Egress no está desplegado en el VPS actual (confirmado — no existe el servicio en `infra/installer/docker-compose.yml`). Mitigación: el plan de implementación incluye agregar el servicio `egress` (imagen `livekit/egress`) al compose bajo el mismo perfil `livekit`, con su propio archivo de config apuntando al `livekit-redis` ya existente (Egress se coordina con el servidor LiveKit vía Redis, no vía HTTP directo).
2. Riesgo: las credenciales S3-compatibles del contenedor de Supabase Storage no están documentadas en este repo (viven en `/path/to/supabase/docker/.env` del VPS, fuera del repo). Mitigación: el plan de implementación debe incluir un paso explícito de verificar/generar esas credenciales en el VPS antes de configurar el `SegmentedFileOutput` de Egress.
3. Riesgo: una grabación olvidada corre indefinidamente y genera costo de storage sin límite. Mitigación: tope duro de 4 horas de duración, forzado por el mismo sweep de 30s que ya vigila invitados abandonados.
4. Riesgo: el límite global de 50MB por archivo del contenedor de Supabase Storage (confirmado en `chat-attachments-service.js:41-48`) rompería una grabación larga en un solo MP4. Mitigación: salida segmentada HLS (`SegmentedFileOutput`), cada segmento muy por debajo de 50MB — decisión ya tomada en el diseño.
5. Riesgo: two llamadas al Egress compitiendo por el mismo `callId` (doble clic, dos moderadores a la vez). Mitigación: constraint a nivel de servicio — `startRecording` verifica que no exista ya una `CallRecording` en `STARTING`/`ACTIVE` para ese `callId` antes de llamar a LiveKit, dentro de una transacción.
6. Riesgo: implicaciones legales de grabar sin consentimiento explícito en jurisdicciones donde se requiere consentimiento de todas las partes. Mitigación: banner persistente y no descartable mientras graba, visible tanto a miembros como a invitados — decisión ya tomada en el diseño; queda fuera de alcance validar el cumplimiento legal específico por país, responsabilidad del cliente que usa la función.

## 25. Acceptance criteria

1. Given un usuario con `chat.calls.record` en una llamada activa, when presiona "Grabar", then se crea un `CallRecording` en `STARTING` y LiveKit Egress arranca contra esa sala.
2. Given una grabación activa, when cualquier participante (miembro o invitado) está en la llamada, then ve el banner "Esta llamada se está grabando".
3. Given un usuario sin `chat.calls.record`, when abre `CallRoom.jsx`, then no ve el botón de grabar.
4. Given una grabación en `ACTIVE`, when el usuario que la inició presiona "Detener", then la grabación pasa a `PROCESSING` y el Egress se detiene.
5. Given una grabación en `PROCESSING` que LiveKit reporta como `EGRESS_COMPLETE`, when el sweep periódico la detecta, then pasa a `READY`, se genera el mensaje de sistema en el chat, y aparece reproducible en "Grabaciones".
6. Given una llamada activa con una grabación en curso, when la llamada termina (`endCall`), then el sweep detiene el Egress activo automáticamente sin intervención manual.
7. Given una `CallRecording` con `expiresAt < now()`, when corre el job de limpieza, then el objeto se borra de Supabase Storage y el registro se borra de la base de datos.
8. Given una grabación activa que lleva 4 horas corriendo, when el sweep la revisa, then la detiene automáticamente aunque nadie la haya pedido detener.
9. Given dos solicitudes de `POST /recording/start` casi simultáneas para la misma llamada, when ambas llegan a la API, then solo una crea una grabación y la otra recibe `409`.

## 26. Verification plan

- `pnpm build` — sin errores de build
- `pnpm db:generate` — el cliente Prisma regenera limpio con el modelo `CallRecording`
- `pnpm db:migrate` — la migración nueva aplica sin errores
- `pnpm db:seed` — el permiso `chat.calls.record` queda sembrado
- `node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js` — pruebas unitarias del nuevo servicio (mocks de `EgressClient`, sin dependencia real de LiveKit)
- Manual (requiere Egress desplegado en VPS de staging): iniciar una llamada de prueba, grabar, verificar el banner en `CallRoom` y en una pestaña de invitado, detener, confirmar que aparece en "Grabaciones" y se reproduce
- Manual: usuario sin `chat.calls.record` no ve el botón de grabar
- Manual: forzar `EGRESS_FAILED` (apagar Egress a mitad de grabación) y confirmar que la entrada queda en estado de error sin romper la UI

## 27. Rollback plan

- La migración de `CallRecording` es aditiva (tabla nueva) — revertirla es una migración forward que hace `DROP TABLE call_recording`, sin afectar ninguna tabla existente.
- El permiso `chat.calls.record` puede desactivarse (`Permission.active = false`) sin borrar datos, ocultando el botón de grabar para todos sin tocar código.
- Si el servicio Egress del VPS causa problemas, el botón de grabar puede ocultarse por completo revirtiendo el commit del frontend, o dejando el permiso `chat.calls.record` sin asignar a ningún rol — el resto de `atlas.calls` sigue funcionando exactamente igual (no hay dependencia inversa).

## 28. Future enhancements

1. Grabación por pista separada de cada participante (`track` egress), para edición o cumplimiento más granular.
2. Transcripción automática y búsqueda de texto dentro de las grabaciones.
3. Plazo de retención configurable por empresa en vez de 90 días fijos.
4. Descarga del archivo original (no solo streaming HLS).
5. Notificación por correo a los participantes cuando una grabación queda lista.
