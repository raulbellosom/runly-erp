// apps/api/src/routes/chat/chat-attachments-service.js
//
// Chat attachment upload presigning, signed-URL resolution, and deletion.
// Extracted from chat-service.js on 2026-08-30 to help keep that file
// closer to the CLAUDE.md 1000-line limit (it had reached 1370 lines).
//
// Mirrors the chat-conversation-reads-service.js pattern: a sub-factory
// that receives its dependencies (including the shared signed-URL cache
// helpers) from the parent createChatService() rather than duplicating
// state, since batchSignAvatarUrls/batchSignAttachmentUrls in
// chat-service.js also read/write that same cache.
import crypto from "node:crypto";
import { signedUrlWithVariant } from "../../lib/image-variants.js";
import { ChatServiceError } from "./chat-service-error.js";

export function createChatAttachmentsService({
  prisma,
  supabaseAdmin,
  getUserProfileId,
  assertMember,
  getCachedSignedUrl,
  setCachedSignedUrl,
}) {
  async function presignAttachmentUpload({ authUserId, conversationId, fileName, mimeType, sizeBytes, durationMs = null }) {
    const profileId = await getUserProfileId(authUserId);
    await assertMember(conversationId, profileId);

    const ALLOWED_MIME = [
      /^image\//,
      /^audio\//,
      /^video\//,
      /^application\/pdf$/,
      /^text\/plain$/,
      /^application\/msword$/,
      /^application\/vnd\.openxmlformats/,
      /^application\/zip$/,
      /^application\/x-zip/,
    ];
    const allowed = ALLOWED_MIME.some(re => re.test(mimeType));
    if (!allowed) throw new ChatServiceError("Tipo de archivo no permitido.", 422);
    // 50MB is also the self-hosted Supabase Storage service's own global
    // upload ceiling (the `FILE_SIZE_LIMIT` env var on the storage
    // container) — no per-bucket setting can exceed it, so this check can't
    // be raised for video/audio without a VPS-side config change + storage
    // container restart. Phone camera video clips routinely exceed 50MB even
    // for a few seconds of footage, which is why video/audio uploads fail
    // far more often than photos/docs — the message below says so explicitly
    // instead of a generic "error subiendo archivo".
    const MAX_BYTES = 50 * 1024 * 1024;
    if (sizeBytes > MAX_BYTES) {
      const isMedia = /^(audio|video)\//.test(mimeType);
      throw new ChatServiceError(
        isMedia
          ? "Archivo demasiado grande (max 50 MB). Los videos del celular suelen pesar mas — prueba grabar en menor calidad o recortarlo antes de enviarlo."
          : "Archivo demasiado grande (max 50 MB).",
        422,
      );
    }

    const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
    const objectKey = `conversations/${conversationId}/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await supabaseAdmin.storage
      .from("runly-chat")
      .createSignedUploadUrl(objectKey, { expiresIn: 300 });

    if (error) {
      console.error("[runly.chat] createSignedUploadUrl failed", { bucket: "runly-chat", key: objectKey, error });
      throw new ChatServiceError("Error generando URL de subida.", 500);
    }

    // message_id is NULL until sendMessage links it
    const durationValue = Number.isFinite(durationMs) && durationMs >= 0
      ? Math.round(durationMs)
      : null;

    const attRows = await prisma.$queryRaw`
      INSERT INTO chat_attachments
        (conversation_id, bucket, object_key, file_name, mime_type, size_bytes, duration_ms, uploaded_by_user_id)
      VALUES (
        ${conversationId},
        'runly-chat',
        ${objectKey},
        ${fileName},
        ${mimeType},
        ${sizeBytes},
        ${durationValue},
        ${profileId}
      )
      RETURNING id
    `;

    return {
      attachmentId: attRows[0].id,
      uploadUrl: data.signedUrl,
      token: data.token,
      objectKey,
    };
  }

  async function getAttachmentSignedUrl({ attachmentId, authUserId, variant = "full" }) {
    const profileId = await getUserProfileId(authUserId);

    const rows = await prisma.$queryRaw`
      SELECT a.* FROM chat_attachments a
      INNER JOIN chat_conversation_members ccm
        ON ccm.conversation_id = a.conversation_id AND ccm.user_id = ${profileId} AND ccm.left_at IS NULL
      WHERE a.id = ${attachmentId}
        AND public.runly_chat_user_access(a.conversation_id, ${profileId}::uuid)
      LIMIT 1
    `;
    if (!rows.length) {
      console.error("[runly.chat] getAttachmentSignedUrl: attachment not found or user not member", { attachmentId, profileId });
      throw new ChatServiceError("Adjunto no encontrado.", 404);
    }

    const att = rows[0];

    const cached = getCachedSignedUrl(att.bucket, att.object_key, variant);
    if (cached) return { url: cached };

    const signedUrl = await signedUrlWithVariant(supabaseAdmin, att.bucket, att.object_key, variant);

    if (!signedUrl) {
      console.error("[runly.chat] createSignedUrl failed", { bucket: att.bucket, key: att.object_key });
      throw new ChatServiceError("Error generando URL firmada.", 500);
    }
    setCachedSignedUrl(att.bucket, att.object_key, variant, signedUrl);
    return { url: signedUrl };
  }

  async function removeStorageObject(bucket, objectKey) {
    try {
      const { error } = await supabaseAdmin.storage.from(bucket).remove([objectKey]);
      if (error) {
        console.error("[runly.chat] deleteAttachment: storage remove failed", { bucket, objectKey, error: error.message });
      }
    } catch (err) {
      console.error("[runly.chat] deleteAttachment: storage remove threw", { bucket, objectKey, error: err?.message ?? err });
    }
  }

  async function deleteAttachment({ attachmentId, authUserId }) {
    const profileId = await getUserProfileId(authUserId);

    // Fetch the attachment WITHOUT joining chat_messages: a pending upload
    // (message_id NULL, never linked to a sent message) has no message to join.
    const attRows = await prisma.$queryRaw`
      SELECT id, message_id, bucket, object_key, uploaded_by_user_id
      FROM chat_attachments
      WHERE id = ${attachmentId}
      LIMIT 1
    `;
    if (!attRows.length) throw new ChatServiceError("Archivo no encontrado o sin permiso.", 404);
    const att = attRows[0];

    // ── Pending upload: the uploader can always discard their own un-sent file.
    if (att.message_id == null) {
      if (att.uploaded_by_user_id !== profileId) {
        throw new ChatServiceError("Archivo no encontrado o sin permiso.", 404);
      }
      await removeStorageObject(att.bucket, att.object_key);
      await prisma.$executeRaw`DELETE FROM chat_attachments WHERE id = ${attachmentId}`;
      return { ok: true, pending: true };
    }

    // ── Sent attachment: same message-context rules as before.
    const rows = await prisma.$queryRaw`
      SELECT m.body, m.attachment_count, m.metadata
      FROM chat_messages m
      WHERE m.id = ${att.message_id}
        AND m.sender_user_id = ${profileId}
        AND m.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new ChatServiceError("Archivo no encontrado o sin permiso.", 404);
    const { body, attachment_count: attachmentCount, metadata } = rows[0];

    const isLastAttachment = attachmentCount <= 1;
    const hasBody = Boolean(body && body.trim());
    const hasEntityRefs = Boolean(metadata?.entityRefs?.length);

    if (isLastAttachment && !hasBody && !hasEntityRefs) {
      // This UPDATE (not just the DELETE below) is what makes the change
      // reach other open clients — the frontend's realtime sync
      // (subscribeToMessages in supabaseRealtime.js) is a postgres_changes
      // listener on chat_messages only; chat_attachments has no subscription
      // of its own. Same mechanism deleteMessage already relies on.
      await prisma.$executeRaw`
        UPDATE chat_messages SET deleted_at = NOW(), body = '' WHERE id = ${att.message_id}
      `;
      await prisma.$executeRaw`DELETE FROM chat_attachments WHERE id = ${attachmentId}`;
      await removeStorageObject(att.bucket, att.object_key);
      return { ok: true, messageDeleted: true };
    }

    await prisma.$executeRaw`DELETE FROM chat_attachments WHERE id = ${attachmentId}`;
    await prisma.$executeRaw`
      UPDATE chat_messages SET attachment_count = GREATEST(attachment_count - 1, 0) WHERE id = ${att.message_id}
    `;
    await removeStorageObject(att.bucket, att.object_key);
    return { ok: true, messageDeleted: false };
  }

  return { presignAttachmentUpload, getAttachmentSignedUrl, deleteAttachment };
}
