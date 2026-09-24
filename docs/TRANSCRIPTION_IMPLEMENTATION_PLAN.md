# Plan de implementación: transcripción de llamadas (runly.chat)

**Estado (2026-09-24):** Etapas 1-2 y 4 implementadas y verificadas contra la base de datos de desarrollo real (evidencia completa en `docs/TASKS.md`, sección "runly.chat — Call transcription V1"). Etapa 3 (V2, identificación de hablantes) todavía sin implementar, pero su diseño de datos ya se completó por análisis (mismo día, `TRANSCRIPTION_SPEC.md` revisión 3, modelo `CallTranscriptTrack`) a petición explícita del usuario ("empezar el spec ahora") — lo único que sigue genuinamente bloqueado antes de escribir código de esta etapa es la validación contra un LiveKit self-hosted real en vivo (ver revisión 3), no el diseño. Etapa 5 (MirAI) todavía sin implementar, pero su diseño también se completó por análisis el mismo día que el de la Etapa 3 (`TRANSCRIPTION_SPEC.md` revisión 4, §7) — nuevo modelo `CallTranscriptAnalysis`, contrato de API completo, y el mecanismo de prueba firmada de `runly.ledger` confirmado como generalizable sin cambios de lógica. Lo único genuinamente pendiente antes de escribir código: el prompt exacto de Groq, que necesita iterarse contra transcripciones reales, no inventarse. Pendiente antes de considerar V1 completamente cerrado: publicar la imagen `raulbellosom/runlyerp:transcriber-latest` (`pnpm docker:release:transcriber`), medir con una reunión real de 10-20 min, y probar contención de CPU con una llamada/grabación de LiveKit activa.

**Fecha:** 2026-09-23 (revisión 2)
**Depende de:** `docs/TRANSCRIPTION_SPEC.md` (aprobado antes de ejecutar cualquier etapa)
**Formato:** cada etapa está pensada para poder encargarse a un implementador (ej. Codex) por separado, sin necesitar rediseñar la arquitectura completa.

**Nota de la revisión 2**: la Etapa 1 se ejecutó parcialmente en esta intervención — ver `scripts/poc-transcription/RESULTS.md` para la evidencia real. Se corrió en tres rondas: dos en la máquina de desarrollo local (audio sintético y audio real corto) y **una tercera directamente en el VPS de producción KVM4**, ejecutada por el usuario siguiendo instrucciones (sin que ningún agente/asistente necesitara acceso remoto a esa VPS — el experimento es un contenedor Docker aislado que no toca `docker-compose.yml` ni el instalador). Confirmado en el KVM4 real: `small`/int8 es la recomendación provisional (mejor calidad que `base` y no más lento), y se identificó un parámetro de producción a fijar explícitamente — `--cpu-threads`, en vez de dejarlo en automático, porque el número de hilos que faster-whisper autodetecta depende de los núcleos *visibles* dentro del contenedor, no del límite real de `--cpus` del cgroup (esto afectó tanto el uso de RAM como el tiempo de transcripción de forma medible entre dos máquinas con distinto número de núcleos). Sigue pendiente: una reunión real de 10-20 minutos y una prueba de contención con una llamada/grabación de LiveKit activa en el KVM4 — ver los criterios de aceptación de la Etapa 1 sin modificar, y el detalle completo en `RESULTS.md`.

---

## Etapa 0 — Aprobación de spec y resolución de preguntas abiertas

**Objetivo:** cerrar las decisiones que este plan no puede tomar por sí solo.
**Dependencias:** ninguna.
**Archivos/componentes:** ninguno (solo decisión).
**Cambios en BD:** ninguno.
**Cambios en Docker Compose/instalador:** ninguno.
**Riesgos:** ejecutar etapas posteriores sobre supuestos no confirmados por el usuario.
**Pruebas:** N/A.
**Criterios de aceptación:** el usuario ha respondido las preguntas de `docs/TRANSCRIPTION_OPEN_QUESTIONS.md` marcadas como bloqueantes para la Etapa 1.
**Condición para avanzar:** aprobación explícita de `TRANSCRIPTION_SPEC.md` y de las decisiones de la Etapa 0.

---

