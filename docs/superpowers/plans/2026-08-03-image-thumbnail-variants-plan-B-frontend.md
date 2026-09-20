# Image Thumbnail Variants — Plan B (Frontend/QA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the frontend so full-resolution images are only fetched where a viewer/modal already exists (profile avatar zoom, user-editor avatar zoom, chat image viewer), and apply a client-side size cap to the two notes images that are stored as literal public URLs (cover banner, inline body images) instead of resolved from a file reference.

**Architecture:** Almost every avatar/thumbnail render site in the app needs **zero changes** — Plan A already made the backend embed the right-sized URL into existing API responses (`avatarUrl`, `imageUrl`, etc.), and those components just render `<img src={...}>` as before. This plan only touches (1) the handful of screens that already have a "view full image" viewer, so they explicitly request the `full` variant instead of reusing the small embedded URL, and (2) the two notes components that render a public-bucket URL persisted verbatim in the database, via a small client-side URL-rewrite helper (no backend round-trip needed since there's no signing/token involved).

**Tech Stack:** React, TanStack Query, `@atlas/sdk`, `node --test` for pure-function frontend tests (matches `apps/desktop/src/lib/__tests__/` convention — no Vitest/Jest in this repo).

**Depends on:** Plan A (`docs/superpowers/plans/2026-08-03-image-thumbnail-variants-plan-A-backend.md`) must land first — Tasks 5-7 here call endpoints/SDK functions that only accept the `variant` param after Plan A Tasks 3-5.

---

## Scope notes (read before starting)

- **Catalog product images and company logo have no code changes here.** Plan A already shrinks catalog product-grid images (a strict improvement, no viewer to wire since none exists in the frontend today — see design spec's non-goals). Company logo is excluded entirely (see Plan A's "Corrections" section) because its existing zoom viewer reuses the same URL for preview and full view, and there's no product-grid case to apply thumbnailing to safely without a matching full-res fetch.
- **Notes images are handled without any backend change.** `NoteCoverBanner.jsx` and the note body's `AnnotatableImage`/`ImageAnnotationOverlay` both render a `publicUrl` returned once at upload time (`POST /notes/presign-image`) and persisted as a literal string (`note.cover_url`, or inline in the Tiptap document JSON) — not re-resolved from a `FileAsset` id on every read like everything else in this project. Since `atlas-notes` is a public bucket (no signing token), the frontend can safely rewrite the URL's path to request a transformed variant, with no security implication and no extra network round-trip.

---

### Task 1: Frontend public-image-variant URL rewrite helper

**Files:**
- Create: `apps/desktop/src/lib/imageVariants.js`
- Test: `apps/desktop/src/lib/__tests__/imageVariants.test.js`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/lib/__tests__/imageVariants.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withImageVariant, IMAGE_VARIANT_PRESETS } from '../imageVariants.js';

const PUBLIC_URL = 'https://supabase.example.com/storage/v1/object/public/atlas-notes/notes/u1/n1/123-cover.jpg';

test('rewrites a public object URL to the render/image path with the preset query params', () => {
  const result = withImageVariant(PUBLIC_URL, 'banner');
  assert.equal(
    result,
    'https://supabase.example.com/storage/v1/render/image/public/atlas-notes/notes/u1/n1/123-cover.jpg?width=1600&height=400&resize=cover&quality=80',
  );
});

test('returns the original URL unchanged for the full variant', () => {
  assert.equal(withImageVariant(PUBLIC_URL, 'full'), PUBLIC_URL);
});

test('returns the original URL unchanged for an unrecognized variant', () => {
  assert.equal(withImageVariant(PUBLIC_URL, 'nonsense'), PUBLIC_URL);
});

test('returns null/undefined/empty input unchanged', () => {
  assert.equal(withImageVariant(null, 'banner'), null);
  assert.equal(withImageVariant(undefined, 'banner'), undefined);
  assert.equal(withImageVariant('', 'banner'), '');
});

test('leaves non-Supabase-public-object URLs unchanged (e.g. already-signed or blob URLs)', () => {
  const signedUrl = 'https://supabase.example.com/storage/v1/object/sign/atlas-files/a/b.png?token=xyz';
  assert.equal(withImageVariant(signedUrl, 'banner'), signedUrl);
  const blobUrl = 'blob:http://localhost:5173/abc-123';
  assert.equal(withImageVariant(blobUrl, 'banner'), blobUrl);
});

