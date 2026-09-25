// Mirrors apps/desktop/src/modules/runly.chat/hooks/useChatUpload.js's
// presign+PUT flow, but for the unauthenticated call-guest surface: it takes
// `presignAttachment` (from useGuestCall, already bound to the guest's own
// session token) instead of reading a member session from useAuth(). See
// docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md.
export function useGuestChatUpload(presignAttachment) {
  async function uploadFile(file) {
    const mimeType = file.type || "application/octet-stream";
    const { attachmentId, uploadUrl } = await presignAttachment({
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    });

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return attachmentId;
  }

  return { uploadFile };
}
