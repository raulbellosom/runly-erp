# Estado actual: llamadas, grabación, workers e IA (auditoría para transcripción)

**Fecha:** 2026-09-23
**Alcance:** Auditoría de solo lectura del código real (no de los specs históricos, que en varios puntos quedaron desactualizados) para servir de base a `TRANSCRIPTION_SPEC.md`.
**Método:** 5 agentes de investigación en paralelo, cada uno verificando contra el código con referencias `archivo:línea`. Este documento consolida sus hallazgos. Donde un spec histórico diverge de lo implementado, se señala explícitamente.

---

## 0. Resumen ejecutivo

`runly.chat` (antes `atlas.chat`) ya tiene un sistema de llamadas/videollamadas completo y en producción activa, construido sobre LiveKit self-hosted, con acceso de invitados externos, grabación vía LiveKit Egress a HLS, reacciones, alzar la mano, spotlight/pin y comparir pantalla. **No existe absolutamente ninguna pieza de transcripción hoy** — ni modelo de datos, ni servicio, ni UI, ni contenedor. Tampoco existe diarización, ni captura de audio por pista/participante (todo el pipeline de grabación es mezcla de sala completa, "room composite").

La infraestructura de procesamiento en segundo plano es 100% *polling* sobre Postgres (ni colas, ni webhooks, ni Redis a nivel de aplicación) — un patrón muy consistente y ya usado tanto para el ciclo de vida de llamadas/grabaciones como para el pipeline de IA existente (OCR de recibos en `runly.pfm`). Este patrón es el que una nueva pieza de transcripción debe imitar, no reemplazar.

**Corrección a la documentación existente:** `CLAUDE.md` describe `apps/worker` como "Node.js background job handler (**stub**)". Esto ya no es cierto — es un proceso real, siempre corriendo, con 13 tareas periódicas distintas (`apps/worker/src/index.js`, 468 líneas). Se señala aquí porque cualquier diseño de transcripción debe apoyarse en la arquitectura real, no en la descripción desactualizada.

---

## 1. Arquitectura de llamadas y videollamadas (real)

### 1.1. Modelo de datos (`prisma/schema.prisma:1830-2166`)

Enums: `CallKind` (AUDIO, VIDEO), `CallStatus` (RINGING, ACTIVE, ENDED), `CallParticipantStatus` (INVITED, RINGING, JOINED, LEFT, DECLINED, MISSED).

| Modelo | Tabla | Propósito |
|---|---|---|
| `Call` | `call` | Una llamada: `conversationId` (sin FK Prisma — `chat_conversations` es tabla raw-SQL), `calendarEventId?`, `kind`, `status`, `initiatedByUserId`, `livekitRoomName` (único, `call_<uuid>`), `startedAt`/`endedAt`/`endReason` |
| `CallParticipant` | `call_participant` | Un miembro interno en una llamada: `callId`, `userId`, `status`, `livekitIdentity` (= userId), `joinedAt`/`leftAt`. `@@unique([callId, userId])` |
| `CallLink` | `call_link` | Enlace persistente de "sala de reunión" por conversación: `token`, `code`, `requireLobby`, `maxUses`, `useCount`, `expiresAt`, `revokedAt` |
| `CallInvite` | `call_invite` | Invitación por correo asociada a un `CallLink`: `email`, `token`, `acceptedAt` |
| `CallGuest` | `call_guest` | Un invitado externo sin cuenta: `sessionTokenHash` (SHA-256, el token crudo nunca se persiste), `livekitIdentity` (`guest_<uuid>`), `status` (string libre: LOBBY/ADMITTED/DENIED/KICKED/LEFT), `lastSeenAt` (heartbeat) |
| `CallMessage` | `call_message` | **Probablemente código muerto** — ver nota abajo |
| `CallGuestJoinAttempt` | `call_guest_join_attempt` | Rate-limiting de intentos de unión de invitados |
| `CallRecording` | `call_recording` | Ver §2 |

Migraciones en orden: `20260828030000_atlas_calls_livekit` → `20260906000000_call_guest_access` → `20260913120000_add_call_recording` → `20260923000000_chat_messages_call_guest_sender`.

**Nota — `CallMessage` parece superado.** El diseño original contemplaba una tabla de chat propia de la llamada, pero desde la migración `20260923000000_chat_messages_call_guest_sender` (la más reciente, del mismo día de esta auditoría) los mensajes de invitados se escriben directamente en `chat_messages` (la tabla real de conversación), con `sender_type='guest'` y `sender_call_guest_id`. No se encontró código de servicio que lea/escriba `call_message`. **Antes de asumir que esta tabla está viva en un futuro diseño, confirmarlo con un grep dedicado.**

### 1.2. Ciclo de vida de una llamada

Router: `createCallsRouter` (`apps/api/src/routes/calls/index.js:44`), montado directamente en `apps/api/src/index.js:4510` (no vía el Route Loader de RME3 — `runly.chat` es un módulo core basado en Prisma, no un módulo custom RME3; ver §5.7).

