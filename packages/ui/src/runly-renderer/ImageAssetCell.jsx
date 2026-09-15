import { useCallback, useEffect, useState } from "react";
import { AdvancedFileViewer } from "../components/AdvancedFileViewer.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { replacePathTokens } from "./detail-presentation.js";

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

// Generic "image column" cell for RunlyTable's `type: "image-asset"` columns.
// `column.field` holds a fileAssetId (NOT a ready-to-use URL — unlike the
// existing plain `type: "image"`). Resolves a signed thumbnail URL via the
// shared /files/:id/signed-url endpoint, and on click opens AdvancedFileViewer.
// If `column.imagesApiPath` is set (a path template with an :id token for the
// row's id), clicking fetches that record's full file list first so the viewer
// can navigate next/prev across all of the record's files; otherwise it opens
// with just this one image.
export function ImageAssetCell({ value, row, token, apiBaseUrl, companyId, column }) {
  const fileAssetId = value ? String(value) : null;
  const [thumbUrl, setThumbUrl] = useState(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerFiles, setViewerFiles] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const resolveSignedUrl = useCallback(
    async (assetId) => {
      if (!assetId) return null;
      try {
        const res = await fetch(joinUrl(apiBaseUrl, `/files/${encodeURIComponent(assetId)}/signed-url`), {
          headers: buildApiHeaders(token, companyId),
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.signedUrl ?? json?.data?.url ?? null;
      } catch {
        return null;
      }
    },
    [apiBaseUrl, token, companyId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!fileAssetId) {
      setThumbUrl(null);
      return () => {
        cancelled = true;
      };
    }
    setThumbLoading(true);
    resolveSignedUrl(fileAssetId).then((url) => {
      if (!cancelled) {
        setThumbUrl(url);
        setThumbLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, resolveSignedUrl]);

  const handleOpen = useCallback(async () => {
    if (!fileAssetId) return;
    setViewerLoading(true);
    try {
      if (column?.imagesApiPath && row?.id) {
        const path = replacePathTokens(column.imagesApiPath, { id: row.id });
        const res = await fetch(joinUrl(apiBaseUrl, path), { headers: buildApiHeaders(token, companyId) });
        const json = await res.json().catch(() => null);
        const rows = Array.isArray(json?.data) ? json.data : [];
        const files = rows.map((item) => ({
          id: item.id ?? item.fileAssetId ?? item.file_asset_id,
          fileAssetId: item.fileAssetId ?? item.file_asset_id,
          originalName: item?.fileAsset?.originalName ?? item?.file_asset?.originalName ?? item?.label ?? "Archivo",
          mimeType: item?.fileAsset?.mimeType ?? item?.file_asset?.mimeType ?? "application/octet-stream",
          sizeBytes: item?.fileAsset?.sizeBytes ?? item?.file_asset?.sizeBytes ?? null,
        }));
        const idx = files.findIndex((f) => f.fileAssetId === fileAssetId);
        setViewerFiles(files.length > 0 ? files : [{ id: fileAssetId, fileAssetId, originalName: "Imagen", mimeType: "image/*" }]);
        setActiveIndex(idx >= 0 ? idx : 0);
      } else {
        setViewerFiles([{ id: fileAssetId, fileAssetId, originalName: "Imagen", mimeType: "image/*" }]);
        setActiveIndex(0);
      }
      setOpen(true);
    } finally {
      setViewerLoading(false);
    }
  }, [fileAssetId, column?.imagesApiPath, row?.id, apiBaseUrl, token, companyId]);

  if (!fileAssetId) {
    return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={viewerLoading}
        className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ring))]"
        aria-label="Ver imagen"
      >
        {thumbLoading || viewerLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold">IMG</span>
        )}
      </button>

      <AdvancedFileViewer
        open={open}
        onOpenChange={setOpen}
        files={viewerFiles}
        activeIndex={activeIndex}
        onIndexChange={setActiveIndex}
        onResolveSignedUrl={(item) => resolveSignedUrl(item?.fileAssetId)}
      />
    </>
  );
}
