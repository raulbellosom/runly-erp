# Bug Report Manual Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach up to 3 additional files (images, PDF, plain text, CSV, Word, Excel) to a bug report, on top of the automatic screenshot, and show them the captured module/route context as read-only text before they send.

**Architecture:** Attachments are read client-side as `data:` URLs (the same technique the automatic screenshot already uses) and sent as extra fields on the existing `POST /support/report-bug` JSON body — no new endpoint, no Supabase Storage, nothing persisted. The server validates them (allowed MIME types, per-file and combined size caps) and attaches them to the same nodemailer email the screenshot already rides on. The dialog reuses `@runly/ui`'s existing `FileUploader` (in its no-`onUpload` "just give me the local File objects" mode) and `FileCard` for the picker and per-file remove UI.

**Tech Stack:** Zod (`@runly/validators`), Hono route (unchanged shape), nodemailer attachments, React (`packages/ui`, `apps/desktop`), `sonner` toasts (already a `packages/ui` dependency).

**Spec:** `docs/superpowers/specs/2026-09-27-bug-report-attachments-design.md`

---

## File Structure

| File | Change |
|---|---|
| `packages/validators/src/support.js` | Modify — add `ALLOWED_ATTACHMENT_MIME_TYPES`, `attachments` field, combined-size `superRefine` |
| `packages/validators/src/__tests__/support-schemas.test.js` | Create — schema tests |
| `apps/api/src/services/support-report-service.js` | Modify — generic attachment helper, "Adjuntos" email field, combined attachments array |
| `apps/api/src/services/__tests__/support-report-service.test.js` | Modify — add one test covering attachments end-to-end |
| `packages/ui/src/components/BugReportDialog.jsx` | Modify — context display, file picker + list |
| `apps/desktop/src/components/BugReportHost.jsx` | Modify — track attachments state, convert to data URLs on submit |

No new backend endpoints, no new files besides the one new test file.

---

### Task 1: Validator — allow and cap attachments

**Files:**
- Modify: `packages/validators/src/support.js`
- Create: `packages/validators/src/__tests__/support-schemas.test.js`

- [ ] **Step 1: Write the failing tests**

Create `packages/validators/src/__tests__/support-schemas.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bugReportSchema, ALLOWED_ATTACHMENT_MIME_TYPES } from '../index.js'

function validAttachment(overrides = {}) {
  return {
    filename: 'log.txt',
    mimeType: 'text/plain',
    dataUrl: `data:text/plain;base64,${'A'.repeat(100)}`,
    ...overrides,
  }
}

describe('bugReportSchema attachments', () => {
  it('accepts a report with no attachments', () => {
    const result = bugReportSchema.safeParse({ context: '/app/home' })
    assert.equal(result.success, true)
  })

  it('accepts up to 3 valid attachments', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment(),
        validAttachment({ filename: 'b.txt' }),
        validAttachment({ filename: 'c.txt' }),
      ],
    })
    assert.equal(result.success, true)
  })

  it('rejects a 4th attachment', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment(),
        validAttachment({ filename: 'b.txt' }),
        validAttachment({ filename: 'c.txt' }),
        validAttachment({ filename: 'd.txt' }),
      ],
    })
    assert.equal(result.success, false)
  })

  it('rejects a disallowed mime type', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment({
          mimeType: 'application/x-msdownload',
          dataUrl: 'data:application/x-msdownload;base64,AA==',
        }),
      ],
    })
    assert.equal(result.success, false)
  })

  it('rejects a dataUrl that does not match its declared mimeType', () => {
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ mimeType: 'text/plain', dataUrl: 'data:image/png;base64,AA==' })],
    })
    assert.equal(result.success, false)
  })

  it('rejects an attachment over the per-file size cap', () => {
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ dataUrl: `data:text/plain;base64,${'A'.repeat(7_000_001)}` })],
    })
    assert.equal(result.success, false)
  })

  it('rejects when combined screenshot + attachments exceed the total cap', () => {
    // Each attachment stays under the 7,000,000-char per-file cap on its own
    // (~6,500,024 chars including the data: prefix); only the sum of all
    // three (~19.5M) crosses the 18,000,000-char total cap.
    const bigAttachment = () => validAttachment({ dataUrl: `data:text/plain;base64,${'A'.repeat(6_500_000)}` })
    const result = bugReportSchema.safeParse({
      attachments: [
        bigAttachment(),
        { ...bigAttachment(), filename: 'b.txt' },
        { ...bigAttachment(), filename: 'c.txt' },
      ],
    })
    assert.equal(result.success, false)
  })

  it('exports the allowlist for the frontend picker to mirror', () => {
    assert.ok(ALLOWED_ATTACHMENT_MIME_TYPES.has('application/pdf'))
    assert.ok(!ALLOWED_ATTACHMENT_MIME_TYPES.has('application/x-msdownload'))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/validators/src/__tests__/support-schemas.test.js`
