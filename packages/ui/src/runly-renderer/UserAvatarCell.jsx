import { useCallback, useState } from "react";
import { AdvancedFileViewer } from "../components/AdvancedFileViewer.jsx";
import { fetchSignedUrl, fetchUserAvatarSignedUrl, initialsFromName } from "./runly-detail-hero.jsx";

// RunlyTable cell for `type: "image"` columns that also set `avatarUserField`
// (a linked user id) or `avatarSignedUrlPath` (a record-owned photo, e.g.
// "/contacts/:id/avatar/signed-url" with :id = the row id).
// `value` is the small pre-signed "thumb" URL the list endpoint embeds, so the
// cell paints lazily (native loading="lazy", fade-in on load) with no extra
// request; clicking fetches the full-resolution avatar on demand and opens it
// in AdvancedFileViewer. `avatarLabelField` renders initials without a photo.
export function UserAvatarCell({ value, row, column, token, apiBaseUrl, companyId }) {
  const userId = row?.[column.avatarUserField] ? String(row[column.avatarUserField]) : null;
  const ownPath = column.avatarSignedUrlPath && row?.id ? column.avatarSignedUrlPath : null;
  const viewerId = userId ?? (ownPath ? String(row.id) : null);
  const label = column.avatarLabelField ? row?.[column.avatarLabelField] : null;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const hasImage = Boolean(value) && !failed;

  const resolveFull = useCallback(
    () => (userId
      ? fetchUserAvatarSignedUrl(apiBaseUrl, token, userId, companyId, "full")
      : fetchSignedUrl(apiBaseUrl, token, viewerId, companyId, `${ownPath}?variant=full`)),
    [apiBaseUrl, token, userId, viewerId, ownPath, companyId],
  );

  if (!hasImage && !label) {
    return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        disabled={!hasImage || !viewerId}
        aria-label="Ver foto de perfil"
        title={hasImage ? "Ver foto de perfil" : undefined}
        className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] enabled:hover:ring-2 enabled:hover:ring-[hsl(var(--ring))] disabled:cursor-default"
      >
        {!loaded && label ? (
          <span className="text-[11px] font-semibold">{initialsFromName(label)}</span>
        ) : null}
        {hasImage ? (
          <img
            src={value}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        ) : null}
      </button>
      {hasImage && viewerId ? (
        <AdvancedFileViewer
          open={open}
          onOpenChange={setOpen}
          files={[{ id: `avatar-${viewerId}`, originalName: label || "Foto de perfil", mimeType: "image/*" }]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveFull}
        />
      ) : null}
    </>
  );
}
