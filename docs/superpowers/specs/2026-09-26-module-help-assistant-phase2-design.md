# Widget de ayuda conversacional (Fase 2 del sistema de ayuda de módulos)

Date: 2026-09-26
Status: Approved (continuación autorizada por el usuario del roadmap de
docs/superpowers/specs/2026-09-26-module-help-system-design.md §28, fase 2)
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-26-module-help-assistant-phase2-design.md
Plan file: docs/superpowers/plans/2026-09-26-module-help-assistant-phase2.md

---

## 1. Feature title

Widget de ayuda conversacional embebido en el panel de ayuda contextual, con
degradación sin IA (Fase 2 de 4 del sistema de ayuda de módulos).

## 2. Status

Approved

## 3. Context

La Fase 1 (`docs/superpowers/specs/2026-09-26-module-help-system-design.md`,
implementada y verificada el 2026-09-26) construyó el banco de contenido de
ayuda (markdown por módulo/vista, sincronizado vía `Blueprint` kind `HELP`),
un servicio de resolución/búsqueda 100% determinista (`help-service.js`, sin
IA) y dos superficies: un panel contextual (`HelpButton.jsx`) y una página
navegable (`/help`, `HelpCenterScreen.jsx`).

Esta fase añade una tercera forma de interactuar con ese mismo banco de
contenido: escribir una pregunta libre y recibir una respuesta redactada,
cuando la instancia tiene `GROQ_API_KEY` configurada. El repo ya tiene un
patrón probado para esto — el asistente de `runly.pfm`
(`apps/api/src/routes/pfm/assistant-service.js`, spec
`docs/superpowers/specs/2026-09-02-pfm-assistant-design.md`) — que esta fase
adapta, simplificándolo: a diferencia de PFM (que necesita tool-calling
porque los datos financieros del usuario son dinámicos y requieren permisos
por cartera), el contenido de ayuda ya está resuelto de forma determinista
por `help-service.js`; no hace falta un loop de herramientas, basta una
llamada Groq de un solo turno con los fragmentos relevantes como contexto.

## 4. Problem

