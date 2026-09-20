# Image thumbnail variants for avatars and listed images

Status: Approved (design). Date: 2026-08-03.

## Problem

Across the app, user-facing images (profile avatars, chat images, company logo, notes
cover banners, catalog/storefront product images) are always served at their original
uploaded resolution. Every render site — user lists, the floating chat widget, presence
stacks, org chart, HR screens, notes, catalog — gets back a signed/public URL pointing
at the raw file. When an uploaded image exceeds ~1MB, this measurably slows down any
screen that renders many of them at once (chat conversation list, user pickers, org
chart, comment threads), even though the on-screen display size is often 24-96px.

No thumbnail/resize logic exists anywhere in the codebase today (verified: no `render/image`,
no `transform`, no client- or server-side resize on upload). Supabase Storage's built-in
image-transform pipeline (imgproxy sidecar) was probed directly against the self-hosted
instance (`https://supabase.example.com/storage/v1/render/image/...`) and confirmed
active — it returned `404 Object not found` for a nonexistent test object rather than a
"transformation not enabled" error, meaning the transform pipeline is live and ready to use
without any new infrastructure.

## Goals

- Screens that display many small images at once (avatar lists, chat, presence, org
  chart, product grids, note cards) request an appropriately small, resized variant
  instead of the original.
- Screens/modals that intentionally show a large image (image lightbox/annotation
  overlay, product zoom, logo editor) continue to load full resolution on demand.
- No new storage, no schema changes, no changes to the upload flow. Purely a change in
  how signed/public URLs are generated when serving already-uploaded images.
- Low blast radius: additive change to URL-generation call sites; existing API response
  shapes (`avatarUrl`, `imageUrl`, etc.) are unchanged — only the URL's target image
  becomes smaller by default.

## Non-goals

- Generic file attachments served through `files-service.js` (arbitrary documents, PDFs,
  ZIP downloads, `AttachmentsPanel`) are out of scope — these aren't rendered as image
  grids/lists today.
- `document-generation-service.js` and `report-pdf.js` (PDF generation/branding) are out
  of scope.
- No client-side image resizing on upload, no persisted thumbnail files. This is a
  read-time transform only, using Supabase's existing imgproxy sidecar.
- No new "view avatar full-screen" modal. Avatars have no full-res viewing UX anywhere in
  the app today and none is being added — they always render at their small variant.

## Design

### Shared variant helper (new)

New module `apps/api/src/lib/image-variants.js`:

```js
export const IMAGE_VARIANTS = {
  thumb:   { width: 40,   height: 40,  resize: 'cover',   quality: 70 }, // avatars in lists, chat, presence
  card:    { width: 96,   height: 96,  resize: 'cover',   quality: 75 }, // profile cards, HR, org chart
  banner:  { width: 1600, height: 400, resize: 'cover',   quality: 80 }, // note cover banners
  product: { width: 480,  height: 480, resize: 'contain', quality: 80 }, // catalog/storefront grids
  full:    null, // no transform — original image
};

export function signedUrlWithVariant(supabaseAdmin, bucket, objectKey, variant, expiresIn = 3600);
export function signedUrlsWithVariant(supabaseAdmin, bucket, objectKeys, variant, expiresIn = 3600);
export function publicUrlWithVariant(supabaseAdmin, bucket, objectKey, variant);
```

Each function passes `{ transform: IMAGE_VARIANTS[variant] }` to the corresponding
supabase-js v2 storage call (`createSignedUrl`, `createSignedUrls`, `getPublicUrl` all
accept a `transform` option; confirmed supported at the installed `@supabase/supabase-js@^2.105.1`).
When `variant` is `'full'` or unrecognized, no `transform` option is passed — identical
to today's behavior. This makes the change additive and low-risk: nothing breaks if a
call site isn't migrated yet, and cache/signing behavior is otherwise unchanged.

### Variant selection: backend decides, not the frontend

The backend already decides which context an image is used in (it's the one building the
list/detail response), so it selects the variant server-side. No new query params on
existing endpoints, no frontend contract changes for the common case. Frontend components
keep rendering whatever URL string they're given, same as today — the URL just now points
to a resized image.

