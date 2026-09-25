import { z } from "zod";

export const callLinkPatchSchema = z.object({
  requireLobby: z.boolean().optional(),
  maxUses: z.number().int().positive().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const callInviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
  // Present only when inviting to a meeting booked ahead of time (runly.chat's
  // "Programar" flow) — lets the invite email show a date instead of implying
  // the call is happening right now.
  scheduledAt: z.string().datetime().nullish(),
  scheduledEndAt: z.string().datetime().nullish(),
});

export const callGuestJoinSchema = z
  .object({
    // nullish: the guest page sends the unused fields as `null`, not `undefined`.
    token: z.string().min(1).max(128).nullish(),
    code: z.string().min(1).max(32).nullish(),
    inviteToken: z.string().min(1).max(128).nullish(),
    displayName: z.string().trim().min(2).max(40),
    email: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform((v) => v || undefined),
  })
  .refine((v) => v.token || v.code || v.inviteToken, {
    message: "Se requiere un enlace, código o invitación.",
  });

export const callRoomMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const callGuestModerationSchema = z.object({
  muted: z.boolean(),
});

export const callTranscriptCommitProposalsSchema = z.object({
  proofToken: z.string().min(1),
  acceptedActionItems: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        projectId: z.string().uuid(),
        assigneeUserId: z.string().uuid().nullish(),
        dueDate: z.string().nullish(),
      }),
    )
    .default([]),
  // calendarId is a deliberate elaboration of TRANSCRIPTION_SPEC.md §7.3's
  // `{ index }`-only shape — CalendarEvent.calendarId is NOT NULL
  // (calendar-event-service.js createEvent), so an accepted event needs a
  // target calendar the same way an accepted task needs a projectId.
  acceptedEvents: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        calendarId: z.string().uuid(),
      }),
    )
    .default([]),
});
