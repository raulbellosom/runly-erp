# Module AI capability: shared public lookup + reusable assistant panel

Status: draft (2026-09-28)
Related: `2026-09-26-unified-ai-provider-router-design.md`

## 1. Problem

- Internet search (Tavily) is only reachable from two places: the chat MirAI
  `live` route and a hand-wired `inventory_public_model` tool in
  `apps/api/src/services/inventory-assistant-service.js`. Every other module
  (PFM, help, and all RME3 custom modules such as fleet/dispatch) cannot look
  anything up on the internet.
- RME3 custom modules have no AI access at all: the Route Loader's
  `moduleContext` exposes `notifications`, `files`, `relations` and `cleanup`,
  but no MirAI/tool-loop capability.
- The inventory lookup query was built from brand + model only; the entity
  type/category (and any other descriptive attribute) was not sent.
- The only assistant panel UI (`InventoryAssistant.jsx`) is inventory-specific
  and shows the conversation list stacked above the active chat, which wastes
  vertical space.

## 2. Goals

1. One shared, privacy-safe public lookup implementation, usable by any
   module (core or RME3) as an AI tool.
2. The lookup query is built from module-declared descriptive fields
   (type, brand, model, year, version...), never from free text the model
   invents and never from identifying data.
3. RME3 modules get `moduleContext.ai` (tool-loop + public lookup) with no
   core edits per module.
4. A reusable `ModuleAssistantPanel` in `@runly/ui` with ChatGPT-style
   navigation: a full-height conversation list, and entering a conversation
   replaces the list with the chat plus a back button.
5. Inventory migrates onto both (no duplicate implementation left behind).

## 3. Non-goals

- No change to the chat MirAI `chat | general | live` classifier.
- No free-form "search anything" tool for modules. Lookups are always about
  a record's public, descriptive attributes.
- No new env vars. Availability follows the existing rules: `GROQ_API_KEY`
  + `TAVILY_API_KEY`, disabled by `CHAT_MIRAI_WEB=false`.
- No local (Ollama) web search; lookup stays Groq/Tavily like `mirai_web`.

## 4. Design

### 4.1 Shared service: `apps/api/src/services/ai/public-lookup.js`

```js
createPublicLookup({ env, fetchImpl }) -> {
  enabled: boolean,
  // subject: ordered descriptive values, e.g. { type: 'Laptop', brand: 'Asus', model: 'TUF 15' }
  // topic: optional short hint, e.g. 'especificaciones fabricante' | 'ficha tecnica'
  lookup({ subject, topic }) -> { origin: 'external', warning, query, sources: [{ title, url, content }] }
  toolDefinition({ name, description }) -> OpenAI-style tool def with params { id, topic? }
}
```

- Moves `tavilySearch` out of `mirai-service.js`; the chat `live` route and
  this service share it (single Tavily client).
- Query = non-empty subject values in declared order + topic, each value
  length-capped, total capped at 400 chars.
