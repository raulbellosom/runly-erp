# Module Services v2 — custom modules create and update records in system modules

Status: approved (autonomous decision, 2026-10-04)
Builds on: `2026-10-03-rme3-module-platform-v2-design.md` §10.7 (services gateway, plan Task 6.1)

## 1. Problem

RME3 custom modules can read some system data and create a contact or a task
through the services gateway (`consumes` + `moduleContext.services`), but they
cannot:

- create or change calendar events,
- save a file into the user's Files (runly.files) explorer,
- update a contact, an inventory item or a project task,
- send a notification through a contract the Developer Hub can simulate
  (`moduleContext.notifications` exists but is outside the service contract).

The Developer Hub (`../runly-developer-hub`) simulates "the seven current
services" in memory from `@runly/module-engine/contracts`, which today only
exposes service **keys**. It has no argument/return shapes to simulate against,
so every new service would be guesswork there.

## 2. Goals

1. Add create/update services for calendar, files, notifications, contacts,
   inventory and projects. Custom modules never touch system tables or their
   structure; every write goes through the owning module's service code.
2. Publish a declarative, browser-safe **service contract** (label, permission,
   mutates, args schema, return fields, ownership scope) in
   `@runly/module-engine/contracts` that both the ERP gateway and the Hub use.
3. The gateway validates and strips arguments against that contract before any
   handler runs (only declared fields reach the system module).
4. Every record a module creates carries its origin (`moduleKey` +
   `sourceEntityId`) where the system model already has a place for it.

## 3. Non-goals (phase 2)

- System context (`services.forSystem`) for `api/events.js` handlers and
  scheduled jobs; idempotency keys for at-least-once delivery.
- New domain events (`calendar.event.*`, `files.file.*`).
- Deleting system records (only cancelling calendar events the module created).
- Builder no-code automations on top of these services.
- Ledger/POS/HR write services.

## 4. Design

### 4.1 Contract (`packages/module-engine/src/contracts.js`)

```js
SERVICE_CONTRACTS = {
  'runly.calendar:events.create': {
    label, permission: 'calendar.events.create', mutates: true, scope: 'any' | 'own',
    args: { title: { type: 'string', required: true, max: 200 }, startAt: { type: 'datetime', required: true }, ... },
    returns: ['id', 'title', 'startAt', ...],
  },
}
SERVICE_KEYS = Object.keys(SERVICE_CONTRACTS)  // kept for existing consumers
validateServiceArgs(serviceKey, args) -> { ok, value, errors }
```

Arg types: `uuid`, `string`, `text`, `email`, `datetime`, `date`, `boolean`,
`integer`, `enum` (`values`), `uuid[]`, `integer[]`, `base64` (`max` in bytes
decoded). Unknown keys are dropped; `null` clears an optional field on update
services. `permission: null` means any member of the active company.

`scope: 'own'` means the service only acts on records this module created
(origin match); out-of-scope records answer 404, never 403, so a module cannot
probe for foreign ids.

### 4.2 New services

| Key | Permission | Scope |
|---|---|---|
| `runly.calendar:calendars.list` | `calendar.events.read` | calendars the user can write to |
| `runly.calendar:events.list({ from, to, sourceEntityId? })` | `calendar.events.read` | own |
| `runly.calendar:events.create({ calendarId?, title, description, startAt, endAt, allDay, location, attendeeIds, reminderMinutes, sourceEntityId })` | `calendar.events.create` | default calendar when `calendarId` is omitted |
| `runly.calendar:events.update({ id, ... })` | `calendar.events.update` | own |
| `runly.calendar:events.cancel({ id })` | `calendar.events.update` | own (soft delete) |
| `runly.files:files.save({ name, mimeType, contentBase64, shareWithCompany, sourceEntityId })` | `files.assets.create` | saved in the user's Files, 10 MB, same MIME allowlist |
| `runly.files:files.signedUrl({ id })` | `files.assets.read` | own |
| `runly.notifications:notifications.send({ userIds, title, body, link, priority, sourceEntityId })` | none (company member) | recipients filtered to company members; `eventType = module.<moduleKey>` |
| `runly.contacts:contacts.update({ id, name, type, email, phone })` | `contacts.contacts.update` | any company contact |
| `runly.inventory:items.update({ id, name, description, status, locationId, notes })` | `inventory.item.update` | any company item |
| `runly.projects:tasks.update({ id, title, description, statusId, assigneeId, dueDate, priority })` | `projects.task.update` | any task of a company project |

Origin storage (no schema change):
- calendar: `CalendarEvent.sourceModule = moduleKey`, `sourceEntityId`;
- files: `FileAsset.metadata.source = { moduleKey, sourceEntityId }`;
- notifications: `sourceType = moduleKey`, `sourceId = sourceEntityId`;
- contacts/items/tasks: the gateway audit row (`metadata.caller`).

