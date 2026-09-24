# Dudas y decisiones pendientes: transcripción de llamadas

**Fecha:** 2026-09-23 (revisión 2, tras retroalimentación de dirección de producto)

Solo se listan aquí decisiones que **no pueden resolverse inspeccionando el código actual** — todo lo que sí pudo verificarse en el repositorio está en `docs/TRANSCRIPTION_CURRENT_STATE.md`, y las decisiones de arquitectura que este análisis sí pudo tomar con justificación técnica están en `docs/TRANSCRIPTION_SPEC.md`.

**Cada pregunta se marca con un estado**, para no confundir "el usuario ya decidió una dirección" con "está aprobado y listo para producción":

- 🟢 **Resuelta técnicamente** — decisión de ingeniería, no requiere más aprobación de producto.
- 🟡 **Dirección adoptada, validación final pendiente** — el usuario indicó hacia dónde ir; falta confirmar el detalle exacto antes de construir la API de producción.
- 🔴 **Pendiente de aprobación de producto** — sigue sin una dirección clara, requiere una decisión del usuario que el análisis técnico no puede tomar por sí solo.
- ⏳ **Pendiente de medición empírica** — no es una decisión de producto ni de arquitectura; depende de datos reales que aún no existen (ej. resultados de la Etapa 1).

---

## 1. 🟡 Nivel de acceso a una transcripción — ¿igual que grabaciones, o más estricto?

**Actualización (revisión 2):** el usuario indicó una dirección clara — **más estricto que grabaciones**. `TRANSCRIPTION_SPEC.md` §5.1 ya adopta esta dirección: acceso restringido a quien solicitó la transcripción, a quien participó realmente en esa llamada (`CallParticipant`, no solo miembro actual de la conversación), o a quien tenga el nuevo permiso de administración `chat.calls.transcript.manage`. Los invitados externos (`CallGuest`) quedan propuestos sin acceso posterior alguno a transcripciones, a diferencia de las grabaciones.

**Lo que sigue pendiente de validación explícita antes de construir la API de producción** (por eso sigue listada aquí, no se cierra del todo):
1. Confirmar que excluir por completo a los invitados externos del acceso a transcripciones (incluso mediante un enlace) es efectivamente lo que se quiere, y no solo una propuesta razonable de este análisis.
2. Confirmar el criterio exacto para "usuario autorizado" más allá de "participó en la llamada" — el encargo original menciona explícitamente "usuarios expresamente autorizados" como una categoría adicional a "participantes", sin detallar qué la distingue de tener el permiso `chat.calls.transcript.manage`. Podría ser lo mismo, o podría implicar un mecanismo de autorización puntual por transcripción (ej. "compartir esta transcripción con X persona específica", análogo a compartir un archivo) que hoy no está diseñado.

---

## 2. 🟢 Contrato entre el contenedor Python y el resto del sistema — sondeo directo a Postgres, con rol de mínimo privilegio

**Actualización (revisión 2) — resuelta técnicamente:** el usuario confirmó mantener el sondeo directo a Postgres (sin introducir una API HTTP interna ni una cola nueva), pero exigió que el contenedor **no** reciba la credencial completa de la aplicación. `TRANSCRIPTION_SPEC.md` §5.4 ya diseña un rol de Postgres dedicado (`runly_transcriber`) con `GRANT` acotado a exactamente las tablas necesarias (escritura en `call_transcript`/`call_transcript_segment`, lectura en `call`/`call_participant`/`call_guest`/`call_recording`/`user_profile`, nada más). Esto cierra la pregunta original entre las tres alternativas planteadas — se eligió una versión reforzada de la opción (a) original (sondeo directo), combinada con la opción (b) (rol dedicado) en vez de la (c) (API HTTP interna).

**Lo que queda para la etapa de implementación, no para este documento**: el diseño está resuelto; falta construir el script de aprovisionamiento idempotente del rol en el instalador y probarlo en una instalación limpia y en una actualización — ver `TRANSCRIPTION_IMPLEMENTATION_PLAN.md`.

**Qué información adicional ayudaría a decidir**: qué tan sensible es el operador típico de una instalación de Runly respecto a añadir roles de Postgres granulares en el instalador (esto es trabajo adicional de la Etapa 4 del plan si se elige la opción (b)), y si el usuario prefiere mantener la superficie de cambio mínima para la primera versión.

---

## 3. 🟡 Modelo del transcriptor por defecto — evidencia real ya apunta a `small`, falta confirmar con más muestras

**Actualización (2026-09-24):** la Etapa 1 ya corrió, incluyendo una ronda directamente en el VPS KVM4 real (`scripts/poc-transcription/RESULTS.md`), sobre un clip real de ~71 segundos. Resultado consistente en dos máquinas distintas: `small` produce texto notablemente más coherente que `base` (que mostró bucles de repetición y alucinaciones sobre este audio real) y, en el KVM4 real, además fue más rápido (20.8s vs. 35.3s). La recomendación provisional pasa de `base` a **`small`**.

