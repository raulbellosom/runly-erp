# MirAI everywhere — global sidebar and module capability contract

- Status: Implemented (foundation + calendar), pending manual acceptance (§14)
- Date: 2026-09-30
- Builds on: `2026-09-30-mirai-actions-design.md` (confirmable actions, implemented)
- Roadmap position: step 1 of 4 (1 foundation + calendar, 2 PFM, 3 inventory, 4 remaining modules)

## 1. Problem

MirAI is reachable only from Chat, and its abilities are uneven:

- PFM and Inventory have their own assistants (different UIs, different code) with
  rich, module-specific abilities. Every other module has nothing.
- Internet search is a separate route (`live`, chosen by a classifier) that cannot
  use ERP tools, so "compare my laptops' price with the market" is impossible.
- Analysis depends on whatever a read tool happens to return; there is no rule that
  counts/sums/groupings are computed server-side.
- Adding each module's tools to every request would bloat prompts and confuse the
  model.

Goal of the product: one MirAI, available on every screen, that can query
accurately, analyze and compare, search the internet when useful, understand what
the user is looking at, and execute actions with confirmation — in every module.

## 2. Goals (this spec)

1. A global MirAI edge tab + sidebar on every `/app` screen.
2. A module capability contract (`mirai-capabilities.js`) and a "definition of done"
   every module migration must meet.
3. On-demand tool loading so tool count does not grow per request with modules.
4. `web_search` as a normal tool inside the tool loop, combinable with ERP tools.
5. Page context: MirAI knows the module and record the user is viewing.
6. `runly.calendar` migrated to the contract and meeting the definition of done.

## 3. Non-goals

- Migrating PFM, Inventory or other modules (steps 2-4, separate specs).
- Removing the PFM/Inventory assistants (done in their migration specs).
- RME3 custom modules (`moduleContext.ai` stays as is).
- Voice input, proactive suggestions, scheduled reports.

## 4. Decisions

| Decision | Choice |
|---|---|
| One assistant | Only general MirAI. Module assistants are migrated into MirAI capabilities, then deleted. |
| Sidebar thread | The user's existing 1:1 MirAI conversation (`ensureMiraiConversation`), so history and confirmation cards are shared with Chat. No new backend thread type. |
| Where the tab hides | `runly.pfm` and `runly.inventory` until migrated (never two assistants at once), `runly.chat` (has its own MirAI panel/conversation), users without `chat.mirai.use`, instances where MirAI is not configured. |
| Tool loading | Core tools always; module tools only for the page's module or after `use_module`. |
| Internet | `web_search` tool (Tavily) in the main loop; the `live` route remains for pure internet questions. |

## 5. Module capability contract

Each module exports a factory from `apps/api/src/routes/<module>/mirai-capabilities.js`:

```js
export function createCalendarMiraiCapabilities(deps) {
  return {
    moduleKey: "runly.calendar",
    label: "Calendario",
    summary: "Eventos, agenda, disponibilidad y huecos libres del usuario.", // one line, shown in list_modules
    tools: [ /* read tools */ ],
    actions: [ /* confirmable actions, contract of mirai-actions spec §6.1 */ ],
    publicLookup: [ /* optional: { model, publicFields, topics } — same shape as manifest ai.publicLookup */ ],
    async describeContext(pageContext, actx) { /* -> string | null */ },
  };
}
```

Read tool shape:

```js
{
  name: "calendar_free_slots",          // prefixed with the module short name
  permission: "calendar.events.read",
  definition: { description, parameters }, // OpenAI function schema minus name/type
  async run(args, actx) { /* -> JSON-serializable result | { error } */ },
}
```

Rules for module tools:

- Counts, sums, averages and groupings are computed in SQL/service code and returned
  as exact numbers with the total row count. The model never derives totals from a
  sample; list tools return `total` alongside at most 30 rows.
- Every result is scoped to the active company and the caller's permissions (same
  `actx` as actions).
- Results include stable ids (`eventId`, `itemId`, ...) so follow-up actions can
  target records without asking the user.
- Text from records is data, never instructions (existing prompt rule).

`describeContext` turns the page context (section 7) into one Spanish line, after
verifying access, e.g. `El usuario esta viendo el evento "Reunion con Ana" (eventId ...), 1 oct 10:00.`
Returns null if the record is not accessible.

