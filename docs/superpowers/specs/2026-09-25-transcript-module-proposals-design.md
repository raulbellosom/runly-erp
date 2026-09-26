# Propuestas de IA multi-módulo desde transcripciones (piloto: contactos)

## 2. Status

In Progress — código del framework + piloto de contactos implementado y con pruebas unitarias/integración pasando (2026-09-25, ver `docs/TASKS.md`), pero sin verificación contra una transcripción real (calidad de extracción de Groq no medida en esta sesión, mismo aviso que el resto de trabajo de IA de esta conversación). Se marca `Complete` solo después de esa verificación.

## 3. Context

`runly.chat` ya tiene "MirAI analiza la transcripción" (Etapa 5, `docs/TRANSCRIPTION_SPEC.md` §7): a partir del texto de una llamada transcrita, Groq genera un resumen, acuerdos, tareas propuestas y eventos de calendario propuestos; el usuario revisa y confirma antes de que se cree nada real (`call-transcript-analysis-service.js`). El usuario probó esta función y dio feedback concreto:

1. El modal "no termina de convencer": calidad del contenido generado, diseño visual, y la fricción de elegir proyecto/calendario ítem por ítem — además, el resumen es incómodo de leer y falta poder copiarlo.
2. Un bug real: se creaba la tarea pero no el evento de la reunión siguiente, aunque en la llamada sí se mencionó una próxima reunión.
3. Pide explícitamente que esto **no sea exclusivo de tareas/eventos** — si la transcripción menciona algo relevante para *otro* módulo de Runly (contactos, finanzas, inventario, "y más opciones de esa manera"), MirAI también debería poder proponerlo, **respetando la barrera de empresas (multi-tenancy)**.

Los puntos 1 y 2 (UI + bug de fecha) ya se implementaron en esta misma sesión, fuera de este spec (ver `docs/TASKS.md`). Este spec cubre exclusivamente el punto 3: la arquitectura extensible ("framework") y su primer módulo piloto real, contactos.

## 4. Problem

Hoy, `call-transcript-analysis-service.js` tiene el schema de Groq y la lógica de creación (`createTask`/`createEvent`) escritos directamente en el servicio, hardcodeados a dos tipos de propuesta. No hay ningún punto de extensión: agregar un tercer tipo de propuesta (ej. un contacto) requeriría editar ese archivo central y mezclar lógica de negocio de otro módulo ahí — y no hay ningún mecanismo para que una propuesta de un módulo instalable (a diferencia de tareas/calendario, que son núcleo) respete si ese módulo está realmente habilitado para la empresa de esa transcripción.

## 5. Goals

1. Un registro de "descriptores de propuesta" donde cualquier módulo puede registrar: qué le pide a Groq, cómo detecta si el registro ya existe, y cómo lo crea/actualiza al confirmar — sin tocar `call-transcript-analysis-service.js` más que para registrar el descriptor.
2. Antes de construir el prompt de Groq, el servicio resuelve qué módulos con descriptor registrado están instalados **y** habilitados para la empresa de esa transcripción, y solo incluye sus fragmentos de prompt/schema si aplica.
3. Una sola llamada a Groq (no una por módulo) que combina el schema base (resumen/acuerdos/tareas/eventos, sin cambios) con los fragmentos de los módulos aplicables.
4. Piloto completo y funcional: `runly.contacts` — detecta personas/empresas mencionadas, distingue "crear nuevo" vs "actualizar existente" (por coincidencia de nombre), dejando que el usuario confirme el tipo de contacto antes de crear/actualizar.
5. Cada módulo que participa aplica exactamente el mismo nivel de defensa que ya existe para tareas (`assertProjectAccess`): nunca confiar en un ID de registro existente que venga del cliente sin revalidar que pertenece a la empresa de la transcripción.

## 6. Non-goals

