import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "./Button.jsx";
import { FieldWrapper } from "./form-field-base.jsx";
import { ImageSourceSheet } from "./ImageSourceSheet.jsx";
import { CameraCaptureDialog } from "./CameraCaptureDialog.jsx";
import { useCoarsePointer } from "../hooks/usePointerCapabilities.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";

const ACCEPT = {
  image: "image/*",
  document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.xml,.zip",
  any: undefined,
};

function joinUrl(baseUrl, path) {
  return `${String(baseUrl ?? "").replace(/\/+$/, "")}${path}`;
}

async function readJson(response) {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

export async function fetchFileAssetUrl({ apiBaseUrl, token, companyId, fileId, signedUrlPath }) {
  if (!fileId || !signedUrlPath) return null;
  const path = signedUrlPath.replace(":id", encodeURIComponent(fileId));
  const response = await fetch(joinUrl(apiBaseUrl, path), { headers: buildApiHeaders(token, companyId) });
  if (!response.ok) return null;
  const payload = await readJson(response);
  return payload?.data?.signedUrl ?? payload?.data?.url ?? null;
}

function useFileAssetUrl({ fileId, enabled, ...request }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!fileId || !enabled) return undefined;
    fetchFileAssetUrl({ ...request, fileId }).then((next) => {
      if (!cancelled) setUrl(next);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, enabled, request.signedUrlPath, request.apiBaseUrl]);
  return url;
}

// Form field for RME3 `file` fields. The value is a FileAsset id: picking a
// file uploads it right away to the module-scoped `filesPath` and stores the
// returned id. `accept: "image"` + `camera` offers camera capture
// (ImageSourceSheet on touch, CameraCaptureDialog on desktop).
export function FileAssetField({
  label,
  fieldName,
  required,
  hint,
  error,
  value,
  onChange,
  accept = "any",
  camera = false,
  maxSizeMB = 10,
  filesPath,
  signedUrlPath,
  apiBaseUrl,
  token,
  companyId = null,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const coarsePointer = useCoarsePointer();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [meta, setMeta] = useState(null);
  const isImage = accept === "image";
  const previewUrl = useFileAssetUrl({ fileId: value, enabled: isImage, apiBaseUrl, token, companyId, signedUrlPath });

  async function upload(file) {
    if (!file) return;
    setUploadError("");
    if (file.size > maxSizeMB * 1024 * 1024) {
      setUploadError(`El archivo supera el límite de ${maxSizeMB} MB.`);
      return;
    }
    if (isImage && !String(file.type).startsWith("image/")) {
      setUploadError("Selecciona una imagen.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (fieldName) formData.append("field", fieldName);
      const response = await fetch(joinUrl(apiBaseUrl, filesPath), {
        method: "POST",
        headers: buildApiHeaders(token, companyId),
        body: formData,
      });
      const payload = await readJson(response);
      if (!response.ok || !payload?.data?.id) throw new Error(payload?.error ?? "No se pudo subir el archivo.");
      setMeta({ name: payload.data.originalName ?? file.name });
      onChange?.(payload.data.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  }

  function pick() {
    if (isImage && camera && coarsePointer) setSourceOpen(true);
    else inputRef.current?.click();
  }

  const PlaceholderIcon = isImage ? ImageIcon : FileText;

  return (
    <FieldWrapper label={label} required={required} hint={hint} error={error || uploadError}>
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] p-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" />
          ) : previewUrl ? (
            <img src={previewUrl} alt={label ?? "Imagen"} className="h-full w-full object-cover" />
          ) : (
            <PlaceholderIcon className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm text-[hsl(var(--muted-foreground))]">
            {uploading ? "Subiendo..." : value ? (meta?.name ?? "Archivo cargado") : `Sin archivo (máx. ${maxSizeMB} MB)`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={disabled || uploading || !filesPath} onClick={pick}>
              <Upload className="h-4 w-4" /> {value ? "Reemplazar" : "Seleccionar"}
            </Button>
            {isImage && camera && !coarsePointer ? (
              <Button type="button" size="sm" variant="secondary" disabled={disabled || uploading || !filesPath} onClick={() => setCameraOpen(true)}>
                <Camera className="h-4 w-4" /> Tomar foto
              </Button>
            ) : null}
            {value ? (
              <Button type="button" size="sm" variant="ghost" disabled={disabled || uploading} onClick={() => { setMeta(null); onChange?.(null); }}>
                <X className="h-4 w-4" /> Quitar
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[accept]}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          upload(file);
        }}
      />
      <ImageSourceSheet open={sourceOpen} onOpenChange={setSourceOpen} onPickFile={upload} />
      <CameraCaptureDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={upload} fileName={label ?? "foto"} />
    </FieldWrapper>
  );
}

// Read-only display for `file-asset` detail fields: thumbnail for images,
// a download chip for documents.
export function FileAssetValue({ value, accept = "any", signedUrlPath, apiBaseUrl, token, companyId = null }) {
  const isImage = accept === "image";
  const url = useFileAssetUrl({ fileId: value, enabled: isImage, apiBaseUrl, token, companyId, signedUrlPath });
  if (!value) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="Imagen" className="h-24 w-24 rounded-lg object-cover" />
      </a>
    ) : (
      <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-[hsl(var(--muted))]">
        <ImageIcon className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }
  async function open() {
    const signed = await fetchFileAssetUrl({ apiBaseUrl, token, companyId, fileId: value, signedUrlPath });
    if (signed) window.open(signed, "_blank", "noopener");
  }
  return (
    <Button type="button" size="sm" variant="secondary" onClick={open}>
      <FileText className="h-4 w-4" /> Ver archivo
    </Button>
  );
}