- Output normalization (max 5 sources, http(s) URLs only, content capped at
  1000 chars, `origin: 'external'`, "general model characteristics, do not
  verify this unit" warning) is the same as today's inventory tool.
- Per-turn budget: max 2 lookups per assistant turn (enforced by a
  `createTurnBudget()` helper the tool loop instantiates per turn).

### 4.2 Privacy contract

- The tool accepts only a record `id` (+ optional topic from a fixed enum).
  The model never supplies the query text.
- The module resolves the record server-side, applying its normal
  authorization/context scope, and passes only the fields it declared as
  `publicFields`.
- Identifying fields (serial, asset tag, plate, VIN, owner, location, notes,
  company data) must not be listed in `publicFields`; the manifest validator
  rejects field keys that match a denylist (`serial*`, `assetTag`, `plate*`,
  `vin`, `owner*`, `email`, `phone`, `notes`) unless the module sets an
  explicit `allowIdentifying: true` (not recommended, logged).
- Every lookup writes an `AuditLog` row (`action: '<moduleKey>.ai.public_lookup'`,
  metadata: record id + query string).

### 4.3 RME3 capability: `moduleContext.ai`

The Route Loader receives an `aiCapability(moduleKey)` factory (same pattern
as `filesCapability`) and exposes:

```js
moduleContext.ai = {
  enabled,                      // GROQ configured
  publicLookupEnabled,          // enabled && Tavily configured && web not killed
  answerWithTools({ messages, tools, executeTool, actorProfileId, finishAfterTools }),
  publicLookup: { lookup, toolDefinition, createTurnBudget },
} | null
```

Manifest declaration (optional; enables the lookup tool for an entity):

```js
ai: {
  publicLookup: [
    { model: 'vehicles', publicFields: ['make', 'model', 'year', 'version'], topics: ['ficha tecnica', 'mantenimiento'] },
  ],
}
```

`toolDefinition` uses the declaration to describe the tool. The module's own
`executeTool` resolves the record with `prisma.$queryRaw` (RME3 rule) and
calls `lookup({ subject: pick(record, publicFields), topic })`.

### 4.4 Shared prompt rule

A constant exported from `public-lookup.js` and appended by every assistant
that exposes the tool:

> Only call the lookup tool when the user explicitly asks to search the
> internet or for public/manufacturer information. When a value is missing
> from the record and the user did not ask for a search, say so and offer to
> look it up online; never search on your own initiative. When asked, call
> the tool directly with the record id from context; don't ask for
> identifiers, and never mention tool names or internal ids in the answer.
> Label external data as general model information.

Searching is always user-initiated: a request like "búscalo en internet" or
"sí, búscalo" (answering the offer) triggers it; a plain question about the
record never does.

### 4.5 Inventory migration

- `inventory_public_model` executes via `publicLookup.lookup` with subject
  `{ type: category.name, brand: brand.name, model }` and the shared prompt
  rule; the inline Tavily call and ad-hoc budget are removed.
- `createMiraiService` no longer exposes `searchPublicModel`.

### 4.6 UI: `ModuleAssistantPanel` (`@runly/ui`)

- Two views inside the existing `Sheet`:
  - **List view**: header (wordmark, subtitle, close), "Nueva consulta"
    button, full-height scrollable conversation list with delete
    (`ConfirmDialog`), `EmptyState` when empty.
  - **Chat view**: header with back arrow + conversation title + close; the
    context chip moves into the header's second line; the thread scrolls,
    the composer is fixed (modal structure rule: header/footer fixed, only
    the middle scrolls).
- Opening the panel goes straight into the most recent conversation if one
  was active in this session; otherwise the list view.
- Props: `title`, `subtitle`, `conversations`, `activeId`, `onSelect`,
  `onNew`, `onDelete`, `contextLabel`, `renderThread`, `composer`. Data
  fetching stays in the module.
- `InventoryAssistant.jsx` is rewritten on top of it. Documented in
  `docs/ai-context/rme3-runtime-capabilities.md`.

## 5. Edge cases

- Tavily missing or web killed: the tool is not offered (not just erroring),
  and the prompt rule is omitted; the assistant says it can't look it up.
- Record lacks every public field: tool returns an error message and the
  model explains which data is missing.
- Tavily timeout/error: tool returns `{ error }`; the turn still completes.
- Record outside the assistant's context scope: same "not available" error
  as today.

## 6. Testing (lean)

- `public-lookup.test.js`: query built from ordered subject + topic, caps,
  source normalization, budget of 2, disabled when no Tavily key.
- Manifest validator: denylisted `publicFields` rejected.
- Inventory assistant test: lookup query includes category/brand/model;
  serial never present in the query.
- Route loader test: `moduleContext.ai` present and bound to module key.
- UI: `pnpm build:web` + manual check of list/chat/back navigation.

## 7. Rollout

1. Shared service + chat `live` reuse + inventory migration.
2. `moduleContext.ai` + manifest validation + docs.
3. `ModuleAssistantPanel` + inventory panel rewrite.