### Full-resolution on demand

The existing generic endpoint used to fetch a signed URL by file id (`getSignedUrlByFileId`,
`apps/api/src/index.js:552`) gains an optional `variant` query param (default `'full'`).
Any screen that already opens a real image viewer/modal (chat image viewer, notes'
`ImageAnnotationOverlay`, product detail zoom, logo editor) calls this endpoint with
`variant=full` when the viewer opens, instead of reusing the small variant URL already in
its props/state.

### Call sites to migrate

| Area | File(s) | List/card variant | Full-res path |
|---|---|---|---|
| Identity/HR avatars | `apps/api/src/index.js`: `serializeIdentityUser` (692), `buildAvatarUrlMapByFileIds` (660), avatar upload responses (710, 1281, 2880), org chart batching (4480-4524) | `thumb` in lists, `card` in org chart/profile screens | `getSignedUrlByFileId?variant=full` (no UI trigger today — avatars aren't opened full-screen anywhere) |
| Chat avatars + images | `apps/api/src/routes/chat/chat-service.js`: `batchSignAvatarUrls` (~87-635), image attachments (866) | `thumb` for avatars, `card` for in-bubble image preview | `full` when the chat image viewer opens |
| Company logo | `apps/api/src/services/company-service.js`: `getSignedLogoUrl` (107-117) | `card` | `full` in the logo edit/preview screen, if present |
| Catalog/storefront product images | `apps/api/src/routes/catalog/catalog-product-service.js` (`resolveImageUrls`, 8-54), `apps/api/src/services/storefront-files-service.js` (56-94) | `product` in grids/lists | `full` in product detail/zoom |
| Notes | `apps/api/src/routes/notes/index.js` (cover banner / presign-image, 141-156) | `banner` for cover banners | Inline annotatable images already open via `ImageAnnotationOverlay` → that call gets `full` |

### Frontend impact

Because the backend bakes the appropriate variant into existing response fields
(`avatarUrl`, `imageUrl`, etc.), the ~15 render sites found across `atlas.chat`,
`atlas.notes`, `atlas.hr`, `atlas.identity`, `atlas.projects`, and the shared
`CommentThread`/`MentionTextarea`/`Avatar` components in `packages/ui` require **no
changes** — they keep rendering `<img src={...}>` as-is; the URL just resolves to a
smaller image now.

The only frontend changes are at the handful of existing full-image viewers, to make sure
they fetch `variant=full` explicitly instead of reusing the small URL already in their
props:

- Chat image viewer (wherever `ChatMessageBubble.jsx` / `ChatWindow.jsx` open a full image)
- `ImageAnnotationOverlay.jsx` (notes)
- Product detail/zoom view (catalog/storefront), if one exists
- Company logo editor/preview, if one shows a large preview

### Avatar cache staleness on replace

When a user replaces their avatar, imgproxy may serve a stale cached thumbnail for a
short window if the object path is reused. This is accepted as-is per user decision:
avatars change infrequently, and existing signed URLs already expire hourly, so this
self-resolves without adding path-versioning complexity.

## Rollout / implementation plan structure

Given the number of call sites across backend and the need to verify each existing
full-image viewer, implementation will be split (per project convention for large specs)
into:

- **Plan A (backend):** `image-variants.js` helper + migration of all call sites in the
  table above + `variant` param on `getSignedUrlByFileId`.
- **Plan B (frontend/QA):** wire `variant=full` into the existing image viewers listed
  above, then responsive QA (390px and 1440px) on the highest-traffic screens (floating
  chat, user lists, org chart) to confirm visual quality at the new smaller sizes and
  confirm full-res still loads correctly in each viewer.

## Testing

- `node --check` on all modified backend files.
- Manual verification: hit each migrated endpoint and confirm the returned URL includes
  the expected `width`/`height`/`quality` transform params, and that the image actually
  renders (not a broken/oversized image) at each variant.
- Browser QA on chat, user lists/pickers, org chart, notes cards, catalog grid at 390px
  and 1440px viewports — confirm avatars/thumbnails look correct and full-res viewers
  (chat image, note image annotation, product zoom) still load original quality.
