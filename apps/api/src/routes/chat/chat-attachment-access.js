// apps/api/src/routes/chat/chat-attachment-access.js
//
// Shared "can this caller read this chat attachment, and here are its bytes"
// check (spec 2026-09-30-mirai-ledger-hr-fleet §2). Extracted from the
// identical access-check + download duplicated by read_attachment and
// describe_image in mirai-tools.js, so any other MirAI capability that needs
// to read a user-attached file (e.g. runly.ledger's statement import) gets
// the exact same membership check instead of re-deriving it.
export class ChatAttachmentAccessError extends Error {
  constructor(message = "Sin acceso a ese adjunto.", status = 404) {
    super(message);
    this.name = "ChatAttachmentAccessError";
    this.status = status;
  }
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export function createChatAttachmentAccess({ prisma, listMessages, signAttachmentUrl }) {
  // Looks up the attachment row and confirms `ctx` (actorAuthUserId/companyId)
  // is a live member of its conversation (via listMessages), without
  // downloading any bytes. Lets a caller inspect metadata (e.g. mime_type)
  // before deciding whether a download is even worth it — describe_image
  // uses this to reject a non-image attachment without paying for the
  // download. Throws ChatAttachmentAccessError (404-style) on no access.
  async function checkAccess(attachmentId, ctx) {
    const id = String(attachmentId ?? "").trim();
    if (!id) throw new ChatAttachmentAccessError("Falta attachmentId.", 400);
    const [att] = await prisma.$queryRaw`
      SELECT a.id, a.file_name, a.mime_type, a.object_key, a.bucket, a.conversation_id
      FROM chat_attachments a
      WHERE a.id = ${id}::uuid
      LIMIT 1
    `;
    if (!att) throw new ChatAttachmentAccessError();
    try {
      await listMessages({ conversationId: att.conversation_id, authUserId: ctx.actorAuthUserId, companyId: ctx.companyId ?? null, limit: 1, before: null });
    } catch {
      throw new ChatAttachmentAccessError();
    }
    return att;
  }

  // Downloads an already access-checked attachment row's bytes through a
  // service-role signed URL. `maxBytes` lets a caller with a different size
  // budget than the chat default (e.g. runly.ledger's statement import,
  // 15MB like its own HTTP route) override it.
  async function download(att, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const url = await signAttachmentUrl(att.bucket, att.object_key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`descarga fallo (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("archivo demasiado grande");
    return { buffer, name: att.file_name, mimeType: att.mime_type };
  }

  // checkAccess() + download() in one call. Throws ChatAttachmentAccessError
  // (404-style) rather than returning an error shape, since this is meant to
  // be called from a capability's prepare(), which already throws/returns
  // {error} to signal "couldn't prepare this action".
  async function fetchForActor(attachmentId, ctx, opts) {
    const att = await checkAccess(attachmentId, ctx);
    return download(att, opts);
  }

  return { checkAccess, download, fetchForActor };
}
