import { useCallback, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { AdvancedFileViewer } from "../components/AdvancedFileViewer.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { replacePathTokens } from "./detail-presentation.js";
import { fetchUserAvatarSignedUrl, initialsFromName } from "./runly-detail-hero.jsx";

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
// Optional `column.avatarUserField`: when the row has no own file (`value`),
// falls back to that row field (a linked user id) via the dedicated
// /identity/users/:id/avatar/signed-url route — a user avatar isn't a
// company-scoped file entity the generic route above can resolve.
// Optional `column.avatarLabelField`: row field used to render initials
// instead of a generic icon when there's no photo at all.
// `variant`: "thumb" (table cell, default), "avatar" (list rows, 40px) or
// "cover" (full-width card cover; shows a placeholder instead of "—").
const VARIANT_CLS = {
  thumb: "h-9 w-9 rounded-lg border border-[hsl(var(--border))]",
  avatar: "h-10 w-10 shrink-0 rounded-xl border border-[hsl(var(--border))]",
  cover: "aspect-4/3 w-full",
};

export function ImageAssetCell({ value, row, token, apiBaseUrl, companyId, column, variant = "thumb" }) {
  const fileAssetId = value ? String(value) : null;
  const avatarUserId =
    !fileAssetId && column?.avatarUserField
      ? (row?.[column.avatarUserField] ? String(row[column.avatarUserField]) : null)
      : null;
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
        const res = await fetch(joinUrl(apiBaseUrl, String(column?.signedUrlPath ?? "/files/:id/signed-url").replace(":id", encodeURIComponent(assetId))), {
          headers: buildApiHeaders(token, companyId),
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.signedUrl ?? json?.data?.url ?? null;
      } catch {
        return null;
      }
    },
    [apiBaseUrl, token, companyId, column?.signedUrlPath],
  );

  useEffect(() => {
    let cancelled = false;
    if (!fileAssetId && !avatarUserId) {
      setThumbUrl(null);
      return () => {
        cancelled = true;
      };
    }
    setThumbLoading(true);
    const resolve = fileAssetId
      ? resolveSignedUrl(fileAssetId)
      : fetchUserAvatarSignedUrl(apiBaseUrl, token, avatarUserId, companyId, "thumb");
    resolve.then((url) => {
      if (!cancelled) {
        setThumbUrl(url);
        setThumbLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, avatarUserId, resolveSignedUrl, apiBaseUrl, token, companyId]);

  const handleOpen = useCallback(async () => {
    if (!fileAssetId) {
      if (!avatarUserId) return;
      setViewerFiles([{ id: `user-avatar-${avatarUserId}`, avatarUserId, originalName: "Foto de perfil", mimeType: "image/*" }]);
      setActiveIndex(0);
      setOpen(true);
      return;
    }
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
  }, [fileAssetId, avatarUserId, column?.imagesApiPath, row?.id, apiBaseUrl, token, companyId]);

  const avatarLabel = column?.avatarLabelField ? row?.[column.avatarLabelField] : null;

  if (!fileAssetId && !avatarUserId && !avatarLabel && variant === "thumb") {
    return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  }

  // An own FileAsset opens its files; an avatar fallback opens the
  // full-resolution avatar through the dedicated signed-url route.
  const clickable = Boolean(fileAssetId || (avatarUserId && thumbUrl));

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={viewerLoading || !clickable}
        className={`relative inline-flex items-center justify-center overflow-hidden bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] enabled:hover:border-[hsl(var(--ring))] ${VARIANT_CLS[variant] ?? VARIANT_CLS.thumb}`}
        aria-label="Ver imagen"
      >
        {thumbLoading || viewerLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : avatarLabel ? (
          <span className="text-[11px] font-semibold">{initialsFromName(avatarLabel)}</span>
        ) : (
          <ImageIcon className={variant === "cover" ? "h-8 w-8 opacity-40" : "h-4 w-4"} aria-hidden="true" />
        )}
      </button>

      <AdvancedFileViewer
        open={open}
        onOpenChange={setOpen}
        files={viewerFiles}
        activeIndex={activeIndex}
        onIndexChange={setActiveIndex}
        onResolveSignedUrl={(item) =>
          item?.avatarUserId
            ? fetchUserAvatarSignedUrl(apiBaseUrl, token, item.avatarUserId, companyId, "full")
            : resolveSignedUrl(item?.fileAssetId)
        }
      />
    </>
  );
}