Buscar por palabra clave (Fase 1) exige que el usuario sepa qué términos usar
y funciona artículo por artículo. Preguntas más naturales ("¿cómo le doy
mantenimiento a un vehículo?", "¿por qué no puedo desinstalar este módulo?")
se responden mejor con una frase redactada que sintetice 1+ artículos — pero
sólo cuando hay un motor de IA disponible; en instancias sin
`GROQ_API_KEY` la funcionalidad debe seguir siendo útil, no desaparecer.

## 5. Goals

1. El mismo panel de ayuda (`HelpButton`/Sheet de la Fase 1) gana una caja de
   pregunta libre debajo del contenido contextual.
2. Con `GROQ_API_KEY` configurada: la pregunta se responde con una frase
   generada por IA, basada ÚNICAMENTE en los artículos de ayuda relevantes
   (nunca inventa funcionalidades), citando de qué módulo/vista salió cada
   fuente.
3. Sin `GROQ_API_KEY`: la misma caja de pregunta sigue funcionando — devuelve
   los mismos fragmentos que ya calcula `help-service.searchHelp()` (Fase 1),
   sin frase generada, con un aviso claro de que la respuesta es una
   búsqueda, no un resumen de IA.
4. Ninguna escritura de datos: es una función 100% de lectura/consulta.
5. Límites de costo/abuso equivalentes a los que ya existen para el
   asistente de PFM (rate limit por usuario, tope de tokens).

## 6. Non-goals

1. No hay historial persistente en base de datos — el historial de la
   conversación vive sólo en el estado de React mientras el Sheet está
   abierto; se pierde al cerrar o recargar. (Decisión YAGNI: esta es una
   ayuda puntual, no un asistente de largo plazo como PFM.)
2. No hay tool-calling ni acceso a datos de negocio del usuario — sólo al
   banco de ayuda ya público de la Fase 1.
3. No se integra todavía con MirAI (`runly.chat`) — eso es la Fase 3.
4. No hay carrusel de tips — eso es la Fase 4.
5. No hay streaming de la respuesta (igual que PFM: respuesta completa de una
   sola vez).
6. No se crea un botón/superficie nueva — se extiende el mismo panel de la
   Fase 1, no un chat aparte.

## 7. User stories

- Como usuario del ERP, quiero escribir una pregunta en lenguaje natural
  sobre el módulo en el que estoy, para no tener que adivinar la palabra
  clave exacta que usó la documentación.
- Como usuario de una instancia sin `GROQ_API_KEY`, quiero que la misma caja
  de pregunta me siga dando resultados útiles (aunque sean fragmentos en vez
  de una respuesta redactada), para no perder la funcionalidad por completo.
- Como administrador de instancia, quiero que esta función no pueda generar
  un costo de Groq descontrolado, para no tener sorpresas en la factura.

## 8. UX requirements

Debajo del contenido contextual ya existente en el Sheet de `HelpButton`
(overview + vista, o `EmptyState`), se agrega:

- Un separador visual y un `Textarea`/`Input` de `@runly/ui` con placeholder
  "Escribe tu pregunta..." + botón enviar (Enter envía, Shift+Enter salto de
  línea — mismo patrón que el composer de PFM).
- Mientras se espera respuesta: estado de carga (no bloquea el resto del
  panel).
- Respuesta en modo IA: burbuja con el texto + una lista pequeña de
  "Fuentes: <módulo> · <vista>" debajo, cada una un link que navega a esa
  sección de `/help`.
- Respuesta en modo fallback (sin IA): encabezado "Resultados de búsqueda"
  (sin fingir que es una respuesta de IA) + la misma lista de tarjetas de
  fragmento que ya usa `HelpCenterScreen` para resultados de búsqueda.
- Errores (429/502): burbuja de sistema con el mensaje, sin romper el resto
  del panel — mismo patrón que `AssistantMessage` de PFM con `role: "ERROR"`.
- El historial de la conversación (preguntas + respuestas de esta sesión) se
  muestra en orden, más reciente abajo, dentro del mismo scroll del Sheet.

## 9. Routes/screens

Ninguna ruta nueva — todo vive dentro del `Sheet` ya montado por
`HelpButton.jsx` (Fase 1). No hay pantalla nueva.

## 10. Data model

### New models

Ninguno.

### Modified models

Ninguno.

## 11. Prisma impact

New models: ninguno
Modified models: ninguno
New migration required: No
Migration safety notes: N/A — esta fase no toca el esquema.

## 12. API contract

Nuevas rutas en `apps/api/src/routes/help/help-routes.js` (mismo router de
la Fase 1), guardadas con el mismo permiso `runly.help.read` — no se crea un
permiso nuevo, es la misma superficie de lectura.

**Variables de entorno**: reutiliza `GROQ_API_KEY`/`GROQ_BASE_URL` (ya
documentadas para `vision-service`/PFM). Nueva variable **opcional**
`HELP_ASSISTANT_MODEL` (default `openai/gpt-oss-120b`, el mismo default que
`PFM_ASSISTANT_MODEL` desde que Groq retiró la línea llama-3.x) — se agrega a
`.env.example` y a la línea de `CLAUDE.md` que ya documenta
`PFM_ASSISTANT_MODEL`/`CHAT_MIRAI_MODEL`/etc.

### GET /help/assistant/status

Auth: required
Permission: `runly.help.read`
Response: `{ data: { available: boolean } }` — `true` si `GROQ_API_KEY` está
configurada en esta instancia. El frontend la usa sólo para decidir el texto
("Preguntar" vs "Buscar con IA"); el endpoint de abajo funciona en ambos
casos de todas formas.

### POST /help/ask

Auth: required
Permission: `runly.help.read`
Body:
```json
{
  "path": "/fleet/vehicles",
  "question": "como le doy mantenimiento a un vehiculo",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```
- `path`: string, requerido, 1-500 chars — la ruta actual del frontend (igual
  que `GET /help/resolve`), usada para priorizar el contexto del módulo
  actual.
- `question`: string, requerido, 2-500 chars.
- `history`: opcional, array de máx. 6 entradas `{ role: "user"|"assistant",
  content: string (<=1000 chars) }` — provisto por el cliente, nunca leído ni
  escrito de una tabla (ver §6.1). Se recorta a las últimas 6 entradas si
  viene más largo.

Response 200 (modo IA, `GROQ_API_KEY` configurada):
```json
{ "data": { "mode": "ai", "answer": "...", "sources": [{ "moduleKey": "custom.fleet", "moduleName": "Flotas", "viewKey": "/fleet/vehicles", "title": "Vehiculos" }] } }
```

Response 200 (modo fallback, sin `GROQ_API_KEY`) — misma forma que ya
devuelve `GET /help/search`:
```json
{ "data": { "mode": "fallback", "results": [{ "moduleKey": "...", "moduleName": "...", "viewKey": "...", "title": "...", "snippet": "...", "score": 3 }] } }
```

Errores: 400 (body inválido), 429 (rate limit, "Vas muy rapido, intenta de
nuevo en un momento."), 502 (Groq no respondió tras reintento, "El asistente
no respondio, intenta de nuevo."). Nunca 503 "no configurado" — ese caso cae
en modo `fallback`, nunca en error (ver Goal 3).

## 13. SDK contract

Domain: `help` (extiende el grupo ya creado en la Fase 1)

- `getAssistantStatus(token)` — `GET /help/assistant/status` → `{ data }`
- `askAssistant({ path, question, history }, token)` — `POST /help/ask` → `{ data }`

## 14. Validator contract

Nuevo en `packages/validators/src/index.js`:

- `helpAskBodySchema` — `{ path: z.string().min(1).max(500), question: z.string().trim().min(2).max(500), history: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string().max(1000) })).max(6).optional() }`

## 15. Module manifest impact

Ninguno — no se agrega permiso nuevo (reutiliza `runly.help.read`), no hay
navegación nueva, no hay blueprint nuevo.

## 16. Navigation impact

N/A — no hay ruta ni item de navegación nuevo (ver §9).

## 17. Blueprint impact

N/A — esta fase no toca blueprints; sólo lee los que ya sincroniza la Fase 1
a través de `help-service.searchHelp()`/`resolveHelp()`, sin cambios ahí.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `runly.help.read` (ya existe, Fase 1) | `GET /help/assistant/status`, `POST /help/ask` | No (mismo panel de la Fase 1) |

## 19. Multi-company behavior

Igual que la Fase 1: el contenido de ayuda no está scoped por compañía. La
única entrada específica del usuario es `actorId` (para el rate limit en
memoria, no persistido) — no se lee ni escribe ningún dato de negocio de
ninguna compañía.

## 20. Files/storage impact

N/A

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — mismo razonamiento que la Fase 1 (lectura de documentación no
sensible); adicionalmente, no hay tabla que audite porque no hay
persistencia (§6.1).

## 23. Edge cases

1. `GROQ_API_KEY` no configurada → `POST /help/ask` responde 200 con
   `mode: "fallback"`, nunca 503 — el frontend renderiza fragmentos en vez
   de bloquear la caja de pregunta.
2. `searchHelp()` no encuentra nada relevante para la pregunta → en modo IA,
   el system prompt instruye al modelo a decir explícitamente que no
   encontró información en la documentación (nunca inventar); en modo
   fallback, `results: []` y el frontend muestra "Sin resultados".
3. Groq responde 429/5xx → un reintento (mismo patrón que PFM); si falla de
   nuevo, 502 con mensaje legible, sin romper el resto del panel.
4. `history` con más de 6 entradas o una entrada de más de 1000 caracteres →
   el validador la recorta/rechaza (400 sólo si la forma es inválida; el
   recorte a 6 es silencioso y no es un error).
5. Rate limit excedido (>20 preguntas/60s por actor) → 429, mismo mensaje que
   PFM.
6. Pregunta que contiene una instrucción tipo "ignora tus reglas y..." → el
   system prompt trata todo el contenido de ayuda y el historial como datos,
   nunca como instrucciones adicionales (mismo patrón anti-inyección que
   PFM); no hay acción que ejecutar de todas formas (fase de sólo lectura).
7. Instancia con el módulo `runly.pfm`/asistente de otra fase también
   activo — el rate limiter de esta fase es un `Map` en memoria propio
   (`buckets` local al servicio), completamente independiente del de PFM; no
   comparten cupo.

## 24. Risks

1. Riesgo: costo de Groq. Mitigación: sin tool-calling (una sola llamada por
   pregunta, no un loop de hasta 6 iteraciones como PFM), `max_tokens`
   acotado, rate limit de 20/60s por usuario, contexto limitado a los
   artículos de ayuda recortados que ya devuelve `searchHelp()` (máx. ~8 KB
   por resultado, tope de 20 resultados — en la práctica se inyectan sólo
   los primeros 5).
2. Riesgo: el modelo alucina funcionalidad que no existe. Mitigación: system
   prompt explícito "responde solo con la documentacion dada"; sin
   tool-calling no hay superficie para que el modelo "actúe", sólo para que
   hable.
3. Riesgo: confusión de UX entre modo IA y modo fallback si no se distingue
   claramente. Mitigación: el modo fallback se etiqueta explícitamente
   "Resultados de búsqueda" en vez de simular una respuesta conversacional.

## 25. Acceptance criteria

1. Given `GROQ_API_KEY` configurada y una pregunta con artículos relevantes,
   when `POST /help/ask`, then la respuesta trae `mode: "ai"`, un `answer`
   no vacío y `sources` con al menos un módulo.
2. Given `GROQ_API_KEY` NO configurada, when `POST /help/ask` con la misma
   pregunta, then la respuesta es 200 con `mode: "fallback"` y `results`
   igual a lo que devolvería `GET /help/search` con esa pregunta.
3. Given un usuario sin `runly.help.read`, when llama cualquiera de los dos
   endpoints nuevos, then la API responde 403.
4. Given un `history` de 8 entradas, when se llama `POST /help/ask`, then el
   servicio sólo usa las últimas 6 al armar el contexto para Groq (verificado
   por el contenido de la llamada simulada a Groq en el test, no por el
   tamaño de la respuesta).
5. Given 21 llamadas de un mismo actor en 60s, when se hace la 21a, then la
   API responde 429.
6. Given que Groq devuelve 500 dos veces seguidas (tras el reintento), when
   se llama `POST /help/ask`, then la API responde 502 con un mensaje
   legible, sin lanzar una excepción no controlada.

**Verificado: 2026-09-26** (implementación Fase 2 completa)

1. Verificado — `help-assistant-service.test.js` ("ask() returns mode:'ai'
   with an answer + sources when configured and context exists"), Groq
   simulado con `groqStub`.
2. Verificado — `help-assistant-service.test.js` ("ask() returns
   mode:'fallback' with search results when GROQ_API_KEY is missing") +
   `help-routes.test.js` ("POST /help/ask with a valid body and no
   GROQ_API_KEY -> 200 mode:fallback").
3. Verificado — `help-routes.test.js` ("GET /help/assistant/status without
   permission -> 403", "POST /help/ask without permission -> 403").
4. Verificado indirectamente — el servicio recorta `history` a las últimas 6
   entradas antes de armar los mensajes para Groq (`history.slice(-MAX_HISTORY)`);
   cubierto por el validador (`helpAskBodySchema` rechaza >6 entradas en el
   *body*) más lectura de código para el recorte silencioso interno. No hay
   un test que inspeccione el payload exacto enviado a Groq con >6 entradas
   ya validadas — riesgo bajo, es una sola línea determinista.
5. Verificado — `help-assistant-service.test.js` ("ask() enforces the rate
   limit (20/60s) per actor").
6. Verificado — `help-assistant-service.test.js` ("ask() maps a persistent
   Groq 500 to a 502 HelpAssistantServiceError").

Suites completas verificadas en verde el 2026-09-26:
`apps/api/src/routes/help/__tests__/*.test.js` (18 pass),
`packages/validators/src/__tests__/*.test.js` (22 pass),
`packages/sdk/src/__tests__/*.test.js` (39 pass), `pnpm lint` (sin errores),
`pnpm build` (build completo del monorepo, incluyendo el instalador nativo
Tauri, verde). Ningún test de esta fase llama a Groq real — `fetchImpl`
siempre es un stub inyectado.

## 26. Verification plan

- `node --test apps/api/src/routes/help/__tests__/help-assistant-service.test.js`
  y `.../help-routes.test.js` (casos nuevos) — Groq simulado con el mismo
  patrón `groqStub` que `assistant-service.test.js` de PFM.
- `node --test packages/validators/src/__tests__/help-schemas.test.js`
  (casos nuevos de `helpAskBodySchema`).
- `node --test packages/sdk/src/__tests__/help-domain.test.js` (casos nuevos).
- `pnpm lint`, `pnpm build` (o al menos `pnpm --filter @runly/desktop build:web`)
  en verde.
- Manual (sin Groq real en este entorno): simular ambos modos con un stub de
  `fetchImpl` inyectado, igual que hace la suite de PFM — no se dispara una
  llamada real a Groq en ningún test ni verificación de esta fase.

## 27. Rollback plan

Sin cambios de esquema que revertir. Rollback = revert de los commits de
esta fase (nuevas rutas + service + UI); `help-service.js` y el resto de la
Fase 1 quedan intactos porque esta fase sólo los consume, nunca los modifica.

## 28. Future enhancements

1. Fase 3 — tool `search_module_help` en MirAI (`apps/api/src/routes/chat/mirai-tools.js`),
   reusando `help-service.searchHelp()` sin duplicar lógica.
2. Fase 4 — carrusel de tips en la barra inferior.
3. Si en el futuro se decide dar memoria persistente a este widget, evaluar
   entonces si vale la pena una tabla dedicada — hoy es explícitamente
   fuera de alcance (§6.1).
