import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// iOS Safari sometimes reports empty file.type for QuickTime videos (.MOV) and other formats.
// Fall back to extension-based detection so the bucket MIME check passes.
const EXT_MIME = {
  mov: "video/quicktime",  mp4: "video/mp4",   m4v: "video/x-m4v",
  avi: "video/x-msvideo", mkv: "video/x-matroska", webm: "video/webm",
  jpg: "image/jpeg",      jpeg: "image/jpeg",  png: "image/png",
  gif: "image/gif",       webp: "image/webp",  heic: "image/heic",
  pdf: "application/pdf",
  mp3: "audio/mpeg",      m4a: "audio/mp4",    ogg: "audio/ogg",
  wav: "audio/wav",       aac: "audio/aac",
  txt: "text/plain",
  zip: "application/zip",
};

function resolveMime(file) {
  if (file.type) return file.type;
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export function useChatUpload(conversationId) {
  const { session } = useAuth();

  async function uploadFile(file) {
    const mimeType = resolveMime(file);

    // Voice notes carry their real length, measured at record time — the
    // player then never has to probe a MediaRecorder blob (webm/opus has no
    // Duration element).
    const durationMs = Number.isFinite(file?.voiceDurationMs)
      ? Math.round(file.voiceDurationMs)
      : undefined;

    const res = await runly.chat.presignAttachment(
      {
        conversationId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        ...(durationMs != null ? { durationMs } : {}),
      },
      session?.access_token,
    );

    const { attachmentId, uploadUrl } = res.data;

    // iOS Safari's fetch() unreliably uploads a Blob/File body assembled from
    // more than one underlying part — exactly what a voice note becomes,
    // since stopRecording() calls requestData() right before stop() (a
    // separate iOS workaround) which forces two dataavailable chunks into the
    // recorded Blob instead of one. Sending a plain ArrayBuffer sidesteps the
    // bug (and gives fetch an exact Content-Length) for every upload, not
    // just voice notes; buffering first is cheap at the 50MB attachment cap.
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: await file.arrayBuffer(),
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    return attachmentId;
  }

  // Discard an already-presigned/uploaded attachment that never got sent
  // (composer "remove", or the composer unmounting with unsent uploads).
  // Best-effort: the worker's orphan sweep is the backstop.
  async function deleteUpload(attachmentId) {
    if (!attachmentId) return;
    await runly.chat.deleteAttachment(attachmentId, session?.access_token);
  }

  return { uploadFile, deleteUpload };
}