1. Implementar los módulos de finanzas (`runly.ledger`) o inventario en esta pasada — quedan diseñados a nivel de patrón (cómo se vería su descriptor) pero no se programan. Es trabajo de seguimiento explícitamente diferido, no un olvido.
2. Reconocimiento de voz biométrico o cualquier forma de identificar *quién* habló más allá de lo que la transcripción V2 (identificación de hablantes por pista) ya provee — fuera de alcance, ya resuelto en otro spec.
3. Edición inline de los campos detectados por la IA (nombre, correo, teléfono) dentro del modal — el usuario confirma o descarta la propuesta tal como viene, más el campo de clasificación requerido (tipo de contacto). Edición de campos queda como mejora futura (§28).
4. Migrar `actionItems`/`proposedEvents` (los dos tipos ya existentes) al nuevo registro de descriptores — siguen como columnas tipadas tal como están hoy; el registro es solo para tipos de propuesta *nuevos*, empezando por contactos.

## 7. User stories

1. Como usuario de `runly.chat` con permiso de análisis de transcripciones, quiero que MirAI detecte cuando en una llamada se mencionó a una persona o empresa nueva, para no tener que crear el contacto manualmente después.
2. Como usuario, quiero que si esa persona ya existe como contacto, MirAI me proponga *actualizarlo* (ej. agregar el teléfono que dio en la llamada) en vez de crear un duplicado.
3. Como desarrollador de Runly, quiero poder agregar un módulo nuevo a este sistema (ej. finanzas) escribiendo un descriptor, sin tener que modificar el servicio central de análisis ni arriesgar romper contactos/tareas/eventos ya existentes.
4. Como administrador de una empresa que no tiene instalado `runly.ledger`, quiero tener la garantía de que MirAI nunca me proponga crear una factura — ese módulo no existe para mi empresa.

## 8. UX requirements

- Nueva tarjeta "Contactos propuestos" en `TranscriptAnalysisDialog.jsx`, mismo estilo de tarjeta (`rounded-lg border ... p-3`) que "Tareas propuestas"/"Eventos propuestos" ya usan.
- Cada fila: nombre detectado + badge de texto "Nuevo" o "Actualizar" (según si se encontró coincidencia) + un `ComboboxField` para el tipo de contacto (persona/empresa/cliente/proveedor — mismo enum que ya usa `runly.contacts`), con la sugerencia de la IA preseleccionada pero editable.
- Cuando es "Actualizar", se muestra debajo el nombre del contacto existente encontrado (enlace/texto, sin necesidad de abrirlo) para que el usuario confirme que es la misma persona antes de aceptar.
- Se suma al botón "Copiar todo" ya existente (ver `transcriptAnalysisExport.js`) — el texto copiado incluye una sección "Contactos propuestos" cuando aplica.
- Todo en español, mismo tono que el resto del modal.
- Si ningún módulo adicional (más allá de tareas/eventos) tiene contenido que proponer para esa transcripción, la tarjeta correspondiente simplemente no se renderiza — igual que hoy pasa con "Acuerdos" cuando `decisions` viene vacío.

## 9. Routes/screens

- Pantalla existente, sin ruta nueva: `TranscriptAnalysisDialog.jsx`, modal abierto desde `TranscriptViewerDialog.jsx` (módulo `runly.chat`).
- Sin pantallas nuevas de navegación — esto vive enteramente dentro del modal ya existente.

## 10. Data model

**Nuevo:** `CallTranscriptAnalysis.moduleProposals Json?` (nullable, default vacío `{}` a nivel de aplicación, no a nivel de columna). Forma:

```json
{
  "runly.contacts": {
    "proposed": [
      {
        "name": "Juan Pérez",
        "suggestedType": "customer",
        "email": "juan@acme.com",
        "phone": null,
        "company": "Acme S.A.",
        "matchedContactId": "uuid-o-null"
      }
    ],
    "committedIds": ["uuid1", "uuid2"]
  }
}
```

Diseño deliberado: **una columna JSON genérica indexada por `moduleKey`**, no una columna tipada por módulo (`proposedContacts`, `proposedInvoices`, ...). Justificación: el pedido explícito del usuario es que este sistema generalice a "más opciones" sin fricción — con columnas tipadas, cada módulo nuevo exigiría una migración de Prisma; con el bucket genérico, un módulo nuevo es 100% código (un descriptor nuevo), cero cambios de schema. El costo aceptado: menos auto-documentación en el `schema.prisma` en sí (mitigado documentando la forma exacta aquí y en el propio código del registro).

`actionItems`/`proposedEvents`/`committedTaskIds`/`committedEventIds` (los dos tipos ya existentes) **no cambian** — siguen siendo columnas tipadas independientes, por Non-goal §4.

## 11. Prisma impact

