# Builder automations — no-code service calls from Module Builder modules

Status: approved (autonomous decision, 2026-10-04)
Builds on: `2026-10-04-module-services-v2-design.md` (services gateway, contracts, forSystem, idempotency)

## 1. Problem

Module Services v2 lets hand-written RME3 modules create and update records in
system modules. Modules made with the Module Builder cannot use any of it:
ModuleDefinition v1 rejects `consumes`/`events`
(`BUILDER_INTEGRATION_UNSUPPORTED`) and the Builder has no way to express
"when X happens, do Y".

## 2. Goals

1. A ModuleDefinition `automations` list: a trigger (this module's record
   saved, or a system domain event) plus one service call with argument
   mapping. No code.
2. The compiler validates them against `SERVICE_CONTRACTS` and
   `DOMAIN_EVENTS`, derives `consumes` and `events.subscribes`, and generates
   the runtime (`api/automations.js`, `api/events.js`, hooks in the generated
   create/update routes).
3. Builder tab **Automatizaciones** to create, edit, enable/disable them.
4. Publishing authorizes the services the automations use when the publisher
   can manage modules; otherwise they stay pending for an administrator.

## 3. Non-goals

- Chains of several actions, loops, delays/schedules, custom code steps.
- Triggers on delete/disable. Conditions beyond one field comparison.
- Automations in developer-mode (detached) projects: they edit code instead.

## 4. Design

### 4.1 Definition

```js
automations: [{
  key: 'agendar_visita',                 // ^[a-z][a-z0-9_]{1,40}$, unique, stable
  label: 'Agendar visita al crear la orden',
  enabled: true,
  trigger: { type: 'record', entity: 'orden', on: 'create' | 'update' | 'save',
             when: { field: 'estado', op: 'equals' | 'changed' | 'filled', value } }   // when optional
         | { type: 'event', event: 'fleet.vehicle.updated', when: { field: 'status', op: 'equals', value: 'maintenance' } },
  action: { service: 'runly.calendar:events.create', args: {
    title:   { from: 'template', template: 'Visita {{folio}}' },
    startAt: { from: 'field', field: 'fecha' },
    reminderMinutes: { from: 'value', value: [30] },
    userIds: { from: 'actor' },          // current user (record triggers only)
  } },
}]
```

Arg sources: `value` (literal), `field` (record field or event payload key),
`template` (`{{key}}` placeholders over the record/payload), `recordId`
(record id / payload `id`), `actor` (current user's profile id; arrays get
`[id]`; record triggers only).

Automatic args: `sourceEntityId` = record id for record triggers when the
contract accepts it and it is not mapped. `idempotencyKey`:
`<key>:<eventId>` for event triggers, `<key>:<recordId>:create` for create
triggers (none for updates: each update may legitimately fire).

### 4.2 Validation (compiler, `automations.js`)

Max 20. Key format/unique; label required and safe; entity and fields exist;
`op` valid (`changed` only with `update`/`save`); event in `DOMAIN_EVENTS`,
event field in the new `DOMAIN_EVENT_PAYLOADS`; service exists and `mutates`;
event triggers only with `system: true` services; arg names declared by the
contract; required args mapped (except automatic ones); `actor` not allowed in
event triggers; literal values validated with `validateServiceArgs`.

### 4.3 Generated code

- Manifest: `consumes` grouped by owner, `events.subscribes` (unique events).
- `api/automations.js`: the automations as JSON + inline runtime
  (`matches`, `render`, `buildArgs`, `runRecordAutomations`, `eventHandlers`).
- Routes: after create/update, `runRecordAutomations({ c, moduleContext,
  entity, on, record, previous })`. Failures never undo the save: the
  response adds `automations: [{ key, ok, error? }]` and the error is logged.
  Updates with a `changed` condition load the previous record first.
- `api/events.js`: one handler per event; runs every matching automation with
  `services` (forSystem) and the idempotency key; throws after the loop if
  any failed, so the dispatcher retries (completed ones are idempotent).

### 4.4 Publish

`publishProject` receives `canGrant` (actor holds `core.modules.manage`). If
true, the instance-wide grants become exactly the derived service keys (removed
automations revoke). The result returns `services` and `pendingGrants`. The
publish dialog lists the services the module will use.

### 4.5 Builder UI

Tab **Automatizaciones** (`AutomationsTab.jsx` + `AutomationArgsEditor.jsx`):
card per automation with name, active switch, trigger, optional condition,
action (services grouped by module; event triggers only list system-capable
ones) and an argument table (source + value per contract arg, required marked).

## 5. Verification

Compiler unit tests (validation, derived manifest, generated runtime imported
from a temp dir), Builder build (`pnpm build:web`), real E2E: Builder project
with automations published through the API on a test instance (:4011 +
worker) — record trigger creates a calendar event, event trigger creates a
contact, failure surfaces in `automations`.