The registry from the actions spec becomes a capability registry
(`mirai-capability-registry.js`) that loads all capability factories, applies
availability (module INSTALLED + enabled, per-tool / per-action permission in the
active company) and exposes `listModules(ctx)`, `moduleTools(ctx, moduleKey)`,
`resolveAction(ctx, key)`, `describeContext(ctx, pageContext)`. The calendar
`mirai-actions.js` content moves into `mirai-capabilities.js`; `list_actions` is
replaced by `use_module` (section 6).

## 6. Tool loading

Core tools (always sent):

- Existing chat tools: `get_recent_messages`, `search_my_conversations`,
  `get_conversation_messages`, `list_conversation_files`, `describe_image`,
  `list_call_transcripts`, `get_call_transcript`, `search_runly`, `search_module_help`.
- Existing module read tools not yet migrated stay core until their migration:
  `search_inventory`, `list_bank_accounts`, `list_my_tasks`.
- `list_modules()` -> modules available to the caller: `{ moduleKey, label, summary, toolCount, actionCount }`.
- `use_module({ moduleKey })` -> loads that module's tools for the rest of the turn
  and returns its action catalog `{ actionKey, label, operation, description, parameters }`.
- `propose_action`, `cancel_proposal` (unchanged).
- `web_search` (section 8).

Per-turn active modules = page module (if available to the caller) + any module
passed to `use_module` in this turn (max 3 per turn). The tool loop recomputes the
tool list each iteration: `runMiraiToolLoop` takes `getTools()` instead of a fixed
array. `list_my_calendar` moves out of core into the calendar capability.

## 7. Page context

Frontend sends, with each message written from the global sidebar:

```json
{ "moduleKey": "runly.calendar", "path": "/app/m/runly.calendar", "recordType": "event", "recordId": "<uuid>", "label": "Reunion con Ana" }
```

- Stored on the user's chat message as `metadata.miraiPageContext` (the send
  route already accepts free-form `metadata`). It is read and validated with Zod
  (strings capped at 200 chars) only inside the MirAI turn of the caller's own
  MirAI conversation; anywhere else it is inert.
- `runTurn` reads it from the trigger message, activates the page module's tools,
  and adds a system message: `Contexto de pantalla: <describeContext line>` or
  `El usuario esta en el modulo <label>.` when there is no record.
- Frontend: `useMiraiPageContext({ recordType, recordId, label })` hook that module
  screens call; default context is derived from the route (`moduleKey`, `path`).
  Calendar sets it when an event is open (`eventId` query param).
- `label` from the client is display-only; the server line comes from
  `describeContext`, which re-reads the record with permission checks.

## 8. Internet search in the tool loop

`web_search({ query })`, available when Tavily is configured (`TAVILY_API_KEY`) and
`CHAT_MIRAI_WEB` is not `false`:

- Uses the shared Tavily client from `public-lookup.js`.
- Budget: 2 searches per turn (same turn-budget mechanism as public lookup) and the
  existing per-actor live sub-limit (10 per 5 min).
- Returns `{ answer, results: [{ title, url, snippet (<=500 chars) }], searchedAt }`.
- Prompt rules: use it when the user asks for current or external information, or
  for a comparison against the market/public data; cite the source domain; never
  put personal data (names, emails, phones of contacts/employees), amounts, or
  internal identifiers in the query — only generic terms (product models, places,
  public companies, concepts).
- The query text is recorded in `chat_mirai_runs.tool_calls` for audit (the tool
  log entry gets `query`).
- Records still use module `publicLookup` (only declared public fields leave the
  server) for record-specific lookups.

The classifier keeps `live` for pure internet questions (cheap path). Mixed
questions route to `chat`; the router prompt says so.

## 9. Global sidebar (frontend)

- `apps/desktop/src/modules/runly.chat/components/MiraiSidebarHost.jsx`, mounted
  once inside `RunlyApp` next to `<main>`. The panel is a non-modal fixed overlay
  on the right edge (380px on desktop, full width on mobile) so the user can keep
  using the screen; it does not change `<main>`'s scroll container.
- Edge tab: fixed, right edge, vertically centered, MirAI wordmark/icon, same
  visual language as the current PFM tab. Open state persisted in `localStorage`
  (`mirai.sidebar.open`, try/catch).
