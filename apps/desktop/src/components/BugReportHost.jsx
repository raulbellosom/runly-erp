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
