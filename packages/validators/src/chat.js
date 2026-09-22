import { z } from "zod";

export const chatCreateConversationSchema = z.object({
  type: z.enum(["direct", "group", "external_support"]).default("direct"),
  title: z.string().trim().min(1).max(200).optional(),
  memberUserIds: z.array(z.string().uuid()).min(1).max(50),
  metadata: z.record(z.unknown()).optional(),
});

export const chatSendMessageSchema = z.object({
  body: z.string().max(10000).nullish().transform(v => v ?? ""),
  messageType: z.enum(["text", "image", "file", "system"]).default("text"),
  metadata: z.record(z.unknown()).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  threadRootId: z.string().uuid().optional(),
  replyToMessageId: z.string().uuid().optional(),
  entityRefs: z.array(z.object({
    entityType: z.enum(["contact", "file", "ledger_account", "hr_employee", "project", "task", "calendar_event", "vehicle", "inventory_item"]),
    recordId: z.string().uuid(),
  })).max(5).optional(),
});

export const chatEditMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

// POST /chat/messages/forward — re-send the given messages (body + attachments)
// into each target conversation as fresh messages tagged metadata.forwardedFrom.
export const chatForwardMessagesSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(30),
  targetConversationIds: z.array(z.string().uuid()).min(1).max(20),
});

export const chatUpdateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["open", "pending", "closed", "archived"]).optional(),
  // .min(1) so an empty string can never be treated as "setting a real emoji"
  // by updateConversation's mutual-exclusion logic (which only special-cases
  // an explicit null as "clear this field," not falsy-but-truthy values).
  avatarFileId: z.string().uuid().nullable().optional(),
  avatarEmoji: z.string().min(1).max(16).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  // Both must be sent together (both a string+uuid, or both null) — enforced
  // in chat-service.js, not here, since Zod can't easily express "both or
  // neither" across two independent optional fields without .refine noise
  // that would obscure the simpler two-field shape for the common case.
  linkedModule: z.string().trim().min(1).max(64).nullable().optional(),
  linkedEntityId: z.string().uuid().nullable().optional(),
});

export const chatAddMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
  role: z.enum(["member", "admin", "operator"]).default("member"),
});

export const chatPresignAttachmentSchema = z.object({
  conversationId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
  // Voice-note length measured client-side at record time. Optional; capped
  // at 24h so a bad value can't be persisted.
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

export const chatGuestSessionSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  websiteId: z.string().uuid().optional(),
  pageUrl: z.string().url().optional(),
  referrer: z.string().url().optional(),
  userAgent: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const chatGuestMessageSchema = z.object({
  body: z.string().min(1).max(10000),
  messageType: z.enum(["text", "image", "file"]).default("text"),
  metadata: z.record(z.unknown()).optional(),
});

export const chatAssignOperatorSchema = z.object({
  operatorUserId: z.string().uuid(),
});

export const chatCreateChannelSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  isPublic: z.boolean().optional().default(false),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "El slug solo puede contener minusculas, numeros y guiones.").optional(),
  memberUserIds: z.array(z.string().uuid()).max(50).optional().default([]),
  linkedModule: z.string().trim().min(1).max(64).optional(),
  linkedEntityId: z.string().uuid().optional(),
});

export const chatCreateChannelRoleSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).max(99),
  permissions: z.record(z.boolean()),
});

export const chatUpdateChannelRoleSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).max(99).optional(),
  permissions: z.record(z.boolean()).optional(),
});

export const chatAssignMemberRoleSchema = z.object({
  roleId: z.string().uuid(),
});

export const chatPinMessageSchema = z.object({
  pinned: z.boolean(),
});

export const chatToggleReactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
  attachmentId: z.string().uuid().nullable().optional(),
});

// Query params for GET /chat/search/messages. Omit conversationId for a global
// search across the caller's conversations; pass it to scope to one.
export const chatMessageSearchQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  offset: z.coerce.number().int().min(0).max(300).optional().default(0),
});

export const chatMuteConversationSchema = z.object({
  muted: z.boolean(),
});

export const chatPinConversationSchema = z.object({
  pinned: z.boolean(),
});

export const chatCreateReportSchema = z.object({
  reportedUserId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  reason: z.enum(["spam", "abuse", "inappropriate", "other"]),
  note: z.string().max(2000).optional(),
  alsoBlock: z.boolean().optional(),
});

export const chatResolveReportSchema = z.object({
  action: z.enum(["dismiss", "disable_user"]),
});

export const callCreateSchema = z.object({
  conversationId: z.string().uuid(),
  kind: z.enum(["AUDIO", "VIDEO"]),
  calendarEventId: z.string().uuid().optional(),
});