- **Modificado:** `CallTranscriptAnalysis` — nueva columna `moduleProposals Json?`.
- **Nueva migración aditiva** (una sola columna nullable, sin tocar datos existentes): `prisma/migrations/YYYYMMDDHHMMSS_call_transcript_analysis_module_proposals/migration.sql`.
- Ningún otro modelo cambia. `runly.contacts`' `Contact` model no se toca — se reutiliza tal cual vía `contacts-service.js`.

## 12. API contract

Sin rutas nuevas. Los dos endpoints existentes cambian de comportamiento interno, no de firma:

| Método y ruta | Cambio |
|---|---|
| `POST /calls/transcripts/:id/analyze` | La respuesta (`{ analysis, proofToken }`) ahora puede incluir `analysis.moduleProposals` cuando algún módulo aplicable tuvo contenido que proponer. |
| `POST /calls/transcripts/:id/commit-proposals` | El body acepta un campo nuevo opcional `acceptedModuleProposals: [{ moduleKey: string, index: number, decision: object }]` — `decision` es específico de cada módulo (para contactos: `{ type: string }`, el tipo de contacto confirmado por el usuario). La respuesta agrega `createdModuleRecords: [{ moduleKey, index, recordId }]` y extiende `skippedActionItems`-style `skippedModuleProposals: [{ moduleKey, index, reason }]`. |

Permiso de ruta sin cambios: ambas rutas siguen gateadas por `chat.calls.transcript.analyze` (ver §18 para el permiso adicional que se evalúa *dentro* del commit, no en la ruta).

## 13. SDK contract

`packages/sdk/src/domains/calls.js`: `commitTranscriptProposals(transcriptId, body, token)` — sin cambio de firma, `body` ya es un objeto libre pasado tal cual; el frontend simplemente agrega la clave `acceptedModuleProposals` cuando aplica. Sin métodos SDK nuevos.

## 14. Validator contract

`packages/validators`: `callTranscriptCommitProposalsSchema` se extiende con:

```js
acceptedModuleProposals: z.array(z.object({
  moduleKey: z.string(),
  index: z.number().int().nonnegative(),
  decision: z.record(z.any()),
})).optional().default([]),
```

## 15. Module manifest impact

N/A directo — no se crea ningún módulo RME3 nuevo. El descriptor de contactos vive como un archivo de servicio normal (`apps/api/src/routes/calls/transcript-proposal-modules/contacts-proposal-module.js`), registrado desde `call-transcript-analysis-service.js`; no pasa por el sistema de manifiestos/blueprints de RME3 en absoluto (mismo criterio que `TRANSCRIPTION_CURRENT_STATE.md` §5.7 ya estableció: `runly.chat`/`runly.calls` son módulos core respaldados por Prisma, no RME3).

## 16. Navigation impact

N/A — ningún ítem de navegación nuevo. Todo vive dentro del modal ya existente.

## 17. Blueprint impact

N/A — sin blueprints nuevos ni modificados.

## 18. RBAC/permissions

Ningún permiso nuevo en el catálogo. Se reutilizan:

- `chat.calls.transcript.analyze` — gate de ruta existente, sin cambios (¿puede este usuario pedirle a MirAI que analice/confirme propuestas de esta transcripción?).
- `contacts.contacts.create` / `contacts.contacts.update` — **evaluados dentro del commit de contactos, no en la ruta HTTP**, exactamente el mismo patrón de dos capas que `assertProjectAccess` ya usa para tareas (permiso de ruta = "puedes usar esta función en general"; chequeo dentro del servicio = "tienes el permiso real, y con el alcance de la empresa correcta, para la acción específica que este ítem implica"). Implementación: `assertContactWriteAccess(profileId, companyId, action)` resuelve la membresía activa del usuario en `companyId` (nunca confiando en el companyId del token, siempre el de la transcripción) e invoca `computeScopedPermissions` (la misma función que ya usa el middleware HTTP real, `apps/api/src/lib/tenant-context.js`) para obtener `isCompanyAdmin`/`permissionSet`; requiere `isCompanyAdmin || permissionSet.has('contacts.contacts.' + action)`. Un usuario con acceso al análisis pero sin permiso de escritura en contactos simplemente ve esa propuesta específica rechazada (`skippedModuleProposals`), igual que hoy pasa con una tarea en un proyecto sin acceso.