Endpoints autenticados relevantes (todos bajo `authMiddleware`, prefijo `/calls`):
- `POST /calls/` — `createCall` (`call-service.js:~298`)
- `POST /calls/:id/{join,decline,leave,end}` (`index.js:234-247`)
- `GET /calls/:id`, `GET /calls/current`
- `GET|POST|PATCH|DELETE /calls/conversations/:conversationId/link` (enlaces de invitado)
- `POST /calls/:callId/guests/:guestId/{admit,deny,kick,mute}`
- `POST /calls/:callId/recording/{start,stop}`, `GET /calls/conversations/:conversationId/recordings`, `DELETE /calls/recordings/:recordingId`
- `POST /calls/:callId/screen-token`

Endpoints públicos sin `authMiddleware` (`guest-routes.js`, montados en `/calls/guest`, auth vía token de invitado): `POST /join`, `GET /state`, `POST /token`, `POST /heartbeat`, `POST /leave`, `POST /messages`.

`createCall` resuelve miembros vía SQL crudo contra `chat_conversation_members`/`chat_conversations` + una función Postgres `runly_chat_user_access(...)` (`call-service.js:69-80`), detecta si es una "sala de reunión" (existe un `CallLink` activo → puede iniciar `ACTIVE` con solo el host), bloquea filas `user_profile` `FOR UPDATE` en orden de UUID (evita deadlocks), descarta destinatarios "ocupados", e inserta el `Call` con `INSERT ... SELECT uuidv7()` (nunca UUID generado en JS, cumpliendo la regla del proyecto).

**Tokens LiveKit**: `AccessToken` del SDK de servidor de LiveKit, generado dentro de Hono (`call-service.js:199`), TTL de **1 minuto**, permisos acotados a la sala de esa llamada. Token de pantalla compartida separado, identidad `screen:<profileId>`, solo publicación de la fuente `SCREEN_SHARE`.

### 1.3. Acceso de invitados externos

Implementado en `call-guest-service.js`, `call-links-service.js`, `guest-routes.js`. Flujo: un miembro crea/obtiene un `CallLink` (token + código Crockford base32) → el invitado hace `POST /calls/guest/join` (rate-limit 8 intentos/10 min por IP) → si no hay llamada viva, responde `{status:"waiting"}` (sala de espera) → si `requireLobby=true`, el invitado queda en `LOBBY` hasta que un anfitrión lo admite (`admit`/`deny`/`kick` llaman de verdad a `RoomServiceClient.removeParticipant`/`mutePublishedTrack` de LiveKit, no solo cambian una bandera en BD). Invitados abandonados en `LOBBY` con `lastSeenAt` > 2 min se auto-deniegan (`sweepAbandonedGuests`, cada 30s).

Un usuario de la plataforma cuyo correo coincide con una invitación es agregado directamente a la conversación (no recibe flujo de invitado). Los mensajes de chat de invitados van a `chat_messages` como remitentes de primera clase (`sender_type='guest'`).

### 1.4. Llamadas iniciadas desde chat / "salas de reunión"

`ChatWindow.jsx` llama `startCall({conversationId, kind})` vía `useCalls()`; un `POST /calls` con conflicto 409 (ya hay llamada viva) hace que el segundo llamante simplemente se una a la existente, en vez de fallar. El flujo de "sala de reunión" (`startMeeting.js`) crea primero un `CallLink` y luego inicia la llamada — eso es lo que hace que `createCall` la detecte como "meeting room" y la arranque `ACTIVE` sin esperar a nadie más.

`Call.calendarEventId` solo se vincula a eventos de `runly.calendar` con `sourceModule='runly.chat'` y `sourceEntityId=conversationId` — es decir, eventos creados específicamente para esa conversación, no cualquier evento de calendario.

### 1.5. Estado del participante y reconexión — **sin webhooks, todo por polling**

**No existe ningún receptor de webhooks de LiveKit en todo el backend.** Todo el estado se reconcilia con temporizadores dentro del propio proceso de la API, registrados al montar el router de llamadas (`apps/api/src/routes/calls/index.js:76-84`):

| Sweep | Función | Intervalo |
|---|---|---|
| Expiración de llamadas sin responder + revocación de acceso no autorizado | `expireStaleCalls()` + `revokeUnauthorizedParticipants()` (`call-service.js:919`) | ~15s (`RING_TIMEOUT_MS=36s` para marcar MISSED) |
| Invitados abandonados en lobby | `sweepAbandonedGuests()` | 30s |
| Reconciliación de grabaciones activas | `reconcileActiveRecordings()` | 30s |
| Limpieza de grabaciones expiradas | `cleanupExpiredRecordings()` | 1h |

`revokeUnauthorizedParticipants` existe porque "LiveKit self-hosted no revoca tokens viejos" (comentario en código) — si el acceso de un usuario a la conversación cambia a mitad de llamada, hay que forzar su salida activamente.

