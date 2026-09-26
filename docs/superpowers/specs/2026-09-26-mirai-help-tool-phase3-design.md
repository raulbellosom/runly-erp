# MirAI tool: search_module_help (Fase 3 del sistema de ayuda de módulos)

Date: 2026-09-26
Status: Approved (continuación autorizada por el usuario del roadmap de
docs/superpowers/specs/2026-09-26-module-help-system-design.md §28, fase 3)
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-26-mirai-help-tool-phase3-design.md
Plan file: (combinado en este mismo documento — cambio de un solo archivo,
sin datos nuevos, sin endpoints nuevos; ver "Plan de implementación" abajo)

## Contexto y alcance

Las Fases 1-2 (implementadas y verificadas el 2026-09-26) dieron a los
usuarios dos formas de consultar el banco de ayuda: el panel contextual +
página `/help` (Fase 1) y una caja de pregunta libre con degradación sin IA
dentro de ese mismo panel (Fase 2). Esta fase, mucho más pequeña, le da al
asistente general ya existente (`runly.chat` MirAI,
`apps/api/src/routes/chat/mirai-tools.js`) la misma capacidad de búsqueda,
para que un usuario que ya está conversando con MirAI por cualquier otro
motivo pueda también preguntarle "¿cómo funciona el módulo de flotas?" sin
tener que abrir el panel de ayuda.

**No es una fase nueva de infraestructura**: reutiliza `help-service.js`
(Fase 1) tal cual, sin tocarlo. Es una única tool nueva, de solo lectura, en
un archivo que ya define 12 tools con el mismo patrón (`TOOL_DEFS` +
`buildToolRunners`). No requiere permiso nuevo (MirAI ya opera con el
contexto del usuario que lo invoca, y `runly.help.read` es una permission
base que todo usuario ya tiene) ni scoping por compañía (el contenido de
ayuda es de instancia, no de compañía — igual que en la Fase 1).

## Goals

1. MirAI puede responder preguntas de "cómo funciona X módulo" citando el
   contenido real de la documentación de ayuda, sin inventar.
2. Cero duplicación: la tool llama a `help-service.searchHelp()`, la misma
   función que ya usan `GET /help/search` (Fase 1) y `POST /help/ask`
   (Fase 2).
3. Si MirAI está deshabilitado (sin `GROQ_API_KEY`) esto no aplica —
   coherente con que todo `runly.chat` ya está deshabilitado sin la key;
   esta tool no introduce ningún nuevo requisito de configuración.

## Non-goals

1. No se le da a MirAI acceso a `resolveHelp`/contenido por-vista — sólo
   búsqueda por palabra clave (`search_module_help`), que ya cubre el caso
   de uso conversacional. `resolveHelp` depende de "en qué pantalla está el
   usuario ahora mismo", un concepto que no existe en una conversación de
   chat (a diferencia del panel embebido en la propia pantalla).
2. No se cambia el prompt general de MirAI más allá de que el modelo ahora
   ve esta tool en su lista — no hay instrucciones especiales nuevas en el
   system prompt (la descripción de la tool ya le dice cuándo usarla).

## Diseño

**Archivo modificado**: `apps/api/src/routes/chat/mirai-tools.js` (único
archivo tocado).

- Nueva entrada en `TOOL_DEFS`:
  ```js
  {
    type: "function",
    function: {
      name: "search_module_help",
      description: "Busca en la documentacion de ayuda de los modulos de Runly (que es cada modulo, para que sirve, como se usa cada pantalla, limites y alcances). Usalo cuando el usuario pregunta como funciona el ERP o un modulo especifico. NO uses esto para datos de negocio (contactos, inventario, cuentas, etc.) — para eso estan search_runly/search_inventory/list_bank_accounts.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Palabras clave sobre que modulo o funcionalidad quiere entender el usuario." } },
        required: ["query"],
      },
    },
  },
  ```
