# MirAI Identity Migration

Date: 2026-09-19
Status: In Progress — implementation verified; shared-database deployment pending
Author: Claude (agent)
Spec file: docs/superpowers/specs/2026-09-19-mirai-identity-migration-design.md
Plan file: docs/superpowers/plans/2026-09-19-mirai-identity-migration.md (created after spec approval)

---

## 1. Feature title

MirAI Identity Migration — rename the AI assistant from Meridian/MeridIAn to MirAI across the product, backend, and persisted data.

## 2. Status

In Progress — approved implementation completed and validated locally; shared-database deployment and live acceptance checks remain pending explicit confirmation.

## 3. Context

Runly's AI assistant currently ships under the brand "Meridian" (written "MeridIAn" in most user-facing copy). It started as a `runly.chat`-only feature (specs 2026-09-07-chat-meridian-*) and has since grown into a shared engine: `apps/api/src/routes/chat/meridian-service.js` exports `createMeridianService`, which `runly.chat` uses directly and `runly.inventory` (`inventory-assistant-service.js`, `InventoryAssistant.jsx`) consumes as a dependency to power its own "Meridian"-branded assistant panel. `runly.pfm` has a separate, unbranded assistant sidebar (`PFM_ASSISTANT_MODEL`) that does not currently carry the Meridian name.

The product has decided to rename this assistant to **MirAI** (brand name; "mirai" = Japanese for "future", visually incorporating "AI"). The name must be consistent everywhere the assistant appears, in every module it powers, present and future.

## 4. Problem

"Meridian"/"MeridIAn" is baked into more than brand strings: it is a Prisma model/table prefix (`chat_meridian_run`, `chat_meridian_thread`, `chat_meridian_message`), a persisted `chat_conversations.type` enum value (`'meridian'`, with a CHECK constraint and two partial unique indexes keyed on it), a persisted RBAC permission key (`chat.meridian.use`, already granted to roles in every company via `RolePermission`), a persisted bot `user_profile` display name and email address pattern (`meridian+<companyId>@bots.runly.local`, one row per company, created idempotently by `prisma/seed.js` matching on that email), and dozens of internal identifiers (files, functions, hooks, components, env vars, tests). A naive text replace would either miss the persisted pieces (leaving "Meridian" alive under the hood) or silently break multi-tenant state: renaming the permission key without preserving the existing `Permission` row would orphan every company's existing grant; renaming the bot email pattern without migrating existing rows would make `prisma/seed.js` create a second bot profile per company on the next seed run; renaming the `chat_conversations.type` value without a data migration would make already-created "Meridian" conversations invisible to code that now only recognizes `'mirai'`.

## 5. Goals

1. Every user-facing surface (chat, inventory assistant panel, docs, notifications, mentions, typing indicators) shows **MirAI** instead of Meridian/MeridIAn, styled as a two-tone wordmark ("Mir" + "AI" in distinct colors) wherever it appears as a name/label/avatar.
2. All current-state internal identifiers (files, functions, components, hooks, constants, permission key, env vars, table/column names) are renamed to the `mirai`/`MirAI`/`MIRAI` conventions, adapted to each area's existing naming style.
3. All existing persisted data survives the rename with zero duplication and zero access regression: existing chat history, existing "Meridian" conversations (now recognized as MirAI conversations), existing per-company bot profiles, and existing role grants for the assistant's use-permission all continue to work after the migration, without a second bot profile or a second permission row being created.
4. The assistant identifies itself as "MirAI, tu asistente inteligente de Runly" when asked its name, in both the `runly.chat` and `runly.inventory` surfaces.
5. `pnpm build`, `pnpm lint`, and the existing Node test suites for the touched areas (`apps/api/src/routes/chat`, `apps/api/src/services`, `apps/desktop/src/modules/runly.chat/lib`) pass after the rename.

## 6. Non-goals