En el frontend, `useCallSynchronization.js` combina: (1) suscripción Realtime de Supabase sobre `call_participant`/`call`, (2) *polling* HTTP cada 20s como respaldo (PWA suspendidas en móvil), (3) `pagehide` → intento de salida best-effort.

### 1.6. Frontend

`apps/desktop/src/modules/runly.chat/calls/` (~4.280 líneas): `CallsProvider.jsx` (contexto raíz), `useCallSynchronization.js`, `CallRoom.jsx`/`CallRoomLayout.jsx` (sala de miembros), `guest/GuestCallRoom.jsx`/`GuestCallScreen.jsx` (sala de invitados), `hooks/useCallGuests.js` (poll 3s), `hooks/useCallRecording.js` (poll 5s), `hooks/useCallEphemeral.js` (reacciones/alzar mano vía canal de datos de LiveKit), `SpotlightLayout.jsx`/`DirectFocusLayout.jsx`/`ParticipantTile.jsx` (grid de video), `RecordingBanner.jsx`, más utilidades de sonido/lock/ciclo de vida.

### 1.7. Infraestructura LiveKit / instalador

`infra/installer/docker-compose.yml`: `livekit-redis` (perfil `livekit`), `livekit` (perfil `livekit`, puertos `7880/tcp`, `7881/tcp`, `7882/udp`), `egress` (perfil separado `livekit-egress` — ver §2), `livekit-caddy` (perfil `livekit-tls`, TLS gestionado). Override `docker-compose.linux.yml`: los 4 servicios pasan a `network_mode: host` en Linux (WebRTC/UDP lo requiere; Docker Desktop en Windows/macOS no).

`infra/installer/lib/livekit-config.mjs` implementa `LIVEKIT_MODE ∈ {embedded, external, disabled}` (`resolveLiveKitConfig`, líneas 38-91): `disabled` no activa nada; `embedded` autogenera `apiKey`/`apiSecret` con `crypto.randomBytes` y resuelve URLs internas de Docker; `external` exige que las 4 variables ya estén provistas. `getLiveKitComposeProfiles()` (línea 224) traduce esto a la lista `--profile` real pasada a `docker compose`. Esta es la plantilla directa a imitar para un futuro `TRANSCRIPTION_MODE` (ver `TRANSCRIPTION_SPEC.md` §6 y `TRANSCRIPTION_IMPLEMENTATION_PLAN.md`).

### 1.8. Permisos

**Solo existe un permiso para toda la funcionalidad de llamadas**: `"chat.calls.record"` (`apps/api/src/permission-catalog.js:1452`). No hay permisos dedicados para iniciar/unirse/terminar una llamada ni para gestionar invitados — esas acciones se autorizan por pertenencia a la conversación (`assertMember`/SQL crudo contra `chat_conversation_members` + `runly_chat_user_access(...)`) más una regla ad hoc `assertCanManageCall` (`call-service.js:181-197`): el iniciador de la llamada, o cualquier miembro cuyo rol de canal tenga `channel.manage` o sea un rol de sistema. **Cualquier permiso nuevo relacionado con transcripción tendría que crearse desde cero** — no hay una familia `chat.calls.*` que extender más allá de `record`.

### 1.9. Divergencias entre el spec histórico y el código real

El spec `docs/superpowers/specs/2026-08-27-atlas-calls-livekit-design.md` dice "implementación diferida" (§12) — **esto es falso hoy**: la arquitectura base se construyó fielmente y se extendió activamente en más de una decena de ciclos posteriores (invitados, chat en llamada, grabación, reacciones, spotlight/pin, compartir pantalla), documentados en `docs/superpowers/plans/2026-09-06` a `2026-09-23`. Ese spec original tampoco menciona nada de grabación, invitados ni transcripción — todo lo posterior se diseñó y aprobó en ciclos separados.

---

## 2. Sistema de grabación (LiveKit Egress) — actual

### 2.1. Modelo de datos

`model CallRecording` (`prisma/schema.prisma:2142-2166`, tabla `call_recording`), único, sin migraciones posteriores a `20260913120000_add_call_recording`:

```
id, callId, conversationId (denormalizado — evita join para listar por conversación)
status            String  @default("STARTING")  // STARTING | ACTIVE | PROCESSING | READY | FAILED
                                                  // (comentario de código, NO un enum Postgres/Prisma real)
startedByUserId, egressId, playlistObjectKey, sizeBytes (BigInt), durationMs
failureReason, startedAt, endedAt, expiresAt, createdAt
```

`status` es una columna `TEXT` libre, a diferencia de `CallStatus`/`CallParticipantStatus` que sí son enums reales en el mismo archivo — añadir nuevos valores de estado (para una futura relación con transcripción) no requiere migración de esquema.

### 2.2. Orquestación de Egress

