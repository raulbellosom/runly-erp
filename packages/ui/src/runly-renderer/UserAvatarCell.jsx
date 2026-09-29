import { useCallback, useState } from "react";
import { AdvancedFileViewer } from "../components/AdvancedFileViewer.jsx";
import { fetchUserAvatarSignedUrl, initialsFromName } from "./runly-detail-hero.jsx";

// RunlyTable cell for `type: "image"` columns that also set `avatarUserField`.
// `value` is the small pre-signed "thumb" URL the list endpoint embeds, so the
// cell paints lazily (native loading="lazy", fade-in on load) with no extra
// request; clicking fetches the full-resolution avatar on demand and opens it
// in AdvancedFileViewer.
export function UserAvatarCell({ value, row, column, token, apiBaseUrl, companyId }) {
  const userId = row?.[column.avatarUserField] ? String(row[column.avatarUserField]) : null;
  const label = column.avatarLabelField ? row?.[column.avatarLabelField] : null;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const hasImage = Boolean(value) && !failed;

  const resolveFull = useCallback(
    () => fetchUserAvatarSignedUrl(apiBaseUrl, token, userId, companyId, "full"),
    [apiBaseUrl, token, userId, companyId],
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
        disabled={!hasImage || !userId}
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
      {hasImage && userId ? (
        <AdvancedFileViewer
          open={open}
          onOpenChange={setOpen}
          files={[{ id: `user-avatar-${userId}`, originalName: label || "Foto de perfil", mimeType: "image/*" }]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveFull}
        />
      ) : null}
    </>
  );
}