## Etapa 1 — Prueba de concepto: faster-whisper aislado

**Objetivo:** medir (no asumir) velocidad, precisión aproximada, consumo de CPU/RAM de faster-whisper (modelo `base`, multilingüe, INT8, CPU) transcribiendo un fragmento real de audio de reunión, en un entorno aislado que no toque el repositorio de producción.

**Dependencias:** ninguna del código de Runly — es un experimento independiente.

**Archivos/componentes a crear (todos descartables, fuera del árbol de producción hasta validar):**
- Un script Python de prueba (`scripts/poc-transcription/transcribe_test.py` o similar, en una carpeta claramente marcada como experimental) que:
  1. Recibe un archivo de audio local (extraído manualmente de una grabación real vía `ffmpeg -i index.m3u8 -vn audio.wav`, descargada una sola vez del bucket `runly-chat` para esta prueba).
  2. Corre `faster-whisper` con `model_size="base"`, `device="cpu"`, `compute_type="int8"`.
  3. Imprime: tiempo total de transcripción, uso pico de RAM (medido con `resource`/`psutil`, no estimado), texto resultante con marcas de tiempo por segmento.
- Un `Dockerfile` mínimo (`scripts/poc-transcription/Dockerfile`) para correr esto en un contenedor aislado con límites de CPU/RAM explícitos (`docker run --cpus=1.5 --memory=3g`, ajustable — valores iniciales sugeridos, no definitivos hasta medir), replicando las condiciones que tendría el contenedor de producción.

**Cambios en BD:** ninguno.
**Cambios en Docker Compose/instalador:** ninguno — esto vive fuera de `infra/installer/` hasta que se apruebe.

**Riesgos:**
- El modelo `base` puede no ser suficientemente preciso para español con acentos/jerga técnica — si es así, medir también `small` antes de decidir el modelo por defecto.
- El VPS real de producción puede no estar disponible para pruebas destructivas de CPU — usar una réplica o el entorno de desarrollo del usuario, nunca el VPS de producción sin autorización explícita.

**Pruebas:** ejecución manual, documentar resultados reales (tiempo, RAM, precisión subjetiva) en un archivo de evidencia — nunca inventar cifras.

**Criterios de aceptación:**
1. Se transcribió al menos un audio real de una reunión (idealmente 10-20 min) de principio a fin sin errores.
2. Se registraron cifras reales de tiempo de procesamiento y RAM pico, con el hardware/límites usados documentados junto a ellas.
3. Se decidió, con esas cifras en mano, si el modelo por defecto de producción será `base` o `small`.

**Condición para avanzar a la Etapa 2:** las cifras de la Etapa 1 no descartan la viabilidad de faster-whisper en un KVM 4 sin GPU (si las cifras son claramente inviables — por ejemplo, más tiempo de procesamiento que la duración de la llamada por un margen grande, o RAM que no cabe junto al resto de servicios — este plan debe revisarse antes de continuar, no forzarse).

---

## Etapa 2 — Modelo de datos y contenedor de transcripción (V1, alternativa mixta)

**Objetivo:** implementar el pipeline completo de transcripción básica (Alternativa A: audio mezclado de la grabación existente, sin identificación de hablantes), de extremo a extremo, en un entorno de desarrollo.

**Dependencias:** Etapa 1 aprobada; `TRANSCRIPTION_SPEC.md` §3-4 aprobado.