Servicio: `apps/api/src/routes/calls/call-recording-service.js` (458 líneas), usa `livekit-server-sdk`'s `EgressClient`/`SegmentedFileOutput`/`SegmentedFileProtocol`/`S3Upload`.

- **`startRecording`** (líneas 105-160): descarta duplicados activos, llama `egressClient().startRoomCompositeEgress(livekitRoomName, {segments: output}, {layout: "grid-dark"})`. Solo hace **composición de sala completa (audio+video mezclados)** — nunca pistas/participantes separados.
- **Salida**: `SegmentedFileOutput` con protocolo **HLS** (`segmentDuration: 6`, `playlistName: "index.m3u8"`), destino `S3Upload` apuntando al endpoint S3-compatible de Supabase Storage (`SUPABASE_S3_ENDPOINT`/`SUPABASE_S3_ACCESS_KEY_ID`/`SUPABASE_S3_SECRET_ACCESS_KEY`, leídos en tiempo de request por `s3Config()`, **no** están horneados en `livekit/egress.yaml` — ese archivo solo tiene `api_key`/`api_secret`/`ws_url`/`redis.address`).
- **Bucket real: `runly-chat`** (constante `RECORDING_BUCKET`, línea 6) — el **mismo bucket que los adjuntos normales de chat**, bajo el prefijo `recordings/<conversationId>/<recordingId>/`. No hay bucket dedicado a grabaciones.
- **`stopRecording`/`listRecordings`/`deleteRecording`**: gated por `assertMember` derivado del propio registro (nunca confían en el `companyId` del llamante — ver §5.3).

### 2.3. Reproducción — el problema de firmar HLS

`listRecordings` no devuelve una URL firmada del `.m3u8` a secas: **descarga el manifiesto con credenciales de admin, firma individualmente cada segmento `.ts` referenciado (`SEGMENT_SIGN_TTL_SECONDS=3600`), y reescribe el texto del manifiesto** con URLs firmadas absolutas antes de devolverlo (`signManifestSegments`, líneas 198-219) — un comentario en el código explica que firmar solo la playlist no funciona porque `hls.js` resuelve los nombres de segmento en relativo al manifiesto, perdiendo el token de firma. El frontend nunca recibe una URL de manifiesto directa; recibe el texto ya reescrito y lo envuelve en un `Blob`/`ObjectURL` (`ChatRecordingsGallery.jsx`, reutilizando `AdvancedFileViewer`/`useHlsPlayback` de `@runly/ui`).

### 2.4. Detección de finalización — sin webhook, sondeo cada 30s

`reconcileActiveRecordings()` (líneas 271-363), en el mismo `setInterval` de 30s que el resto de sweeps de llamadas: consulta `listEgress({egressId})` **por cada fila activa** (no un `listEgress({active:true})` global, porque ese filtro excluye justo los estados terminales que el sweep necesita ver). Mapea `EGRESS_COMPLETE` → `READY` (con `durationMs`, `sizeBytes`, `expiresAt = ahora + 90 días`) o `EGRESS_FAILED`/`ABORTED` → `FAILED`.

**Tope duro de duración: 4 horas** (`MAX_DURATION_MS`, línea 4), forzado por el mismo sweep — si una grabación lleva más de 4h o la llamada ya terminó, se llama `stopEgress()` aunque nadie lo haya pedido.

### 2.5. Retención y limpieza — precedente directo para transcripción

`cleanupExpiredRecordings()` (líneas 416-454), en su propio `setInterval` **horario**: solo toca filas `status='READY'` con `expiresAt < ahora`, lista todos los objetos de Storage bajo el prefijo de esa grabación (paginado), los borra, y **solo entonces** hace `prisma.callRecording.delete(...)` (borrado físico, no soft-delete — excepción deliberada a la convención general del proyecto, apropiada para medios que deben dejar de existir/costar). Si listar falla, la fila se salta (se reintenta en el siguiente ciclo) en vez de borrarse a medias. **`RETENTION_MS = 90 días`** fijo (línea 5).

### 2.6. Docker Compose

Servicio `egress` (`infra/installer/docker-compose.yml:167-192`): imagen `livekit/egress:v1.9.0`, **perfil propio `livekit-egress`** (deliberadamente separado del perfil base `livekit` porque monta `/var/run/docker.sock` del host — un comentario en el compose señala esto como "un límite de confianza materialmente mayor"), `cap_add: SYS_ADMIN` (Chrome headless para renderizar la composición). Se activa automáticamente solo cuando `mode==="embedded"` **y** las 3 variables `SUPABASE_S3_*` están presentes (patrón "presencia de configuración implica activación", sin bandera booleana separada).

### 2.7. Frontend

`RecordingBanner.jsx` (aviso persistente no descartable), `useCallRecording.js` (poll 5s), botón grabar/detener en `CallRoomLayout.jsx` (gated: `isAdmin || permissions.includes("chat.calls.record")`), `RecordingReadyCard.jsx` (tarjeta de mensaje de sistema al terminar), `ChatRecordingsGallery.jsx` (lista + reproductor, reutiliza `AdvancedFileViewer` de `@runly/ui`).

