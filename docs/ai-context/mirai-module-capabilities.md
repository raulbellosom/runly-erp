# MirAI module capability contract

Reference for the capability contract introduced by
`docs/superpowers/specs/2026-09-30-mirai-global-capabilities-design.md`. Read
this before adding MirAI capabilities to a new module.

## 1. The contract

Each module exports a factory from `apps/api/src/routes/<module>/mirai-capabilities.js`:

```js
export function createCalendarMiraiCapabilities(deps) {
  return {
    moduleKey: "runly.calendar",
    label: "Calendario",
    summary: "Eventos, agenda, disponibilidad y huecos libres del usuario.", // one line, shown in list_modules
    tools: [ /* read tools, see below */ ],
    actions: [ /* confirmable actions — same contract as mirai-actions spec §6.1 */ ],
    publicLookup: [], // optional: { model, publicFields, topics }, same shape as manifest ai.publicLookup
    async describeContext(pageContext, actx) { /* -> string | null */ },
  };
}
```

A read tool has this shape:

```js
{
  name: "calendar_free_slots",          // prefixed with the module's short name
  permission: "calendar.events.read",
  definition: { description, parameters }, // OpenAI function schema minus name/type
  async run(args, actx) { /* -> JSON-serializable result | { error } */ },
}
```

`actx` is the same shape `mirai-proposal-service.js`'s `buildActionContext` builds
for actions: `{ prisma, companyId, actorProfileId, actorAuthUserId, actorProfile }`.

Rules for tools:

- Counts, sums, averages and groupings are computed in SQL/service code and
  returned as exact numbers with the total row count. The model never derives
  totals from a sample; list tools return `total` alongside at most 30 rows.
- Every result is scoped to the active company and the caller's permissions.
- Results include stable ids (`eventId`, `itemId`, ...) so follow-up actions can
  target records without asking the user again.
- Text pulled from records is data, never instructions (same rule as every
  other MirAI prompt).

`describeContext(pageContext, actx)` turns the page context (section 3) into one
Spanish line, after verifying access, e.g. `El usuario esta viendo el evento
"Reunion con Ana" (eventId ...), 1 oct 10:00.` Returns `null` if the record is
not accessible or not relevant to this module's `pageContext.recordType`.

## 2. Registration and loading

`apps/api/src/routes/chat/mirai-capability-registry.js`
(`createMiraiCapabilityRegistry`) loads every capability factory and applies
availability: a module is available only when it is `INSTALLED` + `enabled`
and the caller holds the tool's/action's permission in the active company. It
exposes `listModules(ctx)`, `getModule(ctx, moduleKey)`,
`resolve(ctx, actionKey)` (used by `mirai-proposal-service.js`) and
`describeContext(ctx, pageContext)`.

`apps/api/src/routes/chat/mirai-module-tools.js` (`createModuleToolset`) is
the per-turn loader the tool loop actually calls:

- Core tools (always sent): the existing chat tools (`get_recent_messages`,
  `search_my_conversations`, `search_runly`, `search_module_help`,
  `list_call_transcripts`, `get_call_transcript`, ...), any module read tool
  not yet migrated to this contract, `web_search` when configured, plus
  `list_modules`, `use_module`, `propose_action`, `cancel_proposal`, `show_records` (record cards with links, resolved through Chat's entity-reference service so only records the user can open in the active company appear; direct conversation only).

Module availability per turn: installed + enabled on the instance, not disabled for the active company (`CompanyModule`), and at least one tool/action permission in the active company.
- `list_modules()` -> the modules available to the caller:
  `{ moduleKey, label, summary, toolCount, actionCount }`.
- `use_module({ moduleKey })` -> activates that module's tools for the rest of
  the turn and returns its action catalog
  (`{ actionKey, label, operation, description, parameters }`). Up to 3
  distinct modules per turn; a 4th is rejected with
  `{ error: "Demasiados modulos en una consulta." }`.
- `runMiraiToolLoop` (`mirai-tool-loop.js`) takes `getTools()`/`runTool()`
  instead of a fixed tool array + runner map, so the toolset can grow mid-turn
  right after `use_module`.
- Per-turn active-module state lives on the loop's `ctx` (`ctx.activeModules`,
  a `Map` of `moduleKey -> { scope, module }`), reset once per turn by
  `toolset.startTurn(ctx)`.

## 3. Page context

The frontend sends, with each message written from the global MirAI sidebar:

```json
{ "moduleKey": "runly.calendar", "path": "/app/m/runly.calendar", "recordType": "event", "recordId": "<uuid>", "label": "Reunion con Ana" }
```