Expected: FAIL — `ALLOWED_ATTACHMENT_MIME_TYPES` is not exported yet, and `attachments` isn't a recognized field yet (some tests that expect `success: true` with attachments will fail; the "no attachments" test will pass since that part isn't new).

- [ ] **Step 3: Update `packages/validators/src/support.js`**

Replace the full file contents:

```js
import { z } from "zod";

// Screenshots are JPEG data URLs produced client-side by html2canvas at a
// reduced scale/quality — a rough ceiling keeps a runaway capture from
// blowing up the email payload, not a precise size guarantee.
const MAX_SCREENSHOT_DATA_URL_LENGTH = 3_000_000;

// User-picked attachments (BugReportDialog.jsx's file picker). Mirrored on
// the frontend by a duplicated Set in BugReportDialog.jsx — packages/ui has
// no existing dependency on @runly/validators, and this list rarely changes,
// so keeping two short copies in sync by hand was preferred over adding a
// new cross-package dependency for one constant.
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 7_000_000; // ~5MB file, base64-encoded
// Combined with the screenshot, kept under typical SMTP relay limits
// (~20-25MB) so an oversized combination fails validation with a clear
// message instead of the email silently bouncing at the SMTP layer.
const MAX_TOTAL_ATTACHMENTS_DATA_URL_LENGTH = 18_000_000;

const attachmentSchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    mimeType: z.string().refine((value) => ALLOWED_ATTACHMENT_MIME_TYPES.has(value), {
      message: "Tipo de archivo no permitido.",
    }),
    dataUrl: z.string().max(MAX_ATTACHMENT_DATA_URL_LENGTH),
  })
  .refine((attachment) => attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`), {
    message: "El archivo no coincide con su tipo declarado.",
    path: ["dataUrl"],
  });