**Archivos/componentes a crear o modificar:**
- `prisma/schema.prisma`: añadir `CallTranscript` (incluyendo `leaseExpiresAt`/`workerInstanceId`, spec §3.1 revisión 2), `CallTranscriptSegment`, `CallTranscriptSourceKind` (spec §3.1).
- Nueva migración `prisma/migrations/<timestamp>_add_call_transcript/migration.sql` (generada con `pnpm db:generate`/`pnpm db:migrate`, nunca escrita a mano contra convención del proyecto).
- **Nuevo script de infraestructura** (no Prisma — `infra/installer/sql/` o ubicación equivalente): aprovisionamiento idempotente del rol `runly_transcriber` de mínimo privilegio (spec §5.4), con generación de contraseña vía `crypto.randomBytes` igual que las credenciales de LiveKit. Se ejecuta una vez por instalación; **en esta etapa se prueba solo contra la BD de desarrollo**, la integración con el instalador de producción es la Etapa 4.
- `apps/api/src/routes/calls/call-transcript-service.js` (nuevo): `requestTranscript`, `listTranscripts`, `getTranscript`, `retryTranscript`, `deleteTranscript`, `assertTranscriptAccess()` (spec §5.1/§5.3 — participante real de la llamada, solicitante, o `chat.calls.transcript.manage`; **no** el simple `assertMember` de grabaciones), `reconcileCompletedTranscripts()` (sweep de detección, mismo patrón que `reconcileActiveRecordings`), `cleanupExpiredTranscripts()` (retención independiente vía `InstanceConfig`, spec §5.7).
- `apps/api/src/routes/calls/index.js`: nuevas rutas (spec §4), registro de los nuevos `setInterval` (reconciliación + limpieza) siguiendo el mismo bloque `if (!service)` que ya protege los sweeps de llamadas/grabaciones.
- `apps/api/src/permission-catalog.js`: dos entradas nuevas — `chat.calls.transcript.request` y `chat.calls.transcript.manage` (spec §5.2, revisión 2 — antes era solo una).
- `apps/api/src/manifests/official/feature-modules.js`: declarar ambos permisos nuevos en el manifiesto de `runly.chat` (mismo lugar donde vive `chat.calls.record`).
- `packages/validators/src/chat.js` (o archivo equivalente de validadores de llamadas): esquemas Zod para los nuevos endpoints.
- `packages/sdk/src/domains/calls.js`: métodos nuevos del SDK (spec §4.1).
- **Contenedor nuevo — `infra/docker/runly-transcriber/`** (nombre de carpeta a confirmar contra la convención real de `infra/docker/` existente):
  - `Dockerfile`: Python + `faster-whisper` + `ffmpeg` + cliente Postgres (`psycopg` o `asyncpg`, conectado con la credencial `runly_transcriber` de mínimo privilegio, no `DATABASE_URL`) + cliente S3 (`boto3` o equivalente compatible con el endpoint S3 de Supabase Storage).
  - `main.py`: bucle de sondeo con arrendamiento (`FOR UPDATE SKIP LOCKED` + `lease_expires_at`, spec §4.2/§5.6), latido periódico durante el procesamiento (renovación del lease cada ~2 min), descarga de segmentos, extracción de audio con `ffmpeg`, transcripción, **escritura idempotente** de segmentos (`DELETE` + `INSERT` transaccional, spec §5.6), actualización de estado, manejo de `attempts`/`MAX_ATTEMPTS` (3, igual que PFM) distinguiendo errores transitorios (vuelven a `PENDING`) de definitivos (`FAILED` directo), limpieza de archivos temporales al finalizar cada trabajo (éxito o fallo).
  - Variables de entorno: `TRANSCRIBER_DATABASE_URL` (rol de mínimo privilegio, no la credencial completa de la API), `SUPABASE_S3_*` (reutilizar las mismas que Egress), `WHISPER_MODEL` (default **`small`**, no `base` — cambiado tras la evidencia real de la Etapa 1, ver `scripts/poc-transcription/RESULTS.md`), `WHISPER_COMPUTE_TYPE` (default `int8`), `WHISPER_CPU_THREADS` (**nuevo, sin default automático** — debe fijarse explícitamente en función del límite real de `deploy.resources.limits.cpus` del contenedor, nunca dejarse en autodetección; ver hallazgo de la Etapa 1 sobre RAM/tiempo afectados por el número de núcleos visibles vs. el cupo real de CPU), `TRANSCRIBER_POLL_INTERVAL_MS` (default 20000), `TRANSCRIBER_LEASE_MINUTES` (default 10), `TRANSCRIBER_HEARTBEAT_MINUTES` (default 2).

**Cambios en BD:** migración aditiva nueva (tabla nueva, sin tocar tablas existentes) + el rol de Postgres nuevo (fuera de Prisma).

**Cambios en Docker Compose/instalador:** **ninguno todavía en esta etapa** — el contenedor se levanta manualmente (`docker compose -f infra/docker/runly-transcriber/docker-compose.dev.yml up`) contra el entorno de desarrollo, para poder iterar rápido sin tocar el instalador de producción. La integración con `infra/installer/docker-compose.yml` es la Etapa 4.

