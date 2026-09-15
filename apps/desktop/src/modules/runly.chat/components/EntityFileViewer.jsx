// apps/desktop/src/modules/runly.chat/components/EntityFileViewer.jsx
// Generic AdvancedFileViewer wrapper for arbitrary runly.files records reached
// through a chat entity reference (or a picker preview) — as opposed to
// ChatAttachmentViewer.jsx, which is for real chat_attachments rows and uses
// the chat-specific getAttachmentSignedUrl endpoint. This resolves through
// the generic GET /files/:id/signed-url endpoint instead (the same one
// useFileRefSignedUrl.js uses elsewhere in this module), giving file-type
// entity references the same rich image/PDF/video/audio viewer real
// attachments already get, instead of a plain download link.
import { useCallback, useRef } from "react";
import { useOfficeActions } from "@runly/ui";
import { AdvancedFileViewer } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

export function EntityFileViewer({ open, onOpenChange, files, activeIndex = 0, onIndexChange, onOpenInOffice = null, canOpenInOffice = null }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const office = useOfficeActions();
  const resolvedOnOpenInOffice =
    onOpenInOffice ?? ((f) => office?.enabled && office.open(f.id));
  const fullUrlCacheRef = useRef(new Map());

  const resolveSignedUrl = useCallback(
    async (file) => {
      const cached = fullUrlCacheRef.current.get(file.id);
      if (cached) return cached;
      try {
        const res = await runly.files.getSignedUrl(file.id, token, { variant: "full" });
        const url = res?.data?.signedUrl ?? null;
        if (url) fullUrlCacheRef.current.set(file.id, url);
        return url;
      } catch (err) {
        console.warn("[chat] EntityFileViewer getSignedUrl failed", { id: file.id, status: err?.status, msg: err?.message });
        return null;
      }
    },
    [token],
  );

  return (
    <AdvancedFileViewer
      open={open}
      onOpenChange={onOpenChange}
      files={files ?? []}
      activeIndex={activeIndex}
      onIndexChange={onIndexChange}
      onResolveSignedUrl={resolveSignedUrl}
      onOpenInOffice={resolvedOnOpenInOffice}
      canOpenInOffice={canOpenInOffice}
      zIndex={10000}
    />
  );
}