### 4.3 Gateway (`module-services.js`)

Order of checks is unchanged (unknown service → company → grant → user
permission); argument validation runs after them and fails with
`422 invalid_args` + `fields`. Handlers receive
`{ companyId, actorId, actorAuthId, moduleKey, activeContext }` and the cleaned
args. Audit rows for mutations add `metadata.sourceEntityId`.
`createModuleServices({ prisma, filesService })` — files services are absent
(`unknown_service` 404 with a clear message) when the host has no files service.

### 4.4 Developer Hub impact

The Hub reads `SERVICE_CONTRACTS` (via `RME3_CAPABILITIES.serviceContracts`) and
`validateServiceArgs` to simulate every service with the same validation the ERP
applies. Its spec line "simular los siete servicios actuales" must change to
"simular los servicios del contrato publicado" (Hub-side change, tracked there).

## 5. Verification

- Unit tests: contract validation (types, required, unknown keys, base64 size),
  gateway 422 path, `own` scope 404 for calendar, task company check.
- `node --test` for module-services, module-compiler contracts and
  developer-docs; `pnpm lint`.
- Docs: `docs/developers/servicios-y-eventos.md` updated, ZIP docs regenerated.

## 6. Addendum 2026-10-04 — ledger, fleet, pfm + phase 2

### 6.1 Ledger, fleet and personal finance services

Writes delegate to the module's existing MirAI actions
(`routes/<module>/mirai-actions.js`): `prepare(args, actx)` validates and runs
the per-record access checks (ledger `canWriteAccount`, pfm `canWriteWallet`,
company scoping) without writing, then `execute(input, actx)` writes through
the same service + effects the HTTP routes use. A `prepare` error becomes
`400 rejected` with its message. Reads call the module services directly and
map to stable English keys (never the Spanish LLM-facing tool output).

| Key | Backed by | Permission |
|---|---|---|
| `runly.ledger:accounts.list` | `readableAccounts` | `ledger.accounts.read` |
| `runly.ledger:categories.list` | categories service | `ledger.categories.read` |
| `runly.ledger:transactions.create` / `.update` | `ledger.transaction.create` / `.update` | `ledger.transactions.create` / `.update` |
| `runly.fleet:vehicles.search` | fleet service | `fleet.vehicles.read` |
| `runly.fleet:drivers.search` | driver service | `fleet.drivers.read` |
| `runly.fleet:vehicles.create` / `.update` | `fleet.vehicle.create` / `.update` | `fleet.vehicles.create` / `.update` |
| `runly.fleet:insurance.create` / `.update` | `fleet.insurance.create` / `.update` | `fleet.insurance.create` / `.update` |
| `runly.pfm:wallets.list` | wallets service | `pfm.wallets.read` |
| `runly.pfm:categories.list` | categories service | `pfm.categories.read` |
| `runly.pfm:movements.create` / `.update` | `pfm.movement.create` / `.update` | `pfm.movements.create` / `.update` |

Deletes and statement import stay out (import needs a chat attachment).
A contract test asserts each action-backed contract uses the action's permission.

Fix found while doing this: phase 1 calendar services skipped the route-level
effects (activity, attendee invitations, realtime). They now call
`createCalendarEventEffects` like the routes and MirAI do.

### 6.2 Phase 2 — background calls, idempotency, more events

- **`services` in event handlers.** The dispatcher passes
  `services = moduleServices.forSystem(moduleKey, companyId)` to
  `api/events.js` handlers. It is never exposed on `moduleContext` (a route
  could otherwise pick any company). Only contracts flagged `system: true`
  run there (no user: grant only, `actorId` null, audit `metadata.system`).
  System-capable: notifications.send, contacts read/search/create/update,
  inventory read/search/update, projects tasks.update, fleet vehicles.search.
  Anything needing a person (calendar owner, ledger/pfm ACLs, user Files,
  task creator) answers `403 system_not_supported`.
- **Idempotency.** Every mutating service accepts `idempotencyKey`
  (string, max 200). The gateway looks up a previous successful audit row for
  (company, module, service, key) and returns its stored result instead of
  writing again. No schema change (audit_log metadata, indexed by module).
- **New domain events** (published where every path converges):
  `calendar.event.created|updated|cancelled` (calendar effects, payload
  `{ id, title, startAt, sourceModule, sourceEntityId }`), `files.file.created`
  (Files-explorer uploads only, `{ id, name, mimeType }`),
  `fleet.vehicle.created|updated` (fleet service, `{ id, plate, status }`).
  Ledger/pfm publish no events: their per-account/per-wallet ACLs would leak
  to subscribers.
- **Deferred to phase 3:** Builder no-code automations.
