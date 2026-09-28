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
// (~20-25MB). Covers 3 attachments at their individual per-file maximum
// with zero screenshot (21,000,000 chars, comfortably under this cap) —
// the advertised "up to 3 files" is always achievable on its own. It does
// NOT cover the rarer combination of 3 max-size attachments PLUS a maximal
// screenshot simultaneously (~24,000,000 chars) — that specific worst case
// still gets a clear, actionable validation error (see the superRefine
// below) rather than a silent SMTP bounce, which was judged an acceptable
// trade-off: raising this cap further to cover even that combination would
// leave too little margin under real SMTP relay limits once MIME base64
// line-wrapping overhead (~2-3%) and email headers are added.
const MAX_TOTAL_ATTACHMENTS_DATA_URL_LENGTH = 22_000_000;

const attachmentSchema = z
  .object({
    filename: z.string().trim().min(1).max(200).refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
      message: "El nombre del archivo contiene caracteres no permitidos.",
    }),
    mimeType: z.string().refine((value) => ALLOWED_ATTACHMENT_MIME_TYPES.has(value), {
      message: "Tipo de archivo no permitido.",
    }),
    dataUrl: z.string().max(MAX_ATTACHMENT_DATA_URL_LENGTH),
  })
  // This only checks that mimeType and dataUrl are consistent with each
  // other, not that dataUrl's actual bytes match mimeType — it catches an
  // accidental client-side mismatch (e.g. a picker bug), not a client that
  // deliberately crafts both fields together. Real content-sniffing
  // (inspecting magic bytes) was judged out of scope for this feature given
  // the threat model (an authenticated Runly user emailing their own
  // company's support inbox, never executed or stored server-side) — noted
  // here so nothing downstream assumes this is a content-integrity guarantee.
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
