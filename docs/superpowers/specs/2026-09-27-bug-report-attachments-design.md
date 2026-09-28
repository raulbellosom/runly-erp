# Bug Report Manual Attachments and Visible Context

## 1. Feature title

Manual file attachments and a visible context/route field in the bug-report dialog.

## 2. Status

Approved

## 3. Context

Runly ERP's bug-report pipeline (`BugReportDialog.jsx` + `BugReportHost.jsx` + `bugReportBus.js` + `POST /support/report-bug`, extended earlier this session with two new always-reachable entry points — see `docs/superpowers/specs/2026-09-27-bug-report-entry-points-design.md`) today sends exactly one auto-captured screenshot (`html2canvas`, not user-editable) plus a free-text description. The "Módulo / ruta" context the entry points added is captured silently and only ever seen by the support team in the received email — the reporting user never sees it. Testing the new entry points surfaced two gaps: there is no way to attach anything beyond the automatic screenshot (a second screenshot, a log file, a spreadsheet), and the user has no visibility into what context is being sent on their behalf.

## 4. Problem

1. A user who needs to attach more than the one automatic screenshot (e.g. a log file, a document, a second screenshot showing a different state) has no way to do so — the dialog has no file picker.
2. The module/route context sent with every report is invisible to the reporting user, so they can't confirm it's accurate before sending.

## 5. Goals

1. Let the user attach up to 3 additional files (images, PDF, plain text, CSV, Word, Excel) to a bug report, on top of the automatic screenshot.
2. Show the captured module/route context as read-only text in the dialog, so the user can see exactly what's being sent.
3. Keep the existing pipeline's shape: attachments travel as email attachments (via the existing SMTP send), never touch Supabase Storage, and are never persisted anywhere after the email is sent.
4. Reuse existing `@runly/ui` components (`FileUploader`, `FileCard`) for the picker and file-list UI rather than building a new one.

## 6. Non-goals

1. Persisting attachments to Supabase Storage or any database table — they exist only for the lifetime of the request/email.
2. Editing the context/route field — it is informational and read-only (decided during brainstorming: editing it could let it drift from the truth and mislead support).
3. Supporting more than 3 additional files, or file types outside the fixed allowlist (images, PDF, plain text, CSV, Word, Excel) — no archives, no executables, no arbitrary MIME types.
4. Any change to the automatic screenshot mechanism (`html2canvas` capture, its own fixed `captura.png`/`captura.jpg` filename) — it keeps working exactly as it does today, as a separate, always-included attachment.
5. A generic "add attachments to any email-sending feature" abstraction — this is scoped to the bug-report dialog only.

## 7. User stories

1. As a user reporting a bug, I want to see the module/route context before I submit, so that I can trust the report is accurate.
2. As a user reporting a bug, I want to attach a log file or a second screenshot, so that support has enough information without a follow-up email.
3. As a member of the Runly support team, I want the received email to list every attached file's name up front, so that I know what to look for without opening each one first.

## 8. UX requirements

