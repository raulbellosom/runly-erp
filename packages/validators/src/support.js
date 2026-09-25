import { z } from "zod";

// Screenshots are JPEG data URLs produced client-side by html2canvas at a
// reduced scale/quality — a rough ceiling keeps a runaway capture from
// blowing up the email payload, not a precise size guarantee.
const MAX_SCREENSHOT_DATA_URL_LENGTH = 3_000_000;

export const bugReportSchema = z.object({
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
});