## 19. Multi-company behavior

Este es el corazón del pedido del usuario ("según el tenancy... sin romper la barrera de empresas"), en dos capas:

1. **Al generar propuestas** (`analyzeTranscript`): antes de pedirle nada a Groq sobre contactos, se resuelve si `runly.contacts` está `INSTALLED` a nivel de instancia **y** habilitado para `transcript.companyId` específicamente (`CompanyModule`, vía `createCompanyModuleService`). Una empresa sin ese módulo (hipotético — contactos es core y siempre está instalado, pero el mecanismo debe funcionar igual para un módulo instalable real como finanzas) nunca ve esa sección del prompt ni de la respuesta.
2. **Al confirmar propuestas** (`commitProposals`): un `matchedContactId` que el cliente envíe de vuelta se revalida contra `transcript.companyId` dentro de `contacts-service.js` (`assertContactOwnership`, ya existente — nunca se confía en el ID tal cual). Esto cierra el mismo vector que `assertProjectAccess` ya cierra para tareas: alguien no puede, manipulando el body de la petición, hacer que se actualice un contacto de otra empresa.

## 20. Files/storage impact

N/A — ningún archivo/adjunto nuevo. Los contactos no tienen attachments en este flujo.

## 21. Export/import requirements

Extensión menor a lo ya existente: `transcriptAnalysisExport.js`'s `analysisToPlainText()` agrega una sección "Contactos propuestos" al texto copiado cuando `moduleProposals["runly.contacts"]` tiene contenido. Sin exportación a PDF/Excel nueva.

## 22. Audit log requirements

Se reutiliza el mismo `logAudit` que ya llama `commitProposals` para `chat.call_transcript.commit_proposals` — el payload `after` se extiende para incluir `moduleRecordIds: [{ moduleKey, recordId }]` junto a `taskIds`/`eventIds`, en la misma llamada (no una entrada de auditoría separada por módulo).

## 23. Edge cases

1. Groq propone un contacto sin nombre identificable (alucinación) → el descriptor de contactos filtra/descarta cualquier propuesta sin `name` no vacío antes de persistirla, mismo criterio que `normalizeDraft` ya aplica a `actionItems`.
2. Dos personas mencionadas con el mismo nombre en la misma llamada → cada una es una propuesta independiente por índice; si ambas hacen match con el mismo contacto existente, el usuario ve la misma sugerencia de "actualizar" dos veces y decide cuál (o ambas, o ninguna) aceptar — no se deduplican automáticamente entre sí.
3. El módulo de contactos deja de estar habilitado para la empresa *entre* que se generó el análisis (con la propuesta ya guardada) y que el usuario confirma → `commitProposals` revalida la disponibilidad del módulo en el momento del commit, no solo en el momento del análisis; si ya no está disponible, la propuesta se rechaza (`skippedModuleProposals`) con esa razón explícita.
4. `matchedContactId` de una propuesta apunta a un contacto que fue borrado entre el análisis y el commit → `assertContactOwnership` lo trata igual que hoy trata cualquier ID inexistente (404 interno → capturado y convertido en un ítem `skipped`, no un error que tumbe todo el commit).
5. Reanálisis (`handleAnalyze` de nuevo) sobre la misma transcripción → mismo criterio que ya aplica a `actionItems`/`proposedEvents`: el nuevo análisis reemplaza `moduleProposals` completo; cualquier selección de tipo de contacto que el usuario ya hubiera hecho en la UI para el análisis anterior se descarta (mismo comportamiento, mismo motivo, que el código ya documenta para `taskProjects`/`eventCalendars`).

## 24. Risks