### 2.8. Capacidad por pista / participante — **no existe**

Grep exhaustivo confirma: **cero usos** de `startTrackEgress`/`startTrackCompositeEgress`/`TrackCompositeEgress` en todo `apps/api/src`. El único método de Egress invocado en todo el repo es `startRoomCompositeEgress`. El SDK de LiveKit (`livekit-server-sdk`) sí expone esos métodos — Runly simplemente no los usa. **Esto es la limitación central para cualquier diseño de identificación de hablantes**: hoy solo existe una pista de audio mezclada por llamada; no hay fuente de audio limpia por participante en ningún punto del pipeline actual.

---

## 3. Backend, workers y procesamiento asíncrono

### 3.1. `apps/worker` — proceso real, no un stub

Contradice la descripción de `CLAUDE.md`. `apps/worker/src/index.js` (468 líneas) es un proceso Node.js de larga duración (`pnpm dev:worker` → `node --watch src/index.js`), con conexión directa a Postgres vía `pg.Pool` + adaptador Prisma (no una cola). Es una cadena de funciones `runXTick()`, cada una en su propio `setInterval`, con reconexión ante errores de conexión (`isConnectionError`/`reconnect()`).

13 tareas periódicas registradas:

| Tarea | Intervalo |
|---|---|
| Recordatorios de calendario | 30s (`RUNLY_NOTIFICATION_DELIVERY_INTERVAL_MS`) |
| Entrega de notificaciones (email/web_push/fcm) | 30s |
| Limpieza de logs de sincronización | configurable |
| Tareas por vencer | 1h |
| Retención de analítica de Growth | 1h |
| Salud de propiedades de Growth | 1h |
| Recuperación de importación de Google Calendar | configurable |
| Tareas recurrentes de proyectos | 1h |
| Materialización de reglas recurrentes de PFM | 1h |
| **OCR de recibos de PFM** | **30s** — gated en `GROQ_API_KEY` presente |
| Evaluación de presupuestos PFM | 1h |
| Devengo de rendimiento de inversiones PFM | 1h |
| Expiración de sesiones de invitado de chat | 15min |
| Barrido de adjuntos huérfanos de chat | 30min |

**Precedente directo más cercano a un job de transcripción — OCR de recibos de PFM** (`apps/api/src/routes/pfm/receipts-service.js`): crea una fila `PfmReceipt` con `status: "PROCESSING"`, el worker llama `processPendingBatch({limit:5})` cada 30s, descarga el archivo de Storage, llama al proveedor de visión, y escribe `status: "PARSED"` o (tras `MAX_ATTEMPTS=3`) `"FAILED"` con `errorReason`. Este patrón de **"fila de BD como cola de trabajo"** (columna de estado + contador de intentos + sondeo periódico) es el idioma establecido en este código para "trabajo de IA en segundo plano" — pero siempre corriendo *dentro del mismo proceso* Node.js, llamando de forma síncrona a una API HTTP externa (Groq). **Nunca antes se ha coordinado con un contenedor externo separado** — eso es terreno nuevo para transcripción.

### 3.2. Redis — solo uso interno de LiveKit, ninguno a nivel de aplicación

Confirmado explícitamente en código: `apps/api/src/lib/cache.js:3-4`:
```js
// Central in-process cache. Single-process Hono API — no Redis needed at current scale.
// Interface is intentionally thin so it can be swapped to ioredis/Upstash without changing call sites.
```
Ningún paquete `redis`/`ioredis` es dependencia en `apps/api`, `apps/worker` ni `packages/*`. El único Redis del stack (`livekit-redis`) es interno a LiveKit/Egress y no es alcanzable desde el código de aplicación. **No existe ninguna cola de trabajos fuera de proceso (Bull/BullMQ/etc.) en todo el repositorio**, para nada — ni email, ni PDF, ni importaciones, ni OCR.

### 3.3. Sweeps propios dentro de `apps/api`

Además de los ticks de `apps/worker`, `apps/api/src/routes/calls/index.js` arma sus propios `setInterval` al montar el router (ver tabla en §1.5), protegidos por un chequeo `if (!service)` de "propietario único" para evitar temporizadores duplicados si hubiera réplicas de la API. **Dos capas de programación distintas coexisten hoy**: los ticks siempre activos de `apps/worker`, y los sweeps que `apps/api` arma a sí mismo al bootear — ninguna es una cola real, ambas son `setInterval` + sondeo de Postgres.

### 3.4. Docker Compose — inventario completo, sin límites de recursos en ningún servicio

`infra/installer/docker-compose.yml` (216 líneas), nombre de proyecto `${RUNLY_COMPOSE_PROJECT_NAME:-runlyerp}`:

| Servicio | Imagen | Perfil(es) |
|---|---|---|
| `collabora` | `collabora/code:26.04.2.4.1` | `office` |
| `runly-api-{local,external}` | `raulbellosom/runlyerp:api-latest` | `local`/`external` |
| `runly-worker-{local,external}` | `raulbellosom/runlyerp:worker-latest` | `local`/`external` |
| `runly-web-{local,external}` | `raulbellosom/runlyerp:web-latest` | `local`/`external` |
| `livekit-redis` | `redis:7-alpine` | `livekit` |
| `livekit` | `livekit/livekit-server:v1.12.0` | `livekit` |
| `egress` | `livekit/egress:v1.9.0` | `livekit-egress` |
| `livekit-caddy` | `caddy:2-alpine` | `livekit-tls` |

**Ningún servicio define `deploy.resources.limits`, `mem_limit`, `cpus` ni nada equivalente** — grep exhaustivo sin resultados. Ni siquiera `collabora` (el servicio más pesado en CPU que existe hoy, un renderizador de documentos de oficina) tiene límites. **Un contenedor de transcripción sería el primer servicio del repo en tener límites explícitos de recursos** — no hay plantilla que copiar, habría que introducir el patrón desde cero.

Volúmenes con nombre que sobreviven actualizaciones: `livekit-caddy-data`/`livekit-caddy-config` (este compose), `supabase-db-data`/`supabase-db-config`/`supabase-storage-data` (compose separado de Supabase). Ningún patrón existente de "descargar un modelo/activo grande una vez y reutilizarlo entre actualizaciones" — habría que crear un volumen con nombre nuevo (ej. `whisper-model-cache`).

### 3.5. Instalador — patrón a imitar para `TRANSCRIPTION_MODE`

`infra/installer/lib/livekit-config.mjs` es el molde: enum de 3 modos (`embedded`/`external`/`disabled`), autogeneración de credenciales cuando faltan, y una función `getLiveKitComposeProfiles()` que traduce la configuración resuelta a la lista `--profile` real. La activación de grabación específicamente usa el patrón "presencia de env vars implica activado" (`setup-external.mjs:527-528`) en vez de una bandera booleana separada — ambos patrones (enum de modo + presencia-como-bandera) son los candidatos naturales para una futura variable `TRANSCRIPTION_MODE`.

Actualización: `pnpm db:migrate` = `prisma migrate deploy && prisma generate` (siempre aditivo, nunca reset); `bootstrap-local.sh`/`update-local.sh` nunca tocan `.env.local` ni `custom-modules/`; los volúmenes con nombre nunca se eliminan salvo `docker compose down -v` explícito.

---

## 4. MirAI — arquitectura actual del asistente de IA

### 4.1. Estructura

`apps/api/src/routes/chat/`: `mirai-service.js` (1002 líneas, el motor completo), `mirai-routes.js` (endpoints HTTP), `mirai-tools.js` (definiciones de herramientas Groq tool-calling), `mirai-conversation-guard.js` (protege la conversación especial de renombrado/borrado).

4 puntos de entrada: `handleUserMessage` (chat 1:1 con el bot), `handleChannelMention` (mención `@MirAI` en canal/grupo), `handlePanelMessage` (panel lateral privado de asistente), `answerWithTools` (bucle genérico reutilizado por otros módulos, ej. PFM).

Flujo de un turno: chequeo de configuración (`GROQ_API_KEY`) → límite de tasa (20 msj/60s) → **clasificador** (`classifyTurn()`, Groq barato, últimos 4 mensajes, 3s de timeout, circuit breaker a `chat` tras 3 fallos consecutivos) decide `chat`/`general`/`live` → si `live`, búsqueda web (§4.3); si no, bucle de *tool-calling* de Groq (máx. 8 iteraciones) con las últimas 20 líneas de historial → sanitiza el texto → persiste como mensaje `sender_type='assistant'` en `chat_messages` → escribe una fila de auditoría en `ChatMiraiRun` (modelo usado, herramientas llamadas, latencia, ruta).

### 4.2. Integración con Groq

`callGroqRaw()` (`mirai-service.js:358-396`), POST a `${GROQ_BASE_URL||"https://api.groq.com"}/openai/v1/chat/completions`, timeout 25s, un reintento en 429/5xx. Variables de entorno confirmadas en código: `CHAT_MIRAI_MODEL` (default `openai/gpt-oss-120b`), `CHAT_MIRAI_WEB_MODEL` (default `groq/compound-mini`), `CHAT_MIRAI_ROUTER_MODEL` (default `openai/gpt-oss-120b`), `CHAT_MIRAI_WEB` (interruptor booleano), `TAVILY_API_KEY`. `PFM_ASSISTANT_MODEL` vive en un archivo separado (`apps/api/src/routes/pfm/assistant-service.js`), no en `mirai-service.js`.

**Nombre histórico**: "MeridIAn" solo sobrevive en una línea de log histórica de `docs/TASKS.md` (2026-09-14) y en nombres de archivo de specs antiguos (`docs/superpowers/specs/2026-09-07-chat-meridian-*`) — el código actual usa exclusivamente "MirAI".