1. No change to the Groq provider, model selection logic, tool-calling behavior, or any AI capability — this is an identity rename, not a behavior change.
2. No redesign of the chat UI or the assistant panel layout; only the name/label/avatar treatment changes.
3. No new logo/icon asset is designed — the two-tone wordmark text treatment is temporary until an official MirAI graphic exists (per Fase 5 of the request).
4. No renaming of historical spec/plan documents (`docs/superpowers/specs/2026-09-07-chat-meridian-*`, `docs/superpowers/plans/2026-09-07-chat-meridian-*`) — they document what was built under that name at the time and are left as historical record, per the repo's "do not delete specs" rule.
5. No change to `runly.pfm`'s assistant sidebar naming/scope beyond what CLAUDE.md already documents (it is not currently Meridian-branded and stays out of scope unless the user later asks to bring it under the MirAI umbrella).
6. Renaming the `CHAT_MERIDIAN_*` environment variables in any **deployed** environment (production/staging secrets) is out of scope for this agent — code and `.env.example` are updated, but the user must update real `.env` files / hosting secrets manually (documented as a required manual step).
7. No automatic execution of `pnpm db:migrate` against the shared Supabase dev instance as part of this work — the migration file is written and validated locally, but applying it is a manual, confirmed step (see Risks/Rollback).

## 7. User stories

- As a chat user, I want the assistant to introduce itself as MirAI so the branding matches what the product team communicates.
- As an inventory user, I want the inventory assistant panel to show "MirAI" (not "Meridian") so the identity is consistent across modules.
- As a company admin, I want everyone who already had permission to use the assistant to keep that access after the rename, with no re-granting required.
- As a developer, I want the codebase's internal names (files, services, hooks, constants) to match the product name so the code doesn't contradict the brand.
- As an existing user with prior conversations with the assistant, I want my conversation history to still be there and still work after the rename.

## 8. UX requirements