**Riesgos:**
- Escribir SQL crudo en Python que no coincida exactamente con los nombres de columna `snake_case` generados por Prisma (`@map`) — mitigación: generar el DDL con `pnpm db:generate` primero y verificar contra `\d call_transcript` en Postgres antes de escribir el cliente Python.
- Condiciones de carrera si en el futuro hay más de un contenedor transcriptor — mitigado desde el diseño por `FOR UPDATE SKIP LOCKED` (spec §4.2), pero debe probarse con al menos 2 instancias del contenedor corriendo en paralelo contra la misma fila `PENDING`.
- El rol `runly_transcriber` con `GRANT`s incompletos puede fallar en producción de forma no evidente en desarrollo si el desarrollador prueba con una credencial más permisiva por comodidad — mitigación: probar explícitamente CON el rol acotado desde el principio de esta etapa, no dejarlo para el final.
- Un lease mal calibrado (`TRANSCRIBER_LEASE_MINUTES` demasiado corto) podría hacer que un trabajo legítimo y lento sea reclamado por error — mitigación: la prueba de "contenedor muere a mitad de un trabajo" (abajo) debe correr junto con una prueba de "trabajo largo pero sano no pierde su lease por falta de latido".
- `WHISPER_CPU_THREADS` sin fijar (dejado en autodetección) puede producir un consumo de RAM y un tiempo de transcripción distintos entre el entorno de desarrollo (donde se construye/prueba la imagen) y el contenedor real de producción, si ambos tienen un número de núcleos visibles distinto al límite de `deploy.resources.limits.cpus` configurado — evidencia real de esta discrepancia en `scripts/poc-transcription/RESULTS.md` ("Tercera ronda"). Mitigación: fijar `WHISPER_CPU_THREADS` explícitamente al construir/probar la imagen para este proyecto, nunca confiar en el valor por defecto de faster-whisper.

**Pruebas:**
- `node --test apps/api/src/routes/calls/__tests__/call-transcript-service.test.js` — unitarias del nuevo servicio Node (mocks de Prisma, sin DB real), incluyendo casos de `assertTranscriptAccess` (participante real vs. miembro actual no-participante vs. `chat.calls.transcript.manage`).
- Prueba de integración Python (`pytest` o script manual) contra una BD Postgres desechable, **usando el rol `runly_transcriber` real, no una credencial de superusuario**: crear una fila `PENDING` con datos sintéticos, arrancar el contenedor, confirmar que reclama la fila, la transiciona a `PROCESSING` y luego a `READY`/`FAILED` según corresponda.
- Prueba manual de extremo a extremo: llamada real grabada → `POST /calls/:callId/transcript/request` → esperar → `GET /calls/transcripts/:id` devuelve segmentos reales.
- Prueba de concurrencia: dos contenedores transcriptores apuntando a la misma BD, confirmar que ninguna fila se procesa dos veces.
- **Prueba de recuperación de trabajo abandonado**: matar el contenedor (`docker kill`) a mitad de una transcripción real, confirmar que tras vencer el lease otro contenedor (o el mismo, reiniciado) retoma la fila y la completa sin duplicar segmentos.
- **Prueba de borrado durante procesamiento**: borrar la fila `call_transcript` (`DELETE /calls/transcripts/:id`) mientras el contenedor la tiene en `PROCESSING`, confirmar que el contenedor no falla ni reintenta indefinidamente cuando su `UPDATE` final afecta 0 filas.