### 4.3. Búsqueda en vivo (Tavily)

`callWeb()`: si hay `TAVILY_API_KEY`, `tavilySearch()` hace POST a `https://api.tavily.com/search` (5 resultados, respuesta truncada a 500 caracteres c/u), y una **segunda** llamada a Groq redacta la respuesta final citando fuente y fecha. Sin Tavily pero con `CHAT_MIRAI_WEB_MODEL` configurado, cae al modelo compound de Groq (que busca por su cuenta). Límite de tasa más estricto para `live`: 10 solicitudes / 5 min.

### 4.4. MirAI como participante de chat

Un perfil bot **por empresa** (`getOrCreateMiraiProfile`, `is_bot=true`, `display_name='MirAI'`), sembrado en `prisma/seed.js:386-412`. La conversación de chat directo con MirAI es una fila de `chat_conversations` con `type='mirai'`, única por (usuario, empresa) vía índice parcial, protegida contra renombrado/borrado por `mirai-conversation-guard.js`.

Tablas: `chat_conversations`/`chat_messages` (contenido real), `ChatMiraiRun` (auditoría por turno, **con `companyId` directo** — modelo a seguir para tablas de transcripción), `ChatMiraiThread`/`ChatMiraiMessage` (hilo del panel lateral).

### 4.5. Precedente "IA propone, humano confirma" — **existe, dos instancias reales**

**(a) Importación de estados de cuenta con IA en `runly.ledger`** — el precedente más cercano a un flujo de transcripción → minuta:
- `POST /ledger/imports/recognize` (`apps/api/src/routes/ledger/ai-import-routes.js:50-121`) — extrae filas de un PDF/imagen/CSV con IA, **sin escribir nada en BD**, devuelve `{proofToken, detectedAccount, candidateRows, warnings}`.
- `proofToken`: firmado con HMAC (`ai-import-token.js`), payload `{companyId, actorId, rowsHash, iat}`, TTL de 2 horas.
- `POST /ledger/imports/commit` — toma las filas (posiblemente editadas por el usuario) + el token, verifica la firma/TTL, y **solo entonces** escribe transacciones reales.

Este es exactamente el patrón **proponer → revisar/editar → confirmar-y-comprometer**, con un token firmado anti-manipulación/replay que protege la escritura.

**(b) Revisión de OCR de recibos en `runly.pfm`** — máquina de estados más simple: `PfmReceipt.status`: `PROCESSING` → `PARSED` (la IA extrajo datos, el registro espera revisión — **aún no es un movimiento real**) → el usuario llama `confirmReceipt()` → crea el movimiento real y pasa a `CONFIRMED`. `MAX_ATTEMPTS=3` antes de `FAILED`.

**No existe ningún precedente de "evento de calendario propuesto por IA" ni "tarea propuesta por IA"** — `createEvent`/`createTask` son APIs directas e inmediatas, sin capa de borrador. `CalendarEvent` sí tiene columnas `sourceModule`/`sourceEntityId` ya pensadas para procedencia entre módulos (reutilizables directamente). `Task` está siempre anclado a un `Project` — no existe una lista de tareas genérica a nivel de empresa.

---

## 5. Modelo de datos, multiempresa y seguridad (patrones a reutilizar)

### 5.1. Resolución de `companyId` — nunca confiada al cliente

`apps/api/src/lib/tenant-context.js` + `apps/api/src/index.js`: el `companyId` activo llega por el header `X-Runly-Company-Id`, pero **se valida contra las membresías activas ya cargadas del usuario desde su JWT** (`resolveActiveMembership`, `tenant-context.js:34-50`) — el header solo puede *seleccionar* entre empresas a las que el usuario ya pertenece según la BD; nunca puede otorgar acceso a una empresa nueva. `computeScopedPermissions` calcula el conjunto de permisos acotado exactamente a esa empresa.

**Para transcripción**: cualquier ruta/servicio nuevo debe resolver `companyId` de la misma forma — nunca aceptar un campo `companyId` del body/params para fines de autorización.

### 5.2. Catálogo de permisos

`apps/api/src/permission-catalog.js`: objeto plano por clave punteada (`"chat.calls.record"` → `{displayNameEs, descriptionEs, groupKey, order}`), sembrado en `Permission` vía `prisma/seed.js:62-109` a partir de los manifiestos oficiales. `Permission.active` (columna de BD, no del catálogo) determina si un otorgamiento de rol cuenta de verdad. Enforcement real: middleware `requirePermission(key)` (`apps/api/src/index.js:531-553`) aplicado directamente en la ruta.

### 5.3. Patrón de control de acceso por registro — `assertMember`