test('IMAGE_VARIANT_PRESETS mirrors the backend presets used for banners', () => {
  assert.deepEqual(IMAGE_VARIANT_PRESETS.banner, { width: 1600, height: 400, resize: 'cover', quality: 80 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/lib/__tests__/imageVariants.test.js`
Expected: FAIL — `Cannot find module '../imageVariants.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/desktop/src/lib/imageVariants.js

// Mirrors apps/api/src/lib/image-variants.js's IMAGE_VARIANTS — kept separate
// because this one applies to public-bucket URLs already embedded as literal
// strings in note content (no FileAsset id to re-resolve server-side), so the
// rewrite happens client-side instead of via a backend endpoint.
export const IMAGE_VARIANT_PRESETS = {
  thumb: { width: 40, height: 40, resize: 'cover', quality: 70 },
  card: { width: 96, height: 96, resize: 'cover', quality: 75 },
  banner: { width: 1600, height: 400, resize: 'cover', quality: 80 },
  product: { width: 480, height: 480, resize: 'contain', quality: 80 },
};

const PUBLIC_OBJECT_PATH = '/storage/v1/object/public/';
const RENDER_IMAGE_PUBLIC_PATH = '/storage/v1/render/image/public/';

export function withImageVariant(publicUrl, variant) {
  if (!publicUrl) return publicUrl;
  if (variant === 'full') return publicUrl;
  const preset = IMAGE_VARIANT_PRESETS[variant];
  if (!preset) return publicUrl;
  if (!publicUrl.includes(PUBLIC_OBJECT_PATH)) return publicUrl;

  const rewritten = publicUrl.replace(PUBLIC_OBJECT_PATH, RENDER_IMAGE_PUBLIC_PATH);
  const separator = rewritten.includes('?') ? '&' : '?';
  const query = new URLSearchParams({
    width: String(preset.width),
    height: String(preset.height),
    resize: preset.resize,
    quality: String(preset.quality),
  });
  return `${rewritten}${separator}${query.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/lib/__tests__/imageVariants.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/imageVariants.js apps/desktop/src/lib/__tests__/imageVariants.test.js
git commit -m "feat(desktop): add client-side image-variant URL rewrite for public note images"
```

---

### Task 2: Apply the `banner` variant to the note cover banner

**Files:**
- Modify: `apps/desktop/src/modules/atlas.notes/components/NoteCoverBanner.jsx:1-4,74-75`

- [ ] **Step 1: Import the helper**

Replace (`NoteCoverBanner.jsx:1-5`):
```js
import { useState } from 'react'
import { ImagePlus, Image as ImageIcon, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { atlas } from '../../../lib/atlas'
import { supabase } from '../../../lib/supabase'
```
with:
```js
import { useState } from 'react'
import { ImagePlus, Image as ImageIcon, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { atlas } from '../../../lib/atlas'
import { supabase } from '../../../lib/supabase'
import { withImageVariant } from '../../../lib/imageVariants.js'
```

- [ ] **Step 2: Render the resized variant**

Replace (`NoteCoverBanner.jsx:74-75`):
```js
    <div className="relative group/cover w-full aspect-[3/1] overflow-hidden bg-muted">
      <img src={coverUrl} alt="" className="w-full h-full object-cover" draggable={false} />
```
with:
```js
    <div className="relative group/cover w-full aspect-[3/1] overflow-hidden bg-muted">
      <img src={withImageVariant(coverUrl, 'banner')} alt="" className="w-full h-full object-cover" draggable={false} />
```

- [ ] **Step 3: Manual verification**

Run `pnpm dev:frontend`, open a note that has a cover banner set, open devtools Network tab, confirm the banner image request URL contains `/storage/v1/render/image/public/atlas-notes/` and `width=1600`.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.notes/components/NoteCoverBanner.jsx
git commit -m "feat(notes): render cover banner at capped resolution instead of original upload"
```

---

### Task 3: Apply the `banner` variant to inline note images

**Files:**
- Modify: `apps/desktop/src/modules/atlas.notes/components/ImageAnnotationOverlay.jsx:1-4,236-241`

- [ ] **Step 1: Import the helper**

Replace (`ImageAnnotationOverlay.jsx:1-4`):
```js
import { NodeViewWrapper } from '@tiptap/react'
import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { findDropPosition, moveNode } from '../lib/dragReorder.js'
```
with:
```js
import { NodeViewWrapper } from '@tiptap/react'
import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { findDropPosition, moveNode } from '../lib/dragReorder.js'
import { withImageVariant } from '../../../lib/imageVariants.js'
```

- [ ] **Step 2: Render the resized variant**

Replace (`ImageAnnotationOverlay.jsx:236-241`):
```js
        <img
          src={node.attrs.src}
          alt={node.attrs.alt ?? ''}
          className="w-full block rounded-b"
          draggable={false}
        />
```
with:
```js
        <img
          src={withImageVariant(node.attrs.src, 'banner')}
          alt={node.attrs.alt ?? ''}
          className="w-full block rounded-b"
          draggable={false}
        />
```

The note editor renders the image at full document width (capped by the editor's max width), so `banner` (1600px) comfortably covers every real display size here — no separate full-res fetch path is being added for inline note images in this pass. (No "click to view full image" affordance exists on this component today — see the design spec's non-goals; this task only fixes the default render size.)

- [ ] **Step 3: Manual verification**

Open a note with an inline image inserted in the body, confirm in devtools Network tab that the image request goes through `/storage/v1/render/image/public/atlas-notes/` with `width=1600`, and that the image still displays correctly (not blurry — 1600px covers any realistic editor width).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): render inline body images at capped resolution instead of original upload"
```

---

### Task 4: Add `variant` option to the SDK's signed-URL functions

**Files:**
- Modify: `packages/sdk/src/index.js:625-628`
- Modify: `packages/sdk/src/domains/chat.js:109-112`

- [ ] **Step 1: Update `atlas.files.getSignedUrl`**

Replace (`packages/sdk/src/index.js:625-628`):
```js
      getSignedUrl: (id, token) =>
        request(`/files/${encodeURIComponent(id)}/signed-url`, {
          headers: withAuthHeaders(token),
        }),
```
with:
```js
      getSignedUrl: (id, token, options = {}) =>
        request(`/files/${encodeURIComponent(id)}/signed-url${toQueryString({ variant: options.variant })}`, {
          headers: withAuthHeaders(token),
        }),
```

(`toQueryString` is already defined and in scope in this file — see `packages/sdk/src/index.js:14-22` — and is already used by dozens of other calls in this same file, e.g. line 316.)

- [ ] **Step 2: Update `atlas.chat.getAttachmentSignedUrl`**

Replace (`packages/sdk/src/domains/chat.js:109-112`):
```js
    getAttachmentSignedUrl: (attachmentId, token) =>
      request(`/chat/attachments/${encodeURIComponent(attachmentId)}/signed-url`, {
        headers: withAuthHeaders(token),
      }),
```
with:
```js
    getAttachmentSignedUrl: (attachmentId, token, options = {}) =>
      request(`/chat/attachments/${encodeURIComponent(attachmentId)}/signed-url${toQueryString({ variant: options.variant })}`, {
        headers: withAuthHeaders(token),
      }),
```

(`toQueryString` is passed into `createChatDomain(request, withAuthHeaders, toQueryString)` — see `packages/sdk/src/domains/chat.js:1` — and already in scope for this factory function.)

- [ ] **Step 3: Static-check both files**

Run: `node --check packages/sdk/src/index.js && node --check packages/sdk/src/domains/chat.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/index.js packages/sdk/src/domains/chat.js
git commit -m "feat(sdk): support variant option on getSignedUrl and getAttachmentSignedUrl"
```

---

### Task 5: Fetch full-res avatar when the ProfileScreen zoom viewer opens

**Files:**
- Modify: `apps/desktop/src/app/ProfileScreen.jsx:60-70` (add query), `466-474` (use fetched URL)

Depends on Plan A Task 2 Step 4, which adds `avatarFileId` to the `/profile/me` response.

- [ ] **Step 1: Add a full-res avatar query, enabled only while the viewer is open**

In `apps/desktop/src/app/ProfileScreen.jsx`, right after the existing `profileQuery` (ends at line 70):

```js
  const profileQuery = useQuery({
    queryKey: ["profile-me"],
    queryFn: () => atlas.profile.me(token),
    enabled: Boolean(token),
  });
```

add:

```js
  const fullAvatarQuery = useQuery({
    queryKey: ["profile-avatar-full", profileQuery.data?.data?.avatarFileId],
    queryFn: () =>
      atlas.files.getSignedUrl(profileQuery.data.data.avatarFileId, token, { variant: "full" }),
    enabled: Boolean(token && imageViewerOpen && profileQuery.data?.data?.avatarFileId),
    staleTime: 5 * 60 * 1000,
  });
```

- [ ] **Step 2: Use the fetched full-res URL in the viewer, falling back to the card-size URL while it loads**

Replace (`ProfileScreen.jsx:466-474`):
```js
      {profile?.avatarUrl && (
        <ImageViewer
          open={imageViewerOpen}
          src={profile.avatarUrl}
          alt="Foto de perfil"
          fileName={profile.displayName ?? "avatar"}
          onClose={() => setImageViewerOpen(false)}
        />
      )}
```
with:
```js
      {profile?.avatarUrl && (
        <ImageViewer
          open={imageViewerOpen}
          src={fullAvatarQuery.data?.data?.signedUrl ?? profile.avatarUrl}
          alt="Foto de perfil"
          fileName={profile.displayName ?? "avatar"}
          onClose={() => setImageViewerOpen(false)}
        />
      )}
```

- [ ] **Step 3: Manual verification**

Run `pnpm dev:frontend`, go to Profile, click the avatar to open the zoom viewer, confirm in devtools Network tab a request fires to `/files/:id/signed-url?variant=full` and the displayed image is the original resolution (not the 96px `card` variant scaled up).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app/ProfileScreen.jsx
git commit -m "feat(profile): fetch full-resolution avatar when the zoom viewer opens"
```

---

### Task 6: Fetch full-res avatar when the UserEditorScreen zoom viewer opens

**Files:**
- Modify: `apps/desktop/src/modules/atlas.identity/screens/UserEditorScreen.jsx` (add query near the top-level hooks, update the `ImageViewer` render at line 693-698)

- [ ] **Step 1: Add a full-res avatar query**

Near the other `useQuery`/`useState` hooks at the top of the `UserEditorScreen` component (alongside wherever `imageViewerOpen` is declared with `useState`), add:

```js
  const fullAvatarQuery = useQuery({
    queryKey: ["user-avatar-full", user?.avatarFileId],
    queryFn: () => atlas.files.getSignedUrl(user.avatarFileId, token, { variant: "full" }),
    enabled: Boolean(token && imageViewerOpen && user?.avatarFileId),
    staleTime: 5 * 60 * 1000,
  });
```

(Use whatever the existing `token`/auth-token variable is called in this file — check the top of the component for the same pattern already used by the avatar upload mutation, e.g. `session?.access_token`. `user` is already the query-result object destructured earlier in the file, per the existing `user?.avatarUrl` usage at line 318 — `user.avatarFileId` is already present on it today since the identity users/detail endpoints spread the raw Prisma `UserProfile` row.)

- [ ] **Step 2: Use the fetched full-res URL in the viewer**

Replace (`UserEditorScreen.jsx:693-698`):
```js
      <ImageViewer
        open={imageViewerOpen}
        onOpenChange={setImageViewerOpen}
        src={user?.avatarUrl || ""}
        alt={user?.displayName || "Foto de perfil"}
      />
```
with:
```js
      <ImageViewer
        open={imageViewerOpen}
        onOpenChange={setImageViewerOpen}
        src={fullAvatarQuery.data?.data?.signedUrl || user?.avatarUrl || ""}
        alt={user?.displayName || "Foto de perfil"}
      />
```

(Note: this component passes `onOpenChange` to `ImageViewer`, but `packages/ui/src/components/ImageViewer.jsx` only reads `onClose` — that's a pre-existing bug unrelated to this plan, not fixed here to keep this change scoped to the variant/full-res wiring.)

- [ ] **Step 3: Manual verification**

As an admin, open another user's profile in `UserEditorScreen`, click their avatar, confirm the network request for `variant=full` fires and the image is full resolution.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.identity/screens/UserEditorScreen.jsx
git commit -m "feat(identity): fetch full-resolution avatar when the user-editor zoom viewer opens"
```

---

### Task 7: Always fetch the full-res variant in the chat image viewer

**Files:**
- Modify: `apps/desktop/src/modules/atlas.chat/components/ChatAttachmentViewer.jsx:9-22`

- [ ] **Step 1: Stop short-circuiting on the embedded (card-variant) URL**

Replace (`ChatAttachmentViewer.jsx:9-22`):
```js
  const resolveSignedUrl = useCallback(
    async (file) => {
      // Use the embedded URL from listMessages if available — no network call needed
      if (file.url) return file.url;
      try {
        const res = await atlas.chat.getAttachmentSignedUrl(file.id, session?.access_token);
        return res?.data?.url ?? null;
      } catch (err) {
        console.warn("[chat] viewer getAttachmentSignedUrl failed", { id: file.id, status: err?.status, msg: err?.message });
        return null;
      }
    },
    [session?.access_token],
  );
```
with:
```js
  const resolveSignedUrl = useCallback(
    async (file) => {
      // The embedded URL from listMessages is the small `card` variant (see
      // Plan A) — the viewer always needs the full-resolution image, so it
      // fetches it explicitly rather than reusing that URL.
      try {
        const res = await atlas.chat.getAttachmentSignedUrl(file.id, session?.access_token, { variant: "full" });
        return res?.data?.url ?? null;
      } catch (err) {
        console.warn("[chat] viewer getAttachmentSignedUrl failed", { id: file.id, status: err?.status, msg: err?.message });
        return null;
      }
    },
    [session?.access_token],
  );
```

- [ ] **Step 2: Manual verification**

Open the chat floating widget, send/open an image attachment in a conversation, click it to open the viewer, confirm in devtools Network tab a request fires to `/chat/attachments/:id/signed-url?variant=full` every time the viewer opens, and the displayed image is full resolution.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/components/ChatAttachmentViewer.jsx
git commit -m "feat(chat): always fetch full-resolution image in the attachment viewer"
```

---

### Task 8: Responsive QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the 14-aspect UI checklist context**

Per `docs/ai-context/ui-screen-audit-checklist.md`, at both 390px and 1440px viewports, verify on each of the following screens that avatars/thumbnails render crisply at their small size and nothing regresses layout-wise:

- Floating chat hub (conversation list avatars, message bubble avatars, member picker) — `apps/desktop/src/modules/atlas.chat/components/FloatingChatHub.jsx`
- Identity users list / picker — wherever `GET /identity/users` is rendered
- HR org chart — `apps/desktop/src/modules/atlas.hr/screens/HrOrgChartScreen.jsx`
- Notes list cards (cover banner thumbnails) and an open note with a cover banner and an inline image
- Catalog product grid — confirm product images still look sharp at grid-thumbnail size

- [ ] **Step 2: Verify each full-res viewer touched in Tasks 5-7**

At 1440px (desktop is the realistic use case for zoom viewers): open the Profile avatar zoom, the UserEditorScreen avatar zoom (as admin), and a chat image attachment viewer. Confirm each shows a sharp, full-resolution image (not a blown-up small variant) and that the Network tab request for each includes `variant=full` with no `width=` param on the response's `signedUrl`.

- [ ] **Step 3: Confirm no regression on avatar upload flows**

Upload a new avatar via Profile and via UserEditorScreen (admin editing another user); confirm the avatar updates immediately to the new (card-variant) image in both the header/topbar and the screen itself, and that opening the zoom viewer afterward shows the new image at full resolution (not a stale cached one).

- [ ] **Step 4: Report results**

No commit for this task — report pass/fail per screen/viewport back to the user, and file any regressions found as follow-up fixes before considering this plan complete.

---

## Plan B Self-Review Notes

- **Spec coverage:** every frontend touch point identified during research is covered: notes (Tasks 1-3), SDK plumbing (Task 4), the three confirmed existing full-res viewers — Profile, UserEditorScreen, chat (Tasks 5-7) — plus QA (Task 8). The ~15 render sites found during initial research that need *no* change are intentionally not listed as tasks — that's the point of the backend-decides-the-variant design (Plan A).
- **No placeholders:** every step shows complete before/after code, including the exact existing line ranges edited.
- **Type/shape consistency:** `withImageVariant(url, variant)` signature matches between its definition (Task 1) and both call sites (Tasks 2-3). `getSignedUrl(id, token, { variant })` / `getAttachmentSignedUrl(id, token, { variant })` signatures match between the SDK (Task 4) and every caller (Tasks 5-7).
- **Known pre-existing bug flagged, not fixed:** `UserEditorScreen.jsx`'s `ImageViewer` usage passes `onOpenChange` instead of the `onClose` prop the component actually reads (Task 6) — out of scope for this plan, noted so it isn't mistaken for something this plan introduced.