**Criterios de aceptación:**
1. Una llamada de prueba grabada produce una transcripción legible con marcas de tiempo, accesible vía API.
2. Un fallo de transcripción (ej. audio corrupto) deja la fila en `FAILED` con `failureReason`, reintentable.
3. Un usuario que es miembro actual de la conversación pero **no** participó en esa llamada específica recibe 403/404 al intentar leer su transcripción, salvo que tenga `chat.calls.transcript.manage`.
4. Matar el contenedor a mitad de un trabajo real resulta en que el trabajo se completa igualmente (por el mismo contenedor tras reiniciar, o por otro), sin segmentos duplicados.
5. El contenedor opera correctamente con el rol `runly_transcriber` de mínimo privilegio — un intento de acceder a cualquier otra tabla del esquema falla con un error de permisos de Postgres, verificado explícitamente (no solo asumido).
6. `pnpm build`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm lint` pasan limpios.
7. Ningún cambio de comportamiento en llamadas/grabaciones existentes (regresión cero).

**Condición para avanzar a la Etapa 3:** el pipeline V1 funciona de extremo a extremo en desarrollo, con al menos una medición real de tiempo total (desde `PENDING` hasta `READY`) para una llamada de duración conocida, y la recuperación de trabajos interrumpidos verificada con una prueba real, no solo diseñada.

---

## Etapa 3 — Identificación de participantes (V2, captura por pista)

**Objetivo:** implementar la Alternativa B (spec §0.2) — captura de audio por participante vía `EgressClient.startTrackEgress`, atribución real de hablante sin diarización acústica.

**Dependencias:** Etapa 2 completa y verificada; validación explícita de que `startTrackEgress` funciona como se espera contra el LiveKit self-hosted real de la instancia (nunca antes usado en este repo — no asumir que se comporta igual que `startRoomCompositeEgress`).

**Archivos/componentes a modificar:**
- `call-transcript-service.js`: nueva función `startTrackCapture(callId)` — enumera participantes/invitados con pista de audio publicada (vía `RoomServiceClient.listParticipants`, ya usado en `call-guest-service.js` para mute/kick), llama `startTrackEgress` por cada uno, con objeto de salida `recordings/transcripts/<conversationId>/<callId>/track_<livekitIdentity>.ogg` (o formato equivalente que Egress soporte para audio-only).
- `CallTranscript.sourceKind = 'PER_TRACK'`, sin requerir `recordingId`.
- Lógica de fusión en el contenedor Python: transcribe cada pista por separado, intercala segmentos por marca de tiempo absoluta (offset relativo al inicio de la captura, correlacionado con `CallParticipant.joinedAt`/`CallGuest.admittedAt`), resuelve `speakerUserId`/`speakerGuestId` desde el nombre del archivo (que codifica la `livekitIdentity`).
- Sweep de reconciliación extendido: igual que `reconcileActiveRecordings`, pero por cada fila `CallTranscriptTrack` activa de una captura `PER_TRACK` (múltiples `egressId` por `CallTranscript`, uno por fila — **resuelto en `TRANSCRIPTION_SPEC.md` revisión 3, ya no es una decisión abierta de esta etapa**: se deriva del contrato documentado de `startTrackEgress`, cada llamada es un trabajo de egress independiente, no de un comportamiento no documentado que hubiera que descubrir en vivo).

**Cambios en BD:** migración aditiva para `call_transcript_track` (modelo ya diseñado, `TRANSCRIPTION_SPEC.md` §3.1) — se crea al iniciar esta etapa, no es un descubrimiento pendiente de la prueba técnica.

**Cambios en Docker Compose/instalador:** ninguno nuevo — reutiliza el mismo perfil `livekit-egress` ya existente (el contenedor `egress` es el que ejecuta tanto `startRoomCompositeEgress` como `startTrackEgress`).

**Riesgos** (el modelo de datos de N pistas por transcripción ya no es uno de ellos — resuelto por análisis en `TRANSCRIPTION_SPEC.md` revisión 3):
- `startTrackEgress` puede tener limitaciones no documentadas en la versión de LiveKit Egress que usa Runly (`v1.9.0`) — validar contra la documentación oficial de esa versión específica antes de comprometerse al diseño de fusión.
- Costo de CPU real de N pistas simultáneas de audio-egress no medido — medir en esta etapa, no asumir que es despreciable solo porque no usa Chrome headless.
- Bleed de audio entre micrófonos cercanos puede generar transcripciones parcialmente duplicadas — documentar como limitación conocida, no un bug a resolver en V2.

**Pruebas:**
- Llamada de prueba con 2-3 participantes reales, cada uno con turnos de habla claros — confirmar que la transcripción fusionada atribuye correctamente cada intervención.
- Caso de invitado externo (`CallGuest`) — confirmar que su nombre (`displayName`) aparece correctamente, no solo su identidad técnica de LiveKit.
- Medición de CPU con captura por pista activa simultánea a una llamada de video normal (sin grabación de video, para aislar el costo).

**Criterios de aceptación:**
1. Una transcripción con 2+ hablantes reales muestra las intervenciones correctamente atribuidas por nombre, en el formato de ejemplo del encargo original (`[00:02:15] Raúl: ...`).
2. El costo de CPU adicional de la captura por pista está medido y documentado (no estimado).
3. La captura por pista funciona sin necesidad de que la grabación de video de sala completa esté activa.

**Condición para avanzar a la Etapa 4:** V2 verificado en un entorno de prueba con participantes reales, no solo datos sintéticos.

---

## Etapa 4 — Persistencia, UI y despliegue vía instalador

**Objetivo:** exponer la funcionalidad en el frontend, y hacerla desplegable a través del instalador estándar de Runly (no solo en el entorno de desarrollo del implementador).

**Dependencias:** Etapa 2 (mínimo) completa; Etapa 3 opcional para esta etapa si se decide lanzar V1 primero de forma independiente.

**Archivos/componentes a crear:**
- `apps/desktop/src/modules/runly.chat/calls/hooks/useCallTranscript.js` — poll del estado (mismo patrón que `useCallRecording.js`).
- `apps/desktop/src/modules/runly.chat/components/ChatTranscriptsGallery.jsx` (o extensión de `ChatRecordingsGallery.jsx` con una pestaña nueva) — lista + vista de segmentos con marcas de tiempo.
- Botón "Solicitar transcripción" en la vista de detalle de una `CallRecording` ya lista.
- Aviso de transcripción en curso (si V2 está activo y corre en paralelo a la llamada — reutilizar el patrón de `RecordingBanner.jsx`).
- `infra/installer/lib/transcription-config.mjs` (nuevo, calcado de `livekit-config.mjs`): `resolveTranscriptionConfig({mode, values})`, `getTranscriptionComposeProfiles()`.
- `infra/installer/docker-compose.yml`: nuevo servicio `runly-transcriber`, perfil `transcription`, con `deploy.resources.limits.cpus`/`memory` explícitos (primer precedente de este patrón en el repo — documentar la elección de valores concretos junto al cambio), volumen con nombre `whisper-model-cache` montado en la ruta de caché de modelos de `faster-whisper`.
- `infra/installer/setup-local.mjs`/`setup-external.mjs`: wiring de `TRANSCRIPTION_MODE`, llamada a `resolveTranscriptionConfig`, inclusión del perfil en la lista `--profile` (mismo patrón exacto que LiveKit, spec §6).
- `.env.local.example`/`.env.external.example`: nuevo grupo de variables `TRANSCRIPTION_MODE=disabled` (default seguro — no activar transcripción en instancias existentes sin acción explícita del operador, mismo criterio que `LIVEKIT_MODE=disabled` por defecto).
- `infra/installer/README.md`: nueva sección "Modo de transcripción".

**Cambios en BD:** ninguno nuevo en esta etapa (ya cubierto en Etapa 2/3).

**Cambios en Docker Compose/instalador:** los descritos arriba — esta es la etapa que efectivamente los introduce a producción.

**Riesgos:**
- Una instancia con recursos limitados (menos de 16GB RAM) podría intentar activar transcripción y degradar el resto del sistema — mitigación: documentar requisitos mínimos recomendados en `infra/installer/README.md`, y que `TRANSCRIPTION_MODE=disabled` sea el valor por defecto explícito.
- Actualizar una instancia existente no debe eliminar transcripciones ya generadas ni interrumpir otros servicios — verificar que el volumen `whisper-model-cache` y las tablas nuevas sobreviven `docker compose up -d --force-recreate` sin intervención manual.

**Pruebas:**
- Instalación limpia con `TRANSCRIPTION_MODE=local` desde cero (`setup-local.mjs`) — confirmar que el contenedor se levanta, descarga el modelo una vez, y una transcripción de prueba funciona de extremo a extremo.
- Instalación con `TRANSCRIPTION_MODE=disabled` — confirmar que no se activa ningún contenedor ni aparece ninguna UI de transcripción.
- Actualización de una instancia ya desplegada con `TRANSCRIPTION_MODE=local` — confirmar que el modelo no se vuelve a descargar (cache del volumen funcionando) y que las transcripciones previas siguen accesibles.
- QA manual en navegador: solicitar transcripción, ver estado de progreso, ver resultado final, reintentar una fallida forzada.

**Criterios de aceptación:**
1. Una instancia recién instalada con `TRANSCRIPTION_MODE=local` puede transcribir una llamada real desde la UI, sin pasos manuales fuera del instalador estándar.
2. Una instancia con `TRANSCRIPTION_MODE=disabled` no muestra ninguna UI de transcripción ni consume recursos del contenedor.
3. Una actualización de una instancia existente preserva transcripciones y el caché del modelo.
4. `pnpm build`, `pnpm lint`, suite completa de `node --test` relevante, pasan limpios.

**Condición para avanzar a la Etapa 5:** V1 (y opcionalmente V2) desplegable y usable de extremo a extremo por un operador real, no solo en el entorno del implementador.

### 4.1. Activación en una instalación `local` ya existente (caso real: el VPS de producción)

Aclaración importante de alcance: **esta etapa no requiere ni asume acceso remoto de un agente/asistente a ningún VPS de producción.** El caso real que motiva esta subsección es una instancia que ya corre en modo `local` (Supabase + Runly + LiveKit autoalojados juntos, aprovisionada originalmente con `setup-local.mjs`) y que se va a **actualizar**, no reinstalar desde cero, para añadirle transcripción. Esto se ejecuta con el mecanismo de actualización que el proyecto ya tiene — `update-local.sh` → `bootstrap-local.sh` → `setup-local.mjs` — que está diseñado para re-ejecutarse sobre una instancia viva sin tocar `.env.local` ni los volúmenes de datos existentes (confirmado en la auditoría: `bootstrap-local.sh` nunca toca `.env.local` ni `custom-modules/`).

Procedimiento a diseñar y probar explícitamente en esta etapa (en un entorno desechable/de staging, no en la VPS de producción real — la ejecución en la VPS real la hace quien tenga acceso a ella, cuando decida hacerlo):

1. **Paso manual del operador, documentado en `infra/installer/README.md`**: agregar `TRANSCRIPTION_MODE=local` (y las demás variables nuevas del grupo de transcripción) a `.env.local` — igual que hoy se hace para activar grabación con `SUPABASE_S3_*`. El script de actualización nunca edita este archivo por sí solo, por diseño.
2. **Ejecutar `update-local.sh`** (o `setup-local.mjs` directamente). Debe, sin intervención adicional: (a) aplicar la migración Prisma aditiva nueva vía `prisma migrate deploy` (no destructiva, ya es el comportamiento estándar del proyecto); (b) aprovisionar el rol `runly_transcriber` de forma idempotente — si ya existe de una ejecución anterior, no debe fallar ni intentar recrearlo; (c) descargar la imagen `runly-transcriber`; (d) añadir el perfil `transcription` a la lista de `--profile` del `docker compose up -d --force-recreate`.
3. **Criterio de aceptación explícito de "cero interrupción"**: los servicios que no cambiaron (API, worker, LiveKit, Egress, Supabase, Collabora) no deben reiniciarse ni interrumpirse por el hecho de que `docker compose up` incluya un perfil nuevo — `--force-recreate` solo debe afectar a los contenedores cuya definición cambió. Esto se prueba en el entorno de staging antes de considerar el procedimiento listo para aplicarse a una instancia real.
4. **Solo después de aplicar esto en el hardware real** (decisión y ejecución de quien tenga acceso a esa VPS, no de este ciclo de trabajo) tiene sentido repetir la PoC de la Etapa 1 con los límites de recursos reales y, si es posible, con una llamada activa en curso — esa medición pasa a ser un paso natural del propio rollout en producción, no un bloqueante para cerrar las etapas anteriores de este plan.

---

## Etapa 5 — Preparación de integración con MirAI (interfaces, no automatización)

**Objetivo:** construir los endpoints de "proponer" (análisis IA del transcript) y "confirmar" (creación real de tareas/eventos), siguiendo el patrón `recognize`/`commit` de `runly.ledger` (spec §7), sin ninguna creación automática sin confirmación humana.

**Dependencias:** Etapa 4 completa; al menos una transcripción real disponible para probar el análisis.

**Archivos/componentes a crear** (diseño completo en `TRANSCRIPTION_SPEC.md` §7, revisión 4 — las dos preguntas que esta sección dejaba abiertas ya están resueltas ahí, no quedan como decisiones de esta etapa):
- `apps/api/src/lib/ai-proof-token.js` (nuevo — extraído de `apps/api/src/routes/ledger/ai-import-token.js`, mismo comportamiento exacto, cero cambio de lógica): `signImportProof`/`verifyImportProof` generalizados, ya no específicos de `runly.ledger`. `ai-import-token.js` pasa a re-exportar desde aquí.
- `apps/api/src/routes/calls/call-transcript-analysis-service.js`: `analyzeTranscript(transcriptId)` — reutiliza infraestructura de llamada a Groq de `mirai-service.js` (modelo a decidir: `CHAT_MIRAI_MODEL` u otro dedicado), usa el helper de arriba para el `proofToken`, persiste el resultado en `CallTranscriptAnalysis` (spec §7.1).
- Rutas: `POST /calls/transcripts/:id/analyze`, `POST /calls/transcripts/:id/commit-proposals` (contrato exacto en spec §7.3).
- Permiso nuevo `chat.calls.transcript.analyze` (spec §5.2) — no reutiliza `.request`, porque dispara costo de Groq y puede escribir `Task`/`CalendarEvent` reales.
- UI: pantalla de revisión de propuestas, con dos secciones claramente separadas (decisión de producto confirmada, spec §7 revisión 2): (1) resumen/minuta y lista de acuerdos en texto — **siempre disponible**, sin depender de que la conversación tenga un proyecto asociado; (2) tareas/eventos propuestos, cada uno con checkbox de aceptar/rechazar y selector de proyecto obligatorio antes de poder confirmarlo (`Task.projectId` es obligatorio y no existe lista genérica de tareas) — si el usuario no elige proyecto para una tarea, esa tarea puntual simplemente no se crea, sin bloquear la confirmación del resto del borrador (resumen + otras tareas con proyecto sí elegido). Selector de proyecto vía `CreatableComboboxField` (`@runly/ui`, política de UI obligatoria del repo).

**Cambios en BD:** migración aditiva nueva para `CallTranscriptAnalysis` (modelo ya diseñado, spec §7.1) — **resuelto: sí se persiste**, a diferencia de `runly.ledger` (que nunca persiste su borrador). Razón: un resumen de reunión se reabre días después; pagar Groq de nuevo solo por reabrir la pantalla sería un mal trade-off que un estado de cuenta (analizado una vez, decidido en el momento) no tiene.

**Cambios en Docker Compose/instalador:** ninguno — reutiliza Groq, ya configurado.

**Riesgos:**
- Calidad del resumen/extracción depende del modelo Groq configurado **y del prompt exacto, que esta etapa todavía debe escribir e iterar contra transcripciones reales** (spec §7.4 — deliberadamente no fijado en el spec, mismo principio de "medir, no asumir" de la Etapa 1) — no hay garantía de precisión, debe presentarse siempre como "propuesta a revisar", nunca como hecho.

**Pruebas:** unitarias del servicio de análisis (mock de Groq), prueba manual de extremo a extremo con una transcripción real.

**Criterios de aceptación:**
1. Un usuario puede pedir un análisis de una transcripción y ver un borrador editable de resumen + tareas + eventos propuestos.
2. Ninguna tarea ni evento se crea sin una acción de confirmación explícita del usuario.
3. Las tareas/eventos creados quedan correctamente vinculados (`CalendarEvent.sourceModule='runly.chat'`, `Task` con el proyecto elegido por el usuario).

**Condición para considerar el proyecto completo:** las 5 etapas verificadas, con evidencia real (no solo "implementado") documentada en `docs/TASKS.md` siguiendo la convención `Verified: YYYY-MM-DD (...)` del proyecto.