Ejemplo canónico (`call-recording-service.js:80-97`): el permiso de rol (`chat.calls.record`) es **necesario pero no suficiente** — cada ruta de grabación *además* llama `assertMember(conversationId, profileId)` derivado **del propio registro** (nunca del token del llamante), verificando pertenencia activa a la conversación vía SQL crudo contra `chat_conversation_members`. El comentario en código confirma que este es el mismo patrón usado en `call-links-service.js` — repetido a propósito, no un caso aislado.

**Para transcripción**: replicar exactamente esta forma de dos capas — permiso de rol en la ruta + `assertMember` en el servicio, derivado del `callId`/`conversationId` propio del registro de transcripción.

### 5.4. Seguridad de archivos/Storage

Buckets confirmados: `runly-files` (privado, archivos generales), `runly-website` (público, sitios publicados), `runly-chat` (privado — adjuntos de chat **y** grabaciones de llamadas comparten este bucket). Patrón de URLs firmadas: `createSignedUrl(s)` con TTL configurable (`files-service.js`); para grabaciones, cada segmento HLS se firma individualmente con TTL de 1 hora (ver §2.3) — la puerta de acceso es "miembro de esta conversación", más estrecha que "cualquiera de la empresa".

### 5.5. Auditoría — brecha existente en grabación

`AuditLog` (`schema.prisma:610-629`, `companyId?`, `actorId?`, `moduleKey?`, `entityType?`, `entityId?`, `action`, `before?`, `after?`). **El spec de grabación original proponía acciones de auditoría (`chat.call_recording.start`/`stop`/`auto_delete`) que NUNCA se implementaron** — se verificó que `call-recording-service.js` no escribe ninguna fila de `AuditLog`. Patrón real usado en otros módulos: una función `logAudit()` cerrada dentro del servicio (ej. `fleet/catalog-service.js:86-92`, `hr-service.js:351`). **Esta es una brecha real y preexistente, no algo que la transcripción deba replicar** — al contrario, es una oportunidad de hacerlo bien desde el inicio.

### 5.6. Retención y limpieza — precedente sólido

`cleanupExpiredRecordings()` (ver §2.5) es el único precedente real en todo el repo de "borrar registros viejos + sus objetos de Storage asociados". Características a reutilizar: borrado físico (no soft-delete) para medios que expiran, y "saltar y reintentar" ante fallos de listado de Storage en vez de borrar a medias.

### 5.7. Frontera RME3 vs. Prisma

Confirmado: `runly.chat` (chat + llamadas) es un **módulo oficial/core respaldado por Prisma**, declarado en `apps/api/src/manifests/official/feature-modules.js:814` — **no** es un módulo custom RME3 (`modules/custom/` solo contiene `custom.dispatch`). Todos los modelos de llamadas (`Call`, `CallParticipant`, `CallRecording`, etc.) son modelos Prisma de primera clase, accedidos vía `prisma.callRecording.*` normal — no vía `prisma.$queryRaw` (el patrón obligatorio solo para tablas de módulos RME3).

**Conclusión para el diseño**: `CallTranscript`/`TranscriptSegment` deben ser modelos Prisma ordinarios (nueva migración en `prisma/schema.prisma`), con la misma forma que `CallRecording` — **no** modelos RME3 vía `defineModel`.

---

## 6. Tabla resumen — qué existe, qué falta

| Componente | Estado |
|---|---|
| Llamadas 1:1 y grupales sobre LiveKit | ✅ Completo, en producción |
| Acceso de invitados externos (enlaces, lobby, admitir/expulsar) | ✅ Completo |
| Grabación de sala completa a HLS en Supabase Storage | ✅ Completo |
| Reconciliación de grabación por sondeo (sin webhook) | ✅ Completo |
| Retención automática de grabaciones (90 días) | ✅ Completo |
| Captura de audio por pista/participante | ❌ Ausente — LiveKit lo soporta, Runly nunca lo invoca |
| Diarización / identificación de hablantes | ❌ Ausente |
| Transcripción de cualquier tipo | ❌ Ausente — sin modelo de datos, servicio, contenedor ni UI |
| Cola de trabajos fuera de proceso | ❌ Ausente — todo es `setInterval` + sondeo de Postgres |
| Contenedor Python/IA propio en Docker Compose | ❌ Ausente |
| Límites de CPU/RAM en algún servicio de Compose | ❌ Ausente — ningún precedente que copiar |
| Caché de modelo de IA entre actualizaciones (volumen) | ❌ Ausente — ningún precedente que copiar |
| Patrón "fila de BD como cola de trabajo" (status + intentos) | ✅ Existe (OCR de recibos PFM) — reutilizable |
| Patrón "IA propone, humano confirma" | ✅ Existe (import de ledger, revisión de recibos) — reutilizable para minutas |
| Integración de MirAI con Groq/Tavily | ✅ Completo, extensible con nuevas herramientas |
| Auditoría de acciones de grabación/llamada | ⚠️ Parcial — modelo `AuditLog` existe pero grabación no lo usa hoy |
| Permiso RBAC dedicado a transcripción | ❌ Ausente — habría que crear uno nuevo |