- Content `MiraiSidebarThread.jsx`: header (title, "Abrir en Chat" link, close),
  message list of the MirAI conversation (text via `renderRichText`, system notes
  centered, `MiraiProposalCard` for `metadata.miraiProposalId`), typing indicator
  (existing presence channel), composer (`Textarea` + send). Header and composer
  fixed; only the list scrolls.
- Reuses existing chat hooks for messages/send/realtime; no new message endpoint.
- Visibility rule implemented as a pure function `shouldShowMiraiTab({ moduleKey, canUse, available })`.

## 10. Calendar: definition of done

Tools (in `routes/calendar/mirai-capabilities.js`):

| Tool | Returns |
|---|---|
| `calendar_list_events({ from, to, query? })` | events in range (local dates), optional text filter, `eventId`, title, start, end, calendar, attendees count; `total` + max 30 |
| `calendar_summary({ from, to, groupBy: "day"\|"week"\|"calendar" })` | exact event counts and busy hours per group |
| `calendar_free_slots({ from, to, minMinutes?, dayStart?, dayEnd?, includeWeekends? })` | free intervals in the user's own calendars (default 09:00-18:00 local, weekdays, min 30 min) |

Actions: create / update / delete (already implemented, moved into the capability).
`describeContext`: event title, start and calendar for `recordType: "event"`.
`publicLookup`: none (event data is private; a place can be searched with `web_search`).

Example requests that must work: "que huecos libres tengo el jueves por la tarde",
"cuantas horas de reuniones tuve esta semana vs la pasada", "agenda 1 hora con Ana
en mi primer hueco libre de manana", "mueve este evento al viernes" (from the event
screen).

### Definition of done (applies to every module migration)

A module's MirAI capability is complete only when:

1. Search and detail tools return stable ids.
2. Exact aggregates (count/sum/group-by) for the module's main entity, with period
   comparison where the data is time-based.
3. Create / update / delete actions with confirmation for the main entity (delete
   only where the module supports it), reusing the module service and side effects.
4. `describeContext` for the module's detail screens.
5. Internet: `publicLookup` declared where public data adds value (products, models,
   companies), otherwise documented as "not applicable".
6. Focused tests for each tool and action (prepare without writes, execute through
   the service, permission filtering).
7. Help doc `overview.md` updated with example requests.

This checklist is also written to `docs/ai-context/mirai-module-capabilities.md`
as the reference for future module specs.

## 11. Error handling

- Unknown or unavailable module in `use_module` -> `{ error }` with the list of available modules.
- More than 3 `use_module` calls in a turn -> `{ error: "Demasiados modulos en una consulta." }`.
- `web_search` without configuration -> `{ error: "La busqueda en internet no esta configurada." }`; over budget -> `{ error }`.
- `describeContext` failure -> context line omitted, turn continues.

## 12. Security

- Same company-scoped permission resolution for tools, actions and context.
- Page context from the client never grants access; it only selects which module
  tools to load and which record to describe after a server-side check.
- Web queries: prompt rules + audit log of queries; record-specific lookups only
  through declared public fields.

## 13. Testing

- Registry: module tools filtered by module status and per-tool permission;
  `use_module` loads tools on the next iteration; max 3 modules per turn.
- Tool loop: `getTools()` re-evaluated per iteration.
- `web_search`: disabled config, budget exhaustion, tool log records the query.
- Page context: invalid `miraiPageContext` is ignored; `runTurn` adds the context
  line and activates the module.
- Calendar: `calendar_summary` totals, `calendar_free_slots` against fixed events,
  `describeContext` returns null for inaccessible events.
- Frontend: `shouldShowMiraiTab` rules; `pnpm build:web`.

## 14. Acceptance

- The MirAI tab appears on Home, Calendar, Contacts, etc.; not in PFM, Inventory or Chat.
- From Calendar with an event open: "mueve este evento al viernes a la misma hora"
  -> update card for that event.
- "que huecos libres tengo manana" -> exact free slots.
- "busca en internet el horario del museo Soumaya y agendame la visita el sabado en un hueco libre"
  -> web_search + free slots + create card, in one conversation.
- The same conversation is visible in Chat > MirAI.