**Por qué sigue sin marcarse como 🟢 resuelta del todo**: toda la evidencia real proviene de una sola grabación corta (71s) con un solo hablante. No se ha probado con: una reunión de duración típica (10-20 min), múltiples hablantes/superposición de voces, ni con contención real de CPU (LiveKit/Egress activos simultáneamente). El patrón observado es consistente y razonablemente confiable como punto de partida, pero fijar `small` como decisión definitiva de producción sin más muestras sería ir más allá de lo que esta evidencia realmente sostiene.

**Hallazgo adicional no anticipado**: `--cpu-threads` de faster-whisper debe fijarse explícitamente en producción (no dejarse en autodetección) — el número de hilos que autodetecta depende de los núcleos *visibles* dentro del contenedor, no del límite real de CPU asignado, y esto afectó de forma medible tanto el RAM como el tiempo de transcripción entre las dos máquinas probadas.

---

## 4. 🟢 Alcance de "modo" de transcripción en el instalador — resuelto: 2 valores, sin exponer configuración no funcional

**Actualización (revisión 2) — resuelta:** el usuario eligió explícitamente la opción (b) de la revisión 1 y añadió una restricción adicional: `TRANSCRIPTION_MODE` se mantiene en `{local, disabled}`, **sin** un tercer valor `api` reservado-pero-sin-implementar — "no habilites valores de configuración que aparenten ofrecer una funcionalidad todavía no implementada". La sustituibilidad futura de motor se resuelve con una abstracción interna en el código (`TRANSCRIPTION_SPEC.md` §6), no con una opción de configuración visible para el operador. Si en el futuro se decide ofrecer un proveedor externo de pago como alternativa, eso será un cambio incremental explícito cuando el usuario lo pida, con su propio valor de enum añadido en ese momento — no algo pre-reservado hoy.

---

## 5. 🟢 Proyecto por defecto para tareas propuestas por MirAI desde una transcripción

**Actualización (revisión 2) — resuelta:** el usuario confirmó la opción (a) de la revisión 1 (el usuario elige manualmente el proyecto por cada tarea, en la pantalla de revisión), combinada con parte de la opción (c): **si la reunión/conversación no está asociada a ningún proyecto, MirAI debe poder generar igualmente un resumen/minuta y una lista de acuerdos, sin forzar la creación de tareas formales.** La creación de `Task`s reales queda como un enriquecimiento opcional del resultado, nunca como requisito para obtener valor de la función. Ver `TRANSCRIPTION_SPEC.md` §7 (sección de integración con MirAI) para el detalle incorporado.

**Nota para la Etapa 5 del plan, no una pregunta abierta**: la pantalla de revisión de propuestas debe distinguir visualmente "acuerdos/resumen" (siempre disponible) de "tareas propuestas" (solo accionable si se elige un proyecto).

---

## 6. 🟡 Retención de la transcripción — mecanismo decidido, valor numérico pendiente

**Actualización (revisión 2):** el usuario confirmó la dirección (b) de la revisión 1 — la transcripción **no** debe expirar automáticamente junto con su grabación de origen; necesita una retención propia. `TRANSCRIPTION_SPEC.md` §5.7 ya diseña el mecanismo: un valor configurable en `InstanceConfig` (tabla clave-valor ya usada en el repo, ver `growth-retention-worker.js`), en vez de heredar `CallRecording.expiresAt`.

**Lo que sigue genuinamente pendiente de aprobación de producto** (el usuario fue explícito: "no establezcas automáticamente una retención indefinida" ni asumas un número):
1. **El valor numérico por defecto** — ¿90 días como las grabaciones, algo más largo dado que el texto es barato de almacenar, o indefinido sujeto a borrado manual? Este análisis no fija ninguno de los tres sin que el usuario lo confirme.
2. **Alcance por empresa vs. por instancia** — `InstanceConfig` es una tabla a nivel de instancia completa, no por empresa individual. Si el usuario quiere que distintas empresas de una misma instalación de Runly tengan políticas de retención distintas (mencionado como posibilidad — "no asumas que todas las empresas tendrán las mismas necesidades"), el mecanismo de `InstanceConfig` no alcanza y haría falta una columna nueva en `Company` u otra tabla de configuración por empresa que hoy no existe. Confirmar si esto es necesario desde V1 o puede quedar como una limitación conocida a resolver más adelante.
3. **Requisitos legales/de cumplimiento específicos** — si existe algún requisito conocido de la jurisdicción del usuario o de sus clientes que obligue a un plazo concreto (o a poder configurarlo por empresa desde el día uno), es información que el usuario tiene y el código no puede tener.