- A new read-only block near the top of `BugReportDialog.jsx` (above or alongside the existing conditional `errorMessage` block) displays the `context` string exactly as captured (e.g. `runly.core · /app/m/runly.core/module-builder/<id>`) — plain text, not editable, no input styling.
- Below the description textarea, a `FileUploader` (from `@runly/ui`, `multiple` mode, `accept` restricted to the allowed MIME types, `maxSizeMB={5}`) lets the user pick additional files. `FileUploader` is used in its "local file, no upload callback" mode (no `onUpload`/`onUploadMany` passed), so files are never sent anywhere until the whole report is submitted.
- Each picked file renders as a `FileCard` (from `@runly/ui`) below the picker: name, size, and a remove (X) button. No download/preview link (no `url` prop passed — `FileCard` already renders cleanly without one).
- Once 3 files are attached, the `FileUploader` picker is hidden and replaced with a short label (e.g. "3/3 archivos adjuntos") — the user must remove one before adding another.
- If the user selects files that would push the total above 3 (e.g. picking 2 more while already at 2), only enough files to reach the cap of 3 are kept, and a toast (`sonner`, matching this component's existing error-toast usage elsewhere in the app) tells them: "Solo puedes adjuntar hasta 3 archivos."
- If the user selects a file whose type isn't in the allowed list (a drag-and-drop can bypass the native `accept` filter), it's rejected before being added to the list, with a toast: "«{filename}» no es un tipo de archivo permitido."
- Per-file size limit (5MB) is enforced by `FileUploader`'s own built-in `maxSizeMB` check, which already shows its own inline error — no new code needed for that specific case.
- All new UI text is in Spanish, per project convention.

## 9. Routes/screens

No new routes or screens. Modified components: `packages/ui/src/components/BugReportDialog.jsx` (presentational), `apps/desktop/src/components/BugReportHost.jsx` (state + submission logic). No change to where the dialog is triggered from (existing `requestBugReport()` bus call sites, unchanged).

## 10. Data model

N/A — no new or modified Prisma models. Attachments are never persisted; they exist only as in-memory `File` objects (client) and email MIME parts (server, transient, during the SMTP send).

## 11. Prisma impact

N/A — no migration.

## 12. API contract

`POST /support/report-bug` (existing endpoint, `apps/api/src/routes/support-routes.js`, unchanged route logic) gains one new optional field in its JSON body:

- `attachments` — array, 0 to 3 items, each `{ filename: string (1-200 chars), mimeType: string (must be one of the allowed types), dataUrl: string (a `data:<mimeType>;base64,...` string, max ~7,000,000 characters ≈ 5MB raw file) }`.
- The request is rejected (422, existing Zod-error handling path in `support-routes.js` — no new error-handling code needed) if: more than 3 attachments are sent, any `mimeType` isn't in the allowlist, any single `dataUrl` exceeds the per-file cap, or the **combined** length of `screenshot` + every attachment's `dataUrl` exceeds a total cap (~18,000,000 characters ≈ safety margin under typical SMTP relay limits of 20-25MB). This total-size check is new validation logic (a Zod `superRefine` on the whole schema), added specifically so an oversized combination fails fast with a clear message instead of silently failing later at the SMTP layer.
- Response shape (`{ ok: true }` on success) and every existing error code/status (`profile_not_found` 404, `rate_limited` 429, `not_configured` 503, `smtp_error` 502) are unchanged.

## 13. SDK contract

No signature change. `runly.support.reportBug(data, token)` (`packages/sdk/src/index.js`) already forwards whatever plain object it's given as the JSON body — the caller (`BugReportHost.jsx`) just includes the new `attachments` array in that object.

## 14. Validator contract

`packages/validators/src/support.js`'s `bugReportSchema` gains:

- A new exported allowlist constant, e.g. `ALLOWED_ATTACHMENT_MIME_TYPES` — a `Set` containing: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. (No `image/svg+xml` — an SVG can embed a script; the existing screenshot mechanism only ever produces PNG/JPEG anyway, so this doesn't affect it.)
- A new `attachmentSchema` (used as the array item type): `filename` (trimmed string, 1-200 chars), `mimeType` (must be a member of the allowlist above), `dataUrl` (string, must start with `data:<mimeType>;base64,` matching the same `mimeType` field — prevents a mismatched/spoofed pair — and capped at the per-file length constant).
- `bugReportSchema.attachments`: `z.array(attachmentSchema).max(3).optional()`.
- A whole-schema `superRefine` enforcing the combined `screenshot` + `attachments[].dataUrl` total-length cap described in §12, producing a validation error on the `attachments` path if exceeded.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

N/A — unchanged from today: any authenticated user with an enabled profile can submit a bug report (no dedicated permission), and this feature doesn't add or touch any permission check.

## 19. Multi-company behavior

Unchanged. Attachments carry no company-scoping concerns of their own — they're transient email MIME parts attached to the same email `support-report-service.js` already sends, which already resolves company context (`companyId`/`companyName`) exactly as it does today.

## 20. Files/storage impact

None — this is the central design decision from brainstorming (§6 non-goal 1). Attachments never reach Supabase Storage, `FileAsset`, or any other persistence layer. They exist as browser-memory `File` objects until submit, then as base64 email MIME parts for the duration of the SMTP send, then are discarded.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A — unchanged from today; the existing bug-report pipeline doesn't write to `AuditLog` (it sends an email), and this feature doesn't change that.

## 23. Edge cases

1. **User attaches 0 files**: `attachments` is omitted or an empty array — identical behavior to today (only the automatic screenshot, if captured successfully, is attached).
2. **Drag-and-drop bypasses the `accept` filter**: client-side validation (§8) rejects any file whose `type` isn't in the allowlist before it's added to the visible list, with a toast — it never reaches the submit payload. Server-side validation (§14) is the actual security boundary regardless, in case client-side validation is ever bypassed (e.g. a modified request).
3. **Combined size exceeds the SMTP-safe total cap**: the request is rejected server-side (§12) with a clear validation error, surfaced in the dialog's existing error-message area (the same one that already shows `not_configured`/`smtp_error` messages) — the user is told to remove an attachment and retry, not left with a generic 500 or a silently-lost email.
4. **User removes a file after picking it**: `FileCard`'s `onRemove` updates the host's local `attachments` state; nothing was ever sent, so there's nothing to clean up server-side.
5. **Automatic screenshot capture fails** (pre-existing `try/catch` in `BugReportHost.jsx`, unrelated to this feature): the report still sends, with or without user-picked attachments — unchanged from today's best-effort screenshot behavior.
6. **`context` is empty/null** (no active module, e.g. `/app/home`): the read-only context block either shows the bare pathname (already the existing fallback from `ErrorState`'s trigger, unchanged) or, for the two new persistent entry points, whatever they already computed — this feature only renders whatever `context` string it's given, it doesn't change how that string is computed.

## 24. Risks

1. **Zip-bomb-style or malformed `dataUrl` payloads bypassing client checks**: mitigated by the server-side Zod validation being the actual enforcement boundary (§14, §23.2) — client-side checks are a UX convenience, not the security boundary.
2. **SMTP relay silently drops or bounces an over-large email despite the total-size cap** (different providers have different real limits): the ~18MB total cap is a conservative estimate, not a guarantee for every possible SMTP provider; if this proves too permissive in practice, the constant can be lowered in one place (`packages/validators/src/support.js`) without any other code change.
3. **`FileUploader`'s multi-select `onChange` contract** (returns a fresh array of newly-picked files, not a cumulative list) is easy to misuse by overwriting rather than appending to existing state — called out explicitly in the implementation plan to avoid this exact mistake.

## 25. Acceptance criteria

1. Given the bug-report dialog is open, when it renders, then a read-only block shows the exact `context` string that will be sent (or the bare pathname fallback when no module is active).
2. Given the dialog is open, when the user picks 1-3 files of an allowed type under 5MB each, then each appears as a `FileCard` with a working remove button, and the picker is replaced by a "3/3" label once the cap is reached.
3. Given 3 files are already attached, when the user tries to add a 4th, then it is not added and a toast explains the 3-file limit.
4. Given the user picks a disallowed file type via drag-and-drop, when it lands on the dropzone, then it is not added and a toast names the rejected file.
5. Given 1-3 valid attachments and a submit, when the report is sent, then the received email lists every attachment's filename in a dedicated field and the files themselves are real, openable attachments on the email.
6. Given attachments whose combined size (with the screenshot) exceeds the total cap, when the user submits, then the dialog shows a clear validation error and the report is not sent.
7. Given the report is sent successfully, when the dialog closes, then no attachment data remains anywhere outside that one email (no Storage upload occurred, confirmable by there being no new `FileAsset` row and no `runly.files` API call made during the whole flow).

## 26. Verification plan

- `packages/validators`: add unit tests for `bugReportSchema` covering — valid single/multiple attachments, over-the-cap count (4th rejected), disallowed `mimeType` rejected, `dataUrl`/`mimeType` mismatch rejected, per-file size cap rejected, combined-total cap rejected (with and without a screenshot present).
- `support-report-service.js`: add/extend unit tests confirming `sendBugReport` builds a nodemailer `attachments` array containing both the screenshot (when present) and every user attachment, and that the email template's field list includes an "Adjuntos" row only when `attachments.length > 0`.
- `pnpm exec eslint` on all touched files.
- `pnpm --filter @runly/desktop run build:web` succeeds.
- Manual check in a running dev session: open the dialog from any of the existing trigger points, confirm the context block shows correct text, attach 3 files (mixing at least one image and one PDF/CSV), confirm the 3/3 cap and the "remove" buttons work, submit, and (if a real SMTP/`RUNLY_SUPPORT_EMAIL` is configured in that dev environment) confirm the received email lists all attachments and they open correctly.

## 27. Rollback plan

Pure additive change to an existing, working pipeline — no migration, no new persisted data. Revert is a plain `git revert` of the implementing commit(s); the dialog and endpoint continue working exactly as before (single screenshot, no attachments, no context display) with zero cleanup needed.

## 28. Future enhancements

1. If reports routinely need larger or more numerous attachments than email can comfortably carry, revisit the Supabase-Storage-backed approach considered and explicitly deferred during brainstorming (§6 non-goal 1) — it would need a retention/cleanup policy and an upload-permission decision that weren't needed for this email-only version.
2. Client-side image compression for picked image attachments (mirroring the screenshot's own JPEG compression) if the 5MB per-file cap proves too tight for common phone-camera screenshots.