export const bugReportSchema = z
  .object({
    context: z.string().trim().max(300).optional().or(z.literal("")),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    errorMessage: z.string().trim().max(2000).optional().or(z.literal("")),
    errorStack: z.string().trim().max(8000).optional().or(z.literal("")),
    componentStack: z.string().trim().max(8000).optional().or(z.literal("")),
    url: z.string().trim().max(2000).optional().or(z.literal("")),
    screenshot: z
      .string()
      .startsWith("data:image/")
      .max(MAX_SCREENSHOT_DATA_URL_LENGTH)
      .optional()
      .nullable(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  })
  .superRefine((data, ctx) => {
    const totalLength =
      (data.screenshot?.length ?? 0) +
      (data.attachments ?? []).reduce((sum, attachment) => sum + attachment.dataUrl.length, 0);
    if (totalLength > MAX_TOTAL_ATTACHMENTS_DATA_URL_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachments"],
        message: "El total de adjuntos es demasiado grande.",
      });
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/validators/src/__tests__/support-schemas.test.js`
Expected: all tests PASS (9 tests: the 2 pre-existing-shape ones plus 7 new attachment ones — actually this is a new file, so all tests in it are new; expect `# pass 8`, `# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/support.js packages/validators/src/__tests__/support-schemas.test.js
git commit -m "feat(support): allow up to 3 bug-report attachments with type/size limits"
```

---

### Task 2: Backend — attach user files to the email, list filenames

**Files:**
- Modify: `apps/api/src/services/support-report-service.js`
- Modify: `apps/api/src/services/__tests__/support-report-service.test.js`

- [ ] **Step 1: Write the failing test**

In `apps/api/src/services/__tests__/support-report-service.test.js`, add this test inside the existing `describe("createSupportReportService.sendBugReport", ...)` block (place it after the "sends via platform SMTP..." test):

```js
  it("includes both the screenshot and user attachments, and lists filenames in the email", async (t) => {
    const sendMail = t.mock.fn(async () => ({}));
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await svc.sendBugReport({
      userId: "u1",
      payload: {
        screenshot: "data:image/png;base64,AAAA",
        attachments: [
          { filename: "log.txt", mimeType: "text/plain", dataUrl: "data:text/plain;base64,QkJC" },
        ],
      },
    });

    const sent = sendMail.mock.calls[0].arguments[0];
    assert.equal(sent.attachments.length, 2);
    assert.deepEqual(sent.attachments[0], { filename: "captura.png", content: "AAAA", encoding: "base64" });
    assert.deepEqual(sent.attachments[1], { filename: "log.txt", content: "QkJC", encoding: "base64" });
    assert.ok(sent.text.includes("Adjuntos: log.txt"));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/api/src/services/__tests__/support-report-service.test.js`
Expected: FAIL — `sent.attachments.length` is `1` (only the screenshot), not `2`, since `payload.attachments` is ignored today.

- [ ] **Step 3: Modify `support-report-service.js`**

Find:

```js
function screenshotAttachment(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const ext = match[1] === "png" ? "png" : "jpg";
  return {
    filename: `captura.${ext}`,
    content: match[2],
    encoding: "base64",
  };
}
```

Add immediately after it:

```js

// Generic counterpart for user-picked attachments (BugReportDialog.jsx) —
// unlike the screenshot, these keep the user's own filename and can be any
// of the MIME types packages/validators/src/support.js's
// ALLOWED_ATTACHMENT_MIME_TYPES allows, not just PNG/JPEG.
function userAttachment({ filename, dataUrl } = {}) {
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  return { filename, content: match[1], encoding: "base64" };
}
```

Find:

```js
    const { subject, html, text } = buildBugReportEmail({
      errorMessage: payload.errorMessage,
      description: payload.description,
      stackText: [payload.errorStack, payload.componentStack].filter(Boolean).join("\n\n"),
      fields: [
        ["Fecha", new Date().toLocaleString("es-MX")],
        ["Usuario", userName ? `${userName} <${userEmail ?? ""}>` : userEmail],
        ["Empresa", companyName],
        ["Módulo / ruta", payload.context],
        ["URL", payload.url],
      ],
      env,
    });

    const attachment = screenshotAttachment(payload.screenshot);

    try {
      await sendViaAvailableSmtp({
        companyId,
        to: supportEmail,
        subject,
        html,
        text,
        fromName: "Runly ERP - Reporte de bug",
        attachments: attachment ? [attachment] : undefined,
      });
```

Replace with:

```js
    const { subject, html, text } = buildBugReportEmail({
      errorMessage: payload.errorMessage,
      description: payload.description,
      stackText: [payload.errorStack, payload.componentStack].filter(Boolean).join("\n\n"),
      fields: [
        ["Fecha", new Date().toLocaleString("es-MX")],
        ["Usuario", userName ? `${userName} <${userEmail ?? ""}>` : userEmail],
        ["Empresa", companyName],
        ["Módulo / ruta", payload.context],
        ["URL", payload.url],
        ["Adjuntos", payload.attachments?.length ? payload.attachments.map((a) => a.filename).join(", ") : null],
      ],
      env,
    });

    const attachments = [
      screenshotAttachment(payload.screenshot),
      ...(payload.attachments ?? []).map(userAttachment),
    ].filter(Boolean);

    try {
      await sendViaAvailableSmtp({
        companyId,
        to: supportEmail,
        subject,
        html,
        text,
        fromName: "Runly ERP - Reporte de bug",
        attachments: attachments.length ? attachments : undefined,
      });
```

Note: `buildBugReportEmail` (in `apps/api/src/services/email-templates.js`) is NOT modified — it already renders any `[label, value]` pair in its caller-supplied `fields` array generically (see its existing `.filter(([, value]) => value)` — a falsy value is simply omitted), so the new `["Adjuntos", ...]` row needs no template change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test apps/api/src/services/__tests__/support-report-service.test.js`
Expected: all tests PASS, including the new one (7 tests total in this file now).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/support-report-service.js apps/api/src/services/__tests__/support-report-service.test.js
git commit -m "feat(support): send user-picked attachments alongside the screenshot"
```

---

### Task 3: Dialog UI — show context, add the file picker

**Files:**
- Modify: `packages/ui/src/components/BugReportDialog.jsx`

- [ ] **Step 1: Replace the file's full contents**

```jsx
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./Dialog.jsx";
import { Button } from "./Button.jsx";
import { TextareaField } from "./FormFields.jsx";
import { FileUploader } from "./FileUploader.jsx";
import { FileCard } from "./FileCard.jsx";

const MAX_ATTACHMENTS = 3;

// Mirrors packages/validators/src/support.js's ALLOWED_ATTACHMENT_MIME_TYPES
// — keep both lists in sync if this ever changes. Duplicated here rather
// than importing @runly/validators (packages/ui has no existing dependency
// on it, and this is a short, rarely-changing list) — see that file's own
// comment pointing back at this one.
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  ".pdf",
  "text/plain",
  ".txt",
  "text/csv",
  ".csv",
  "application/vnd.ms-excel",
  ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsx",
  "application/msword",
  ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docx",
].join(",");

// Presentational only — no API/auth knowledge, matching the rest of
// packages/ui. The host (apps/desktop's BugReportHost) owns the screenshot
// capture, the attachment-to-dataURL conversion, and the actual send; this
// component just renders what's captured/picked and forwards the user's
// input back up.
export function BugReportDialog({
  open,
  onOpenChange,
  context,
  errorMessage,
  screenshotDataUrl,
  description,
  onDescriptionChange,
  attachments = [],
  onAttachmentsChange,
  onSubmit,
  submitting = false,
  error,
}) {
  function handlePickFiles(files) {
    const picked = Array.isArray(files) ? files : [files];
    const valid = [];
    for (const file of picked) {
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type)) {
        toast.error(`«${file.name}» no es un tipo de archivo permitido.`);
        continue;
      }
      valid.push(file);
    }
    const next = [...attachments, ...valid];
    if (next.length > MAX_ATTACHMENTS) {
      toast.error(`Solo puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos.`);
    }
    onAttachmentsChange?.(next.slice(0, MAX_ATTACHMENTS));
  }

  function removeAttachment(index) {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== index));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar bug</DialogTitle>
          <DialogDescription>
            Se enviará al equipo de Runly junto con detalles técnicos para ayudar a diagnosticarlo.
          </DialogDescription>
        </DialogHeader>

        {context && (
          <p
            className="mb-3 truncate text-xs text-[hsl(var(--muted-foreground))]"
            title={context}
          >
            {context}
          </p>
        )}

        {errorMessage && (
          <p className="mb-3 max-h-24 overflow-auto rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] break-words">
            {errorMessage}
          </p>
        )}

        <TextareaField
          label="¿Qué estabas haciendo? (opcional)"
          placeholder="Pasos para reproducir el problema..."
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={2000}
        />

        {screenshotDataUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              Se incluirá esta captura de pantalla:
            </p>
            <img
              src={screenshotDataUrl}
              alt="Captura de pantalla del error"
              className="max-h-36 w-full rounded-lg border border-[hsl(var(--border))] object-cover object-top"
            />
          </div>
        )}

        <div className="mt-3 space-y-2">
          {attachments.length < MAX_ATTACHMENTS && (
            <FileUploader
              multiple
              accept={ATTACHMENT_ACCEPT}
              maxSizeMB={5}
              disabled={submitting}
              hint="Hasta 3 archivos — imágenes, PDF, texto, CSV, Word o Excel."
              emptyLabel="Adjuntar archivos"
              onChange={handlePickFiles}
            />
          )}
          {attachments.map((file, index) => (
            <FileCard
              key={`${file.name}-${index}`}
              name={file.name}
              mimeType={file.type}
              sizeBytes={file.size}
              onRemove={submitting ? null : () => removeAttachment(index)}
            />
          ))}
          {attachments.length >= MAX_ATTACHMENTS && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {MAX_ATTACHMENTS}/{MAX_ATTACHMENTS} archivos adjuntos
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar reporte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Lint the file**

Run: `pnpm exec eslint packages/ui/src/components/BugReportDialog.jsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/BugReportDialog.jsx
git commit -m "feat(ui): show bug-report context and let users attach files"
```

---

### Task 4: Host — track attachments, convert to data URLs, send

**Files:**
- Modify: `apps/desktop/src/components/BugReportHost.jsx`

- [ ] **Step 1: Replace the file's full contents**

```jsx
import { useEffect, useState } from "react";
import { BugReportDialog, onBugReportRequest } from "@runly/ui";
import { useAuth } from "../auth/AuthProvider";
import { runly } from "../lib/runly";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Mounted once at the app root (inside AuthProvider, so it has a session to
// send with). Every "Reportar bug" button across the app — ErrorState in
// ~80 screens, plus ApiErrorScreen, plus the persistent BrandFooter/UserMenu
// entry points — just calls requestBugReport() from the shared bus; this is
// the single listener that owns the screenshot capture, the attachment
// files, the dialog and the actual API call.
export function BugReportHost() {
  const { session } = useAuth();
  const [request, setRequest] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => onBugReportRequest((payload) => {
    setRequest(payload);
    setDescription("");
    setError(null);
    setScreenshot(null);
    setAttachments([]);

    (async () => {
      try {
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(document.body, {
          scale: 0.5,
          useCORS: true,
          logging: false,
        });
        setScreenshot(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        // Screenshot is best-effort — the report still sends without it.
      }
    })();
  }), []);

  function close() {
    setRequest(null);
  }

  const context = request?.context ?? window.location.pathname;

  async function handleSubmit() {
    if (!request) return;
    setSubmitting(true);
    setError(null);
    try {
      const attachmentPayloads = await Promise.all(
        attachments.map(async (file) => ({
          filename: file.name,
          mimeType: file.type,
          dataUrl: await fileToDataUrl(file),
        })),
      );
      await runly.support.reportBug(
        {
          context,
          errorMessage: request.message ?? "",
          errorStack: request.stack ?? "",
          componentStack: request.componentStack ?? "",
          url: window.location.href,
          description,
          screenshot,
          attachments: attachmentPayloads,
        },
        session?.access_token,
      );
      close();
    } catch (err) {
      setError(err?.message ?? "No se pudo enviar el reporte.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BugReportDialog
      open={Boolean(request)}
      onOpenChange={(open) => { if (!open) close(); }}
      context={context}
      errorMessage={request?.message ?? ""}
      screenshotDataUrl={screenshot}
      description={description}
      onDescriptionChange={setDescription}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      onSubmit={handleSubmit}
      submitting={submitting}
      error={error}
    />
  );
}
```

- [ ] **Step 2: Lint the file**

Run: `pnpm exec eslint apps/desktop/src/components/BugReportHost.jsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/BugReportHost.jsx
git commit -m "feat(ui): convert bug-report attachments to data URLs and send them"
```

---

### Task 5: Build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full affected test suites**

Run: `node --test packages/validators/src/__tests__/support-schemas.test.js apps/api/src/services/__tests__/support-report-service.test.js`
Expected: all PASS, no failures.

- [ ] **Step 2: Build the desktop web bundle**

Run: `pnpm --filter @runly/desktop run build:web`
Expected: `✓ built in <N>s` with no errors (pre-existing "chunks larger than 500 kB" warnings are expected and unrelated).

- [ ] **Step 3: Manual check — context and attachments UX**

In a running dev session (`pnpm dev:frontend` + `pnpm dev:api`), trigger the bug-report dialog from any existing entry point (an `ErrorState`, the `BrandFooter` icon, or the `UserMenu` item):
1. Confirm a small line of text shows the current module/route context.
2. Attach 2-3 files, mixing at least one image and one non-image (e.g. a `.txt` or `.pdf`). Confirm each appears as a card with name/size and a working remove (X) button.
3. Try to add a 4th file — confirm it's rejected with a toast and the count stays at 3.
4. Try dragging in a disallowed file type (e.g. a `.exe` or `.zip` if you have one handy) — confirm it's rejected with a toast naming the file, and not added to the list.
5. Remove one attachment, confirm the picker reappears once below the cap of 3.
6. Submit the report. If `RUNLY_SUPPORT_EMAIL` + SMTP are configured in this environment, confirm the received email lists all filenames under "Adjuntos" and that every attachment opens correctly; otherwise, confirm the dialog shows the existing "not configured" error message (unchanged behavior) rather than a new/different error.

---

## Self-Review Notes

- **Spec coverage:** Goals 1-4 (§5) are each covered — Task 3 (context display + file picker), Task 1+Task 3 (allowlist/limits, both server and client), Task 2 (email attachments), and Task 1's "never touch Supabase Storage" goal is structural (no file/storage-service import appears anywhere in this plan). Non-goals §6 are respected: nothing here persists attachments, the context field stays read-only (plain `<p>`, no input), the cap is exactly 3, and the automatic screenshot's own capture/naming logic (`screenshotAttachment`, `html2canvas` call) is untouched. Edge cases §23 items 1-6 are each exercised by Task 5's manual checks or are structurally guaranteed (e.g. §23.4 "remove after picking" is just local state, nothing was ever sent). Acceptance criteria §25 items 1-7 map onto Task 5's steps 3-6 plus Task 1/2's automated tests (criterion 6, the combined-size rejection, is covered by an automated test rather than a manual step, since reliably hitting an 18MB combined payload by hand in a browser isn't practical to include as a manual QA step).
- **Placeholder scan:** none — every step shows complete, exact code.
- **Type/name consistency:** `attachments` is the name used consistently for: the Zod field (Task 1), the `payload.attachments` the service reads (Task 2), the `BugReportDialog` prop and local state array of `File` objects (Task 3/4), and the `attachmentPayloads` array of `{filename, mimeType, dataUrl}` sent over the wire (Task 4) — deliberately named differently from the raw `attachments` (File objects) it's derived from, to avoid confusing the two shapes in the same function. `ALLOWED_ATTACHMENT_MIME_TYPES` is spelled identically in both its Task 1 (validator, exported) and Task 3 (dialog, local duplicate) definitions. `MAX_ATTACHMENTS = 3` matches the spec's fixed cap and is defined independently in both the validator (`MAX_ATTACHMENTS`, Task 1) and the dialog (`MAX_ATTACHMENTS`, Task 3) — same value, same reasoning as the MIME-list duplication (§14/Task 3's own code comment cross-references this).