- Nuevo runner dentro de `buildToolRunners`, construido a partir de
  `createHelpService({ prisma })` (mismo `prisma` que ya recibe
  `buildToolRunners`):
  ```js
  async function search_module_help(args) {
    const q = String(args?.query ?? "").trim();
    if (q.length < 2) return { error: "Da al menos 2 caracteres para buscar en la ayuda." };
    const results = await helpService.searchHelp(q);
    if (!results.length) return { note: "No encontre ayuda sobre eso en la documentacion de los modulos." };
    return {
      resultados: results.slice(0, 5).map((r) => ({
        modulo: r.moduleName,
        titulo: r.title,
        fragmento: r.snippet,
      })),
    };
  }
  ```
- Se agrega `search_module_help` al objeto final que retorna
  `buildToolRunners`.
- Import nuevo: `import { createHelpService } from "../../services/help-service.js";`

**Por qué sin scoping de compañía/permiso**: a diferencia de `search_runly`
(datos de negocio, requiere permiso por proveedor) o `search_inventory`
(requiere `inventory.item.read`), el banco de ayuda ya es legible por
cualquier usuario autenticado (Fase 1 §18/19) — no hay nada que gatear aquí
más allá de que el propio MirAI ya requiere que el usuario tenga acceso al
chat.

## Riesgos

1. Riesgo: el modelo usa esta tool quirúrgicamente mal (para preguntas de
   negocio). Mitigación: la descripción de la tool incluye explícitamente
   "NO uses esto para datos de negocio... para eso estan search_runly/...".
2. Riesgo: ninguno de infraestructura — no hay escritura, no hay dato
   nuevo, no hay tabla nueva; el único cambio es un archivo ya bien cubierto
   por tests.

## Plan de implementación

**Archivos:**
- Modify: `apps/api/src/routes/chat/mirai-tools.js`
- Modify: `apps/api/src/routes/chat/__tests__/mirai-tools.test.js`

1. Actualizar el test `"TOOL_DEFS lists every read tool with JSON schemas"`
   para incluir `"search_module_help"` en la lista ordenada esperada.
2. Escribir un test nuevo `"search_module_help: searches the Fase 1 help
   bank and maps rows to the safe shape"` con un `prisma` fake mínimo
   (`{ blueprint: { findMany }, runlyModule: { findMany, findFirst } }`,
   mismo patrón que `apps/api/src/services/__tests__/help-service.test.js`)
   que devuelva al menos un `Blueprint` `kind: "HELP"`.
3. Escribir un test `"search_module_help: rejects a 1-char query"` y otro
   `"search_module_help: returns a note when nothing matches"`.
4. Correr los tests, confirmar que fallan (`search_module_help` no existe
   todavía).
5. Implementar el tool def + runner + import + entrada en el `return {}`
   final, exactamente como en la sección "Diseño" arriba.
6. Correr los tests, confirmar que pasan.
7. Correr `node --test apps/api/src/routes/chat/__tests__/mirai-tools.test.js`
   completo (no sólo los casos nuevos) para confirmar cero regresión en los
   otros 11 tools ya cubiertos ahí.
8. `pnpm lint` + `pnpm build`.
9. Commit.

## Acceptance criteria

1. Given una pregunta que matchea contenido de ayuda ya sincronizado
   (`runly.core`), when se llama `runners.search_module_help({ query: "modulos" })`,
   then la respuesta trae `resultados` con al menos una entrada con
   `modulo`, `titulo` y `fragmento`.
2. Given una query de 1 carácter, when se llama la tool, then devuelve
   `{ error: ... }` sin tocar `help-service`.
3. Given una query que no matchea nada, when se llama la tool, then
   devuelve `{ note: ... }`, nunca un arreglo vacío sin contexto.
4. `TOOL_DEFS` sigue teniendo exactamente 13 tools (12 + esta), y el test de
   nombres pasa.

## Verification plan

- `node --test apps/api/src/routes/chat/__tests__/mirai-tools.test.js`
  (todos los tests del archivo, no sólo los nuevos).
- `pnpm lint`, `pnpm build`.
