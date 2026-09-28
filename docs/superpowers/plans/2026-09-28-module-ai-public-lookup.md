# Plan: module AI public lookup + assistant panel

Spec: `docs/superpowers/specs/2026-09-28-module-ai-public-lookup-design.md`

## Task 1 — shared service
- [x] `apps/api/src/services/ai/public-lookup.js`: `createTavilyClient`,
      `createPublicLookup({ env, fetchImpl })` with `enabled`, `lookup`,
      `createTurnBudget`, `PUBLIC_LOOKUP_PROMPT_RULE`, `isIdentifyingField`.
- [x] `mirai-service.js`: `live` route uses the shared Tavily client; expose
      `publicLookup` instead of `searchPublicModel`.
- [x] Test: `services/ai/__tests__/public-lookup.test.js`.

## Task 2 — inventory migration
- [x] `inventory-assistant-service.js` uses `mirai.publicLookup` with subject
      `{ type, brand, model }`, the shared budget and prompt rule; tool only
      offered when lookup is enabled.
- [x] Update inventory assistant test.

## Task 3 — RME3 capability
- [x] `packages/module-engine`: validate `manifest.ai.publicLookup`
      (array of `{ model, publicFields[], topics? }`, identifying fields rejected).
- [x] `apps/api/src/services/ai/module-ai-capability.js`: `createModuleAiCapability`
      -> `(moduleKey, manifest) => moduleContext.ai`.
- [x] Route loader + `index.js` wiring (`aiCapability`).
- [x] Docs: `docs/ai-context/rme3-runtime-capabilities.md` (+ devkit copy),
      `docs/03_custom_modules.md` short section.
- [x] Tests: manifest validation, capability picks only declared fields + audit.

## Task 4 — panel
- [x] `packages/ui/src/components/ModuleAssistantPanel.jsx` (list view / chat
      view with back button), exported and documented.
- [x] `InventoryAssistant.jsx` uses it.
- [x] `pnpm build:web`.

## Verification

Verified: 2026-09-28 (`node --test` services/ai, services, routes/chat, routes/inventory, module-engine: 1194 pass; the only failure, `inventory-chat.test.js`, is a native process crash 0xC0000005 under parallel load and passes 6/6 in isolation; `pnpm lint` clean; `vite build` in apps/desktop OK). Not verified: live Groq/Tavily call against the real API.

- `node --test` on touched test dirs, `pnpm lint`, `pnpm build:web`.
