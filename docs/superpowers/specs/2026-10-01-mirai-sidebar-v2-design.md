# MirAI sidebar v2: conversations, docked layout, parity with the old assistants

- Status: Implemented, pending manual acceptance (§4)
- Date: 2026-10-01
- Fixes user feedback on `2026-09-30-mirai-global-capabilities-design.md` §9.

## 1. Problems reported

1. The sidebar header is hidden: the panel is a full-height fixed overlay (`inset-y-0`)
   that sits under the app top bar.
2. Always the same conversation: a partial unique index allows one `mirai`
   conversation per user and company; there is no way to start, switch, rename or
   delete conversations (the old Inventory/PFM assistants had thread lists).
3. Visual regression versus the old Inventory assistant: no open/close animation, no
   proper panel background, attachments shown as file names instead of thumbnails,
   no paste-to-attach, plain typing state.
4. Console "Banner not shown: beforeinstallpromptevent.preventDefault() called" — not a
   bug: the app defers the PWA install prompt on purpose to show its own install
   button; Chrome logs this informational message. No change.

## 2. Backend: multiple MirAI conversations

- Forward migration: drop the partial unique index that limits `mirai` conversations
  to one per (`created_by_user_id`, `company_id`) (find its name in
  `20260919130000_chat_mirai_rename/migration.sql`).
- `ensureMiraiConversation` returns the most recently active `mirai` conversation of
  the caller in the active company, creating one if none exists (no `ON CONFLICT`
  on the dropped index; guard concurrent creation with a transaction-scoped advisory
  lock on `mirai:<companyId>:<profileId>`).
- New routes (`chat.mirai.use`, caller must be a member):
  - `GET /chat/mirai/threads` → `[{ id, title, lastMessageAt, preview }]`, most recent
    first, max 50, only the caller's non-deleted `mirai` conversations in the active
    company.
  - `POST /chat/mirai/threads` → creates a new conversation (title "Nueva conversacion"),
    bot member + caller member, same as ensure.
  - `PATCH /chat/mirai/threads/:id` `{ title }` (1-80 chars).
  - `DELETE /chat/mirai/threads/:id` → soft delete (`deleted_at = NOW()`); pending
    proposals of that conversation are cancelled.
- Auto-title: when the first user message arrives in a conversation whose title is
  the default, set the title to that message's first 60 characters (no extra AI call).
- Chat inbox: the conversation list shows only the caller's most recently active
  `mirai` conversation (labelled "MirAI" as today); the sidebar manages the rest.

## 3. Frontend: sidebar v2

- Docked layout like the old Inventory assistant: in `RunlyApp`, `<main>` and the
  sidebar share a horizontal flex row inside the content column, so the panel sits
  under the top bar and next to the content (`<main>` keeps being the scroll
  container). Width 380px on desktop; on coarse/mobile a `Sheet` (side right).
- Animations: panel slides in/out (`transition-transform`/`translate-x`, ~200 ms,
  respecting `prefers-reduced-motion`); edge tab with hover/expand transition;
  typing indicator with animated dots.
- Proper surface: `bg-[hsl(var(--background))]`, left border, header with title,
  conversation switcher, new conversation, close.
- Conversation list view (like "Conversaciones de inventario"): list with title,
  relative time and preview; select, rename (`Dialog`), delete (`ConfirmDialog`);
  "Nueva conversacion" button. The active conversation id is remembered in
  `localStorage` (try/catch).
- Messages: attachments render with the same components the Chat module uses
  (image thumbnails/grid, file cards, open/preview), not just file names; assistant
  text via `renderRichText`; proposal cards; system notes; date separators.
- Composer: paste images from clipboard, drag and drop files onto the panel, pending
  attachment previews with remove, Enter to send / Shift+Enter newline, disabled
  while uploading.
- Empty state: 3-4 example prompts relevant to the current module (calendar, pfm,
  inventory, projects, contacts, purchases, ledger, hr, fleet, notes; generic
  otherwise).
- Reference for look and behavior: the deleted
  `apps/desktop/src/modules/runly.inventory/components/InventoryAssistant.jsx`
  (`git show 1e1cdb50^:apps/desktop/src/modules/runly.inventory/components/InventoryAssistant.jsx`).

## 4. Testing / acceptance

Backend: threads list/create/rename/delete scoped to the caller and company; ensure
returns the latest; auto-title only on the first message; inbox shows one MirAI entry.
Frontend: `pnpm build:web`; pure helpers tested with `node --test`.

Acceptance: in Contactos the header is fully visible under the top bar; the panel
slides in; "Nueva conversacion" starts a fresh thread and the list shows previous
ones with auto titles; an attached photo shows as a thumbnail; pasting an image
attaches it.
