# MirAI Sidebar v2 Implementation Plan

> Spec: `docs/superpowers/specs/2026-10-01-mirai-sidebar-v2-design.md`.
**Rules:** JS only; UI Spanish, no emojis, `@runly/ui` components only, fixed header/footer with scrolling middle (modal rule); files under 1000 lines (`chat/index.js` ~980 — put new routes in `mirai-routes.js` or a new `mirai-thread-routes.js`; `mirai-service.js` ~970 — put thread logic in a new `mirai-threads-service.js`); no git commits; never start/stop dev servers; tests with explicit globs.

## API contract (shared, do not change)
- `GET /chat/mirai/threads` → `{ data: [{ id, title, lastMessageAt, preview }] }`
- `POST /chat/mirai/threads` → `{ data: { id, title } }`
- `PATCH /chat/mirai/threads/:id` body `{ title }` → `{ data: { id, title } }`
- `DELETE /chat/mirai/threads/:id` → `{ data: { deleted: true } }`
- SDK: `runly.chat.mirai.threads(token)`, `createThread(token)`, `renameThread(id, title, token)`, `deleteThread(id, token)` (added by the backend track in `packages/sdk/src/domains/chat.js`).
- `GET /chat/mirai` (ensure) keeps its shape and returns the most recent thread.

## Track A — backend
- [ ] Migration `prisma/migrations/20261001090000_mirai_multiple_threads/migration.sql`: `DROP INDEX IF EXISTS "<name from 20260919130000_chat_mirai_rename>";` Apply with `pnpm db:migrate`.
- [ ] `apps/api/src/routes/chat/mirai-threads-service.js`: list/create/rename/remove + `latestThread`; ensure/create logic moved out of `mirai-service.js` (`ensureMiraiConversation` delegates to it) with the advisory lock; remove cancels pending proposals (`UPDATE mirai_action_proposals SET status='cancelled' ... WHERE conversation_id = $id AND status='pending'`).
- [ ] Routes per contract (in `mirai-routes.js` or a new routes file mounted next to it under the existing `/chat/mirai/*` auth).
- [ ] Auto-title in the MirAI user-message path (`handleUserMessage`): if title is the default (`MirAI` or `Nueva conversacion`) and this is the first user message, set title to the first 60 chars.
- [ ] Chat conversation list: only the most recently active `mirai` conversation of the caller is returned (find the list query in the chat conversations service).
- [ ] SDK methods per contract.
- [ ] Tests for the service (fake prisma) and the list filter.

## Track B — frontend
- [ ] Read the old assistant for reference: `git show 1e1cdb50^:apps/desktop/src/modules/runly.inventory/components/InventoryAssistant.jsx` (and its composer `InventoryChatComposer.jsx` at the same commit).
- [ ] `RunlyApp.jsx`: wrap `<main>` and `<MiraiSidebarHost/>` in a `flex flex-1 min-h-0` row inside the content column (main keeps `flex-1 min-w-0 overflow-y-auto`); `MiraiSidebarHost` renders a docked `aside` (desktop) with slide animation, and a `Sheet` on coarse pointers / small screens; edge tab animated. Keep `shouldShowMiraiTab` rules and `openMiraiSidebar()`.
- [ ] Split UI into focused files under `apps/desktop/src/modules/runly.chat/components/mirai-sidebar/` (e.g. `MiraiSidebarHeader.jsx`, `MiraiThreadList.jsx`, `MiraiMessageList.jsx`, `MiraiComposer.jsx`) plus `hooks/useMiraiThreads.js` (TanStack Query over the SDK contract; active thread id in localStorage with try/catch; falls back to `useEnsureMiraiConversation`).
- [ ] Attachments in messages: reuse the Chat module's attachment rendering (find what `ChatMessageBubble.jsx` uses for image thumbnails/grids and file cards) instead of file names; composer supports paste and drag-and-drop, pending previews with remove (existing `AttachmentPreviewCard`).
- [ ] Typing indicator with animated dots; date separators; per-module example prompts in the empty state (helper in `lib/miraiPageContext.js` or a new `lib/miraiPrompts.js`, tested).
- [ ] Verify: `node --test apps/desktop/src/modules/runly.chat/lib/__tests__/*.test.js`, `npx eslint` on touched files, `pnpm build:web` inside `apps/desktop`.
