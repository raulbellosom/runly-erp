# Runly web runtime implementation

Spec: ../specs/2026-09-13-runly-web-runtime-design.md

## Exact file map

- apps/desktop/src/lib/runtimeModules.js — retain Vite glob adapter, delegate pure merge.
- apps/desktop/src/lib/runtime-modules-core.js — pure merge/navigation/lookup helpers.
- apps/desktop/src/app/module-screen-resolver.js — pure built-in screen resolver and path guard.
- apps/desktop/src/app/ModuleOutlet.jsx — delegate screen/permission resolution, preserve PFM layout with both keys.
- apps/desktop/src/app/AtlasApp.jsx — sidebar/chat layout aliases, resolved topbar identity.
- apps/desktop/src/app/useRuntimeModules.js — company color alias and authoritative API navigation.
- apps/desktop/src/lib/module-component-registry-core.js — component aliases with active/known ownership.
- apps/desktop/src/shell/BlueprintCrudScreen.jsx — pass known catalog alongside active keys.
- apps/desktop/src/lib/__tests__/runtime-module-aliases.test.js — merge/navigation/screen regressions.
- apps/desktop/src/lib/__tests__/module-component-registry-core.test.js — ownership/alias regressions.
- docs/migrations/runly-module-keys.md and docs/TASKS.md — evidence and remaining work.
- This plan and its spec — execution status.

## Work

- [x] Extract and adapt pure merge/navigation/screen functions.
- [x] Wire runtime layout aliases and component ownership handling.
- [x] Test both identities, collisions and filtered access.
- [x] Build, lint, React Doctor and document remaining cutover work.

## Evidence — 2026-09-13

- 22 Node tests passed: eight runtime merge/navigation/screen tests, ten component registry tests and four existing official identity tests. No failures or skips. Pair coverage includes all 21 official modules in both directions.
- `pnpm.cmd --filter @runly/desktop build:web` passed (7,980 modules transformed), with existing large-chunk warnings.
- Scoped ESLint passed for all ten changed/new JavaScript and React files. `git diff --check` passed.
- React Doctor: 48/100, 59 warnings, unchanged from the prior baseline (54 complexity, one duplicate JSX, four transition warnings). Changed React functions retain their existing guards/effects; no warning suppression or unrelated cleanup. Diagnostics: `<TEMP>/react-doctor-90f84500-b44a-4338-bad4-246f9481cd6e`.
- Verified `/runtime/modules` serializes permission-filtered manifest navigation. `useRuntimeModules` now explicitly prefers that API navigation, including an empty array, while module catalog callers retain local manifest fallback. Authoring navigation changes therefore require module synchronization before appearing in the authenticated runtime.
- Component registry preserves exact registrations, resolves only official namespace aliases and rejects inactive known ownership. Empty/invalid active catalogs deny namespaced resolution; shared non-namespaced components retain their behavior. `has()` and `list()` remain registration inventory, not authorization checks.
- The original screen resolver was moved into pure JavaScript without changing built-in parameterized route patterns. The shell retains resolved persisted keys for URLs/PWA; implementation lookup uses legacy aliases where necessary.
- Baseline snapshot of pre-existing edits: `<TEMP>/runly-web-runtime-before.json`. Previous migration edits and user assets preserved.

No database access/reset, seed/sync, backend migration, external publication or deployment occurred. The user stated the database is disposable test data if a reset becomes necessary; no reset is needed for this increment. Backend seed/discovery, child-screen hardcoded paths, saved JSON and PWA/native/offline identities still require follow-up before enabling persisted Runly identities across an installation.