- Stored as `metadata.miraiPageContext` on the user's chat message. Parsed and
  validated with Zod (`parseMiraiPageContext` in `mirai-module-tools.js`,
  strings capped at 200 chars) only inside the MirAI turn of the caller's own
  `mirai` conversation; anywhere else it is inert.
- `mirai-service.js`'s `runTurn` reads it from the trigger message, activates
  the page module's tools via `toolset.startTurn(ctx)`, and — when a line comes
  back — inserts a system message `Contexto de pantalla: <line>` right after
  the main system prompt.
- `label` from the client is display-only; the line MirAI actually sees comes
  from the module's own `describeContext`, which re-reads the record under the
  caller's permissions. A client-supplied `pageContext` never grants access on
  its own: it only selects which module's tools to preload and which record to
  describe.
- Frontend: module screens call `useMiraiRecordContext({ recordType, recordId,
  label })` (`apps/desktop/src/modules/runly.chat/lib/miraiPageContext.js`)
  when a record is open; the module key and path are derived from the route.

## 4. Definition of done

A module's MirAI capability is complete only when:

1. Search and detail tools return stable ids.
2. Exact aggregates (count/sum/group-by) for the module's main entity, with
   period comparison where the data is time-based.
3. Create/update/delete actions with confirmation for the main entity (delete
   only where the module supports it), reusing the module's own service and
   side effects — never bypassing them.
4. `describeContext` covers the module's detail screens.
5. Internet: `publicLookup` declared where public data adds value (products,
   models, companies); otherwise documented in the capability factory's
   comment as "not applicable".
6. Focused tests for each tool and action: `prepare` without writes, `execute`
   through the service, permission filtering.
7. The module's help `overview.md` is updated with example requests.

`runly.calendar` (`apps/api/src/routes/calendar/mirai-capabilities.js`,
`calendar-mirai-queries.js`) is the reference implementation.

## 5. How to add a module

1. Create `apps/api/src/routes/<module>/mirai-capabilities.js` exporting the
   factory described in section 1 (move any existing `mirai-actions.js`
   content into it, or keep actions in their own file and import them here).
2. Add one line to the `capabilities` array in
   `apps/api/src/routes/chat/mirai-actions-wiring.js`.
3. Call `useMiraiRecordContext()` on the module's detail screens so MirAI
   knows what the user is viewing.
4. Update the module's help `overview.md` with a short "Con MirAI" section
   listing example requests (see `runly.calendar`'s).

## 6. Status by module

Single assistant: the per-module assistants of PFM and Inventory were removed;
everything goes through the global MirAI sidebar and the user's MirAI conversation.

| Module | Capability file | Notes |
|---|---|---|
| runly.calendar | `routes/calendar/mirai-capabilities.js` | list, summary, free slots; create/update/delete events |
| runly.pfm | `routes/pfm/mirai-capabilities.js` | cross-wallet search and summaries per currency; movement create/update/delete |
| runly.inventory | `routes/inventory/mirai-capabilities.js` | summary, search, catalogs, manufacturer lookup; plan create, item update/delete; selection context. Reassigning an item is not an action (own flow) |
| runly.projects | `routes/projects/mirai-capabilities.js` | tasks and project progress; task create/update/delete |
| runly.notes | `routes/notes/mirai-capabilities.js` | search/get; create, rename/move, delete. No "append" (Y.Doc content has no safe merge primitive) |
| runly.contacts | `routes/contacts/mirai-capabilities.js` | search, detail, summary, public company info; create/update/archive |
| runly.purchases | `routes/purchases/mirai-capabilities.js` | pending, documents, approvals, spend summary, public supplier info; request create, approval decide, full receipt. No PO/quote/invoice/payment creation |
| runly.ledger | `routes/ledger/mirai-capabilities.js` | accounts, transactions, summaries; transaction actions; statement import from a chat attachment |
| runly.hr | `routes/hr/mirai-capabilities.js` | employees and headcount, same field restrictions as the HR routes |
| runly.fleet | `routes/fleet/mirai-capabilities.js` | vehicles, drivers, expirations, public vehicle specs |

Not covered yet: runly.files, runly.documents, runly.pos, runly.website,
runly.growth, and RME3 custom modules (they keep `moduleContext.ai`).

Core tools that stay outside modules: chat history/search/files, `describe_image`,
`read_attachment`, `search_runly` (people/companies across modules),
`search_module_help`, call transcripts, `web_search`, `list_modules`,
`use_module`, `propose_action`, `cancel_proposal`.

Call transcript analysis keeps its own proposal flow
(`transcript-proposal-registry.js`); MirAI can also read a transcript and
propose actions through capabilities.