- The assistant's name renders as **MirAI** everywhere: chat header/avatar tooltip, the assistant panel title (`MeridianPanel` → `MirAIPanel`), the conversation intro card (`MeridianIntro` → `MirAIIntro`), the inventory assistant dock label and busy-state copy, typing indicators, and the "@mention" candidate list in the composer.
- Wherever the name is rendered as a heading/label/avatar tooltip (not inside a sentence of flowing prose), it uses a new shared two-tone wordmark: "Mir" in the default foreground color, "AI" in `var(--brand-primary)` (the color already used for the assistant's Sparkles avatar background across `MeridianPanel.jsx`/`MeridianIntro.jsx`/`InventoryAssistant.jsx`), both same weight/size, no other styling change. Implemented as a single reusable component so every surface stays consistent.
- Inside flowing sentences (e.g. "MirAI está analizando y consultando", self-introduction copy), the plain string "MirAI" is used — no inline color-splitting of running prose.
- All UI text stays in Spanish, unchanged in tone/wording except for the name swap (per the "no innecesario behavior change" instruction — existing sentences keep their structure, only "Meridian"/"MeridIAn" tokens are swapped for "MirAI").
- No native dialogs introduced; no change to any existing Dialog/Sheet/Panel structure.

## 9. Routes/screens

No new routes or screens. Existing screens whose rendered content changes (name/label only, no route path changes):

| Route | Screen | Module | Change |
|---|---|---|---|
| /app/m/runly.chat/... | ChatScreen / ChatWindow / MeridianPanel→MirAIPanel | runly.chat | Assistant name/avatar label text |
| /app/m/runly.inventory/... | InventoryAssistant dock/panel | runly.inventory | Assistant name/avatar label text |

## 10. Data model

### New models

None.

### Modified models

- `ChatMeridianRun` → `ChatMiraiRun` (rename only; fields unchanged). Table `chat_meridian_run` → `chat_mirai_run`.
- `ChatMeridianThread` → `ChatMiraiThread` (rename only; fields unchanged). Table `chat_meridian_thread` → `chat_mirai_thread`.
- `ChatMeridianMessage` → `ChatMiraiMessage` (rename only; fields unchanged). Table `chat_meridian_message` → `chat_mirai_message`.
- `user_profile` (raw-SQL managed, not a Prisma model field change): existing bot rows get `display_name = 'MirAI'`, `first_name = 'MirAI'`, `last_name = ''` and `email` updated from `meridian+<companyId>@bots.runly.local` to `mirai+<companyId>@bots.runly.local`, matching the seed's new-bot fields. The existing seed guard resolves bots through company memberships and skips already-provisioned bots; the migration must update their display names directly. No profile columns are added or removed.
- `chat_conversations` (raw-SQL managed): existing rows with `type = 'meridian'` get `type = 'mirai'`; the `chat_conversations_type_check` CHECK constraint is redefined to list `'mirai'` instead of `'meridian'`; the partial unique index `chat_conversations_one_meridian_per_user_idx` (`WHERE type = 'meridian'`) is replaced by `chat_conversations_one_mirai_per_user_idx` (`WHERE type = 'mirai'`).
- `permission` table: the existing row with `key = 'chat.meridian.use'` is updated **in place** (same `id`, so existing `RolePermission`/`UserPermissionGrant` rows keep working) to `key = 'chat.mirai.use'`, `name`/`description` updated to the MirAI copy.

## 11. Prisma impact

New models: None
Modified models: `ChatMeridianRun`→`ChatMiraiRun`, `ChatMeridianThread`→`ChatMiraiThread`, `ChatMeridianMessage`→`ChatMiraiMessage` (rename + `@@map`/`@@index` name updates only)
New migration required: Yes — one forward migration performing table/index renames (via `ALTER TABLE ... RENAME TO` / `ALTER INDEX ... RENAME TO`, idempotent with `IF EXISTS`), the `chat_conversations`/`user_profile`/`permission` data updates described above, and the CHECK constraint + partial index swap. All statements must be safe to run twice (guard with `IF EXISTS`/`WHERE NOT EXISTS` as appropriate) since this repo's convention is idempotent forward migrations.
Migration safety notes: Must run the `UPDATE chat_conversations SET type='mirai' WHERE type='meridian'` and the `permission` key rename inside the same migration transaction as the constraint/index changes so there is no window where code (already deployed with the new `'mirai'`/`chat.mirai.use` literals) sees rows still tagged `'meridian'`/`chat.meridian.use`. This migration file is new (never edit the four existing `20260907*_chat_meridian_*` migrations — they are applied and immutable).

Implementation verification (2026-09-19): the forward migration explicitly uses `BEGIN`/`COMMIT`, renames retained PK/FK and named NOT NULL constraints on the three tables, and rejects coexisting old/new permission keys before making changes. These corrections enforce the approved atomicity and identity requirements without merging or reassigning grants. An isolated PostgreSQL integration test validates retries, rollback, history/grant preservation, both profile schemas and repeated bot provisioning. See the [verification record](../verification/2026-09-19-mirai-identity-migration.md).

## 12. API contract

No new endpoints, no response-shape changes. But the route paths themselves ARE "meridian"-named today and are renamed as part of this migration (confirmed by reading `meridian-routes.js`/`index.js`):

| Method | Old path | New path | Permission |
|---|---|---|---|
| GET | `/chat/meridian` | `/chat/mirai` | `chat.mirai.use` |
| GET | `/chat/meridian/status` | `/chat/mirai/status` | `chat.mirai.use` |
| GET | `/chat/meridian/panel/:conversationId` | `/chat/mirai/panel/:conversationId` | `chat.mirai.use` |
| POST | `/chat/meridian/panel/:conversationId/messages` | `/chat/mirai/panel/:conversationId/messages` | `chat.mirai.use` |
| DELETE | `/chat/meridian/panel/:conversationId` | `/chat/mirai/panel/:conversationId` | `chat.mirai.use` |

This API is internal to this repo (consumed only by `packages/sdk/src/domains/chat.js`, which only this repo's desktop/web frontend uses — no evidence of external third-party consumers), so the path rename is safe as long as the SDK is updated in the same deploy (same coordinated-deploy risk already noted for the typing-presence sentinel in Edge case 5). The permission guard on every one of these endpoints changes from `chat.meridian.use` to `chat.mirai.use`, matching the in-place-renamed permission row so already-granted roles are unaffected.

## 13. SDK contract

`packages/sdk/src/domains/chat.js` exposes a `meridian: { ensure, status, panel, panelSend, panelClear }` group (confirmed by reading the file, lines 452-466) calling the paths above. The group is renamed to `mirai: { ensure, status, panel, panelSend, panelClear }` (method names unchanged, only the group key and the paths they call) pointing at the new `/chat/mirai...` paths. This is a same-conversation frontend/SDK pair, so both sides are updated together in the same commit — no external consumer of `@runly/sdk` outside this repo exists, so no deprecation shim is needed.

## 14. Validator contract

N/A — no `@runly/validators` schema currently references "Meridian" (chat message/conversation validators are generic; confirmed no match in the discovery grep of `packages/validators`).

## 15. Module manifest impact

`apps/api/src/manifests/official/feature-modules.js` declares the `chat.meridian.use` permission for `runly.chat`. The manifest's permission key changes to `chat.mirai.use`. No navigation, dependency, or ACL structural change — same module (`runly.chat`), same permission slot, renamed key only.

## 16. Navigation impact

None — no navigation items reference "Meridian" by key or label.

## 17. Blueprint impact

N/A — `runly.chat` and `runly.inventory` are not blueprint-driven RME3 modules for this surface.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `chat.meridian.use` → `chat.mirai.use` (renamed in place, same row/id) | `runly.chat` MirAI panel/conversation endpoints in `mirai-routes.js` | No |

No new permission keys are introduced. The rename is 1:1, applied via data migration so existing `RolePermission` grants are preserved.

## 19. Multi-company behavior

Every persisted change is scoped per company: the bot `user_profile` rename/email update only touches rows already scoped to their `company_id`; the `chat_conversations.type` update only touches rows that already belong to their owning company via `created_by_user_id`/membership; the `permission` key rename is a single global catalog row (permissions are global definitions, not per-company — same as today) and `RolePermission` rows (which are per-company via `Role`) are untouched by id. No cross-company data is read or merged. No change to how `activeCompanyId`/membership scoping is enforced in `meridian-service.js`/`mirai-service.js`.

## 20. Files/storage impact

N/A — no Supabase Storage interaction in the touched files.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A — the assistant's own actions were not written to `AuditLog` before this change (confirmed: no `AuditLog` writes in `meridian-service.js`/`meridian-tools.js`) and this rename does not add any.

## 23. Edge cases

1. A company whose bot profile email no longer matches `meridian+%@bots.runly.local` after migration must not get a duplicate bot profile created by the next `pnpm db:seed` run — the seed script's lookup/insert is updated to the `mirai+` pattern in the same change as the data migration that rewrites existing emails, so the two stay in sync.
2. A user who already has an open "Meridian" conversation (`type='meridian'`) must see it as their MirAI conversation after migration, not a new/broken one — covered by the `UPDATE chat_conversations SET type='mirai'` data migration.
3. Running the new migration twice (idempotency, matching this repo's other `IF EXISTS`-guarded migrations) must not error and must not duplicate the permission/bot-profile rename.
4. A role that already has `chat.meridian.use` granted must still gate access correctly post-migration without an admin re-granting anything — covered by the in-place `permission.key` update (same row id).
5. The ephemeral typing-presence sentinel (`"meridian"` broadcast on the socket channel) is not persisted, so renaming it to `"mirai"` requires the frontend and backend to deploy together; a brief mismatch during a rolling deploy would only suppress the typing indicator, not break functionality — acceptable and noted, not mitigated further.
6. The `@Meridian` mention sentinel UUID (`00000000-0000-0000-0000-00000000b07a`) is not renamed in value, only the exported constant name — the UUID is not human-visible and doesn't need to change for the brand rename to be complete.
7. Historical spec/plan docs and already-applied migration files must not be edited — only referenced/superseded, per repo rules on immutable migrations and "do not delete specs."

## 24. Risks

1. Risk: Renaming the `chat.meridian.use` permission key without an in-place data migration would silently revoke assistant access for every company. Mitigation: data migration updates the existing `Permission` row's `key` field in place (same `id`), verified by re-reading `prisma/seed.js`'s `upsert({ where: { key } })` logic before writing the migration, confirming it will match and update rather than create-duplicate.
2. Risk: Renaming the bot profile email pattern without migrating existing rows causes `pnpm db:seed` to create a second bot profile per company. Mitigation: existing emails are rewritten in the same migration, and `seed.js`'s email pattern is updated in the same commit.
3. Risk: The `chat_conversations` CHECK constraint change and the `'meridian'`→`'mirai'` data UPDATE must happen atomically relative to code deploy, or some rows/requests could reference a type value the other side doesn't recognize. Mitigation: single migration transaction handles constraint + data together; code is updated in the same commit; the migration is applied (by the user, manually) before/together with deploying the renamed code, never after.
4. Risk: This migration runs against the shared self-hosted Supabase dev instance (not an isolated per-agent DB) — other developers' in-progress sessions could be affected the moment it's applied. Mitigation: the agent writes and validates the migration file but does not run `pnpm db:migrate` without the user's explicit go-ahead at that moment.
5. Risk: Env var rename (`CHAT_MERIDIAN_*` → `CHAT_MIRAI_*`) breaks local/prod Groq config silently if only the code is updated. Mitigation: called out explicitly as a required manual step in the final summary; `.env.example` updated as the documented source of truth.
6. Risk: Scope creep across ~85 files touching a live multi-tenant system is easy to get subtly wrong in one pass. Mitigation: implementation plan batches work into verifiable, independently-testable groups (backend service/DB layer, frontend lib/hooks/components, docs/tests/env) with test runs between batches, per the plan file.

## 25. Acceptance criteria

1. Given an existing role with `chat.meridian.use` granted before migration, when the migration and code deploy complete, then that role's users can still use the MirAI panel without any admin action.
2. Given a company with an existing bot profile (`meridian+<id>@bots.runly.local`), when `pnpm db:seed` runs after migration, then no second bot profile is created for that company.
3. Given a conversation that had `type='meridian'` before migration, when a user opens it after migration, then it loads as their MirAI conversation with full message history intact.
4. Given the chat UI after migration, when a user asks the assistant "¿cómo te llamas?", then it responds identifying itself as MirAI, tu asistente inteligente de Runly.
5. Given the inventory assistant panel after migration, when opened, then it displays "MirAI" (two-tone wordmark) instead of "Meridian".
6. Given the renamed test suites, when `node --test apps/api/src/routes/chat/` and `node --test apps/api/src/services/__tests__/` run, then they pass with no reference to the old `meridian-*` file paths remaining unresolved.
7. Given the full repo, when `pnpm build` and `pnpm lint` run after the rename, then both succeed.
8. Given `docs/superpowers/specs/2026-09-07-chat-meridian-*` and the four `20260907*_chat_meridian_*` migration files, when the migration is complete, then those files are unmodified (historical record preserved).

## 26. Verification plan

- `pnpm lint` — no lint errors from renamed identifiers/imports
- `pnpm build` — full monorepo build succeeds
- `node --test apps/api/src/routes/chat/__tests__/` — renamed `mirai-*.test.js` suite passes
- `node --test apps/api/src/services/__tests__/` — `inventory-assistant-service.test.js` and any others touching the shared assistant service pass
- `node --test apps/api/src/routes/chat/__tests__/` (permission/tenant tests) — confirms `chat.mirai.use` guard behavior
- `node --check` on every renamed file as a fast syntax gate before running suites
- Manual (local, after the user applies the migration to their dev DB): open an existing pre-migration conversation and confirm it still loads; open the inventory assistant and confirm the MirAI label/avatar; ask the assistant its name and confirm it says MirAI
- Manual: re-run `pnpm db:seed` after migration and confirm (via `SELECT count(*) FROM user_profile WHERE is_bot=true GROUP BY company_id`, run by the user — not printed with secrets) no duplicate bot profiles appear

## 27. Rollback plan

The forward migration is the only DB change. Rollback is a new forward migration (never edit the applied one) that reverses each statement: rename tables/indexes back, `UPDATE chat_conversations SET type='meridian' WHERE type='mirai'`, `UPDATE permission SET key='chat.meridian.use' WHERE key='chat.mirai.use'`, restore the original CHECK constraint and partial index, and restore bot profile `email`/`first_name`/`last_name`. Because the permission rename preserves the row id throughout, rollback also preserves all grants. Code rollback is a plain `git revert` of the implementation commits. No feature flag is introduced (an identity rename has no meaningful "disabled" state) — rollback is migration + revert, not a toggle.

## 28. Future enhancements

1. Design and ship an official MirAI graphic/icon asset to replace the temporary two-tone text wordmark.
2. Extend the MirAI identity to `runly.pfm`'s assistant sidebar if the product decides to unify it under the same brand.
3. Once all environments have migrated their `.env`/secrets to `CHAT_MIRAI_*`, remove the now-unused `CHAT_MERIDIAN_*` documentation from `.env.example` history (already gone after this change — noted here only in case a transitional dual-read is added later, which this spec does not include).