1. **El schema de Groq crece con cada módulo habilitado** — para una empresa con muchos módulos con descriptor registrado, el prompt combinado podría volverse largo y potencialmente degradar la calidad de extracción de cada sección individual. Mitigación: por ahora solo hay un módulo piloto (contactos), impacto real nulo; si en el futuro se registran 4-5 descriptores, medir la calidad de extracción antes de asumir que sigue funcionando bien, y considerar migrar a llamadas separadas por módulo (arquitectura compatible, ver alternativas evaluadas en la conversación de diseño) si hace falta.
2. **Coincidencia de nombre para detectar "contacto existente" puede dar falsos positivos/negativos** — nombres comunes o mal transcritos (error de faster-whisper) pueden no encontrar una coincidencia real, o encontrar una incorrecta. Mitigación: el usuario siempre ve y confirma explícitamente antes de que se escriba nada (principio "IA propone, humano confirma" ya establecido en todo el sistema) — un falso positivo se descarta con un clic, nunca se aplica solo.
3. **`moduleProposals` como JSON libre sin validación de schema a nivel de base de datos** — un bug en el descriptor de un módulo podría escribir una forma inesperada. Mitigación: cada descriptor normaliza su propia porción antes de guardar (mismo principio que `normalizeDraft` ya aplica), y el commit nunca confía en la forma de `decision` del cliente sin revalidar contra lo que el propio análisis guardó server-side.

## 25. Acceptance criteria

1. Dado un análisis de una transcripción donde se menciona un nombre nuevo con un dato de contacto, cuando se genera el análisis, entonces `moduleProposals["runly.contacts"].proposed` contiene esa propuesta con `matchedContactId: null`.
2. Dado que el nombre mencionado coincide con un contacto ya existente en la misma empresa, cuando se genera el análisis, entonces esa propuesta trae `matchedContactId` con el ID real de ese contacto.
3. Dado que el usuario confirma una propuesta de tipo "crear", cuando llama a `commit-proposals` con el tipo elegido, entonces se crea un `Contact` real en `transcript.companyId`, nunca en otra empresa.
4. Dado que el usuario confirma una propuesta de tipo "actualizar" sobre un contacto que en realidad pertenece a otra empresa (manipulación del body), cuando se procesa el commit, entonces esa propuesta se rechaza (`skippedModuleProposals`) y ninguna otra empresa ve sus datos modificados.
5. Dado que `runly.contacts` no está habilitado para la empresa de la transcripción (caso hipotético de prueba, ya que en producción es core), cuando se genera el análisis, entonces Groq nunca recibe el fragmento de prompt de contactos y `moduleProposals` no incluye esa clave.
6. Dado un usuario sin permiso `contacts.contacts.create` ni `contacts.contacts.update` en esa empresa, cuando confirma una propuesta de contacto, entonces esa propuesta se rechaza con un motivo explícito, sin tumbar el resto del commit (tareas/eventos siguen procesándose normalmente).

## 26. Verification plan

- `node --test apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js` — tests nuevos para: registro/resolución de descriptores por tenancy, generación de propuestas de contacto con y sin coincidencia, commit exitoso, commit rechazado por empresa cruzada, commit rechazado por permiso insuficiente.
- `node --test` de cualquier archivo de test nuevo bajo `transcript-proposal-modules/`.
- `pnpm lint` limpio.
- `pnpm build:web` limpio (cambios de UI en `TranscriptAnalysisDialog.jsx`).
- `npx prisma validate` limpio tras la migración nueva.
- **No verificado en esta sesión** (mismo aviso que el resto de trabajo de IA de esta conversación): calidad real de extracción de Groq contra una transcripción real con un contacto mencionado — requiere una llamada real, no se puede simular con confianza desde este entorno.

## 27. Rollback plan

- La migración es puramente aditiva (una columna nullable) — revertir es un `DROP COLUMN` de bajo riesgo si hiciera falta, sin pérdida de datos de `actionItems`/`proposedEvents` que son columnas independientes.
- Si el registro de descriptores causara un problema en producción, se puede desactivar el efecto completo simplemente no registrando ningún descriptor (la orquestación ya tolera cero descriptores registrados — es exactamente el comportamiento actual, tareas/eventos sin cambios) sin necesidad de revertir código.

## 28. Future enhancements

1. Módulos adicionales con el mismo patrón: finanzas (`runly.ledger` — gasto/factura mencionada), inventario (`runly.fleet` — movimiento mencionado), y cualquier otro que el usuario pida ("más opciones de esa manera").
2. Edición inline de los campos detectados (hoy son de solo lectura, el usuario solo confirma o descarta).
3. Deduplicación entre propuestas del mismo análisis que apunten al mismo contacto real.
4. Si el prompt combinado crece demasiado con más módulos: evaluar migrar a una llamada de Groq por módulo en vez de una combinada (arquitectura ya compatible con el registro, ver Riesgo 1).
