import { companyFetch } from '../../../lib/companyFetch.js'
import { useEffect, useMemo, useState } from "react";
import { AdvancedFileViewer } from "@runly/ui";

function getBaseUrl(apiBaseUrl) {
  return String(apiBaseUrl ?? "").trim().replace(/\/+$/, "");
}

function toInitials(name) {
  const fullName = String(name ?? "").trim();
  if (!fullName) return "CH";
  const words = fullName.split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? "";
  const second = words.length > 1 ? words[1]?.charAt(0) ?? "" : "";
  return `${first}${second}`.toUpperCase() || "CH";
}

async function resolveSignedUrl({ apiBaseUrl, token, fileAssetId }) {
  if (!fileAssetId) return null;
  const response = await companyFetch(`${getBaseUrl(apiBaseUrl)}/files/${encodeURIComponent(fileAssetId)}/signed-url`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.data?.signedUrl ?? payload?.data?.url ?? null;
}

export default function DriverAvatarCell({ value, row, token, apiBaseUrl }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [openViewer, setOpenViewer] = useState(false);
  const [loading, setLoading] = useState(false);

  const fileAssetId = String(value ?? row?.photo_asset_id_resolved ?? row?.photo_asset_id ?? "").trim() || null;
  const fullName = row?.full_name ?? "";
  const initials = useMemo(() => toInitials(fullName), [fullName]);

  useEffect(() => {
    let cancelled = false;
    if (!fileAssetId || !apiBaseUrl) {
      setPhotoUrl(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadPhoto() {
      setLoading(true);
      try {
        const nextUrl = await resolveSignedUrl({ apiBaseUrl, token, fileAssetId });
        if (!cancelled) setPhotoUrl(nextUrl);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPhoto();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, fileAssetId, token]);

  const cellContent = (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] font-semibold text-[hsl(var(--muted-foreground))] overflow-hidden"
      title={fullName || "Chofer"}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={fullName || "Chofer"} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );

  if (!fileAssetId || !photoUrl) return cellContent;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenViewer(true)}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        disabled={loading}
        aria-label={`Abrir foto de ${fullName || "chofer"}`}
      >
        {cellContent}
      </button>
      <AdvancedFileViewer
        open={openViewer}
        onOpenChange={setOpenViewer}
        files={[
          {
            id: fileAssetId,
            originalName: fullName ? `Foto de ${fullName}` : "Foto de chofer",
            mimeType: "image/jpeg",
          },
        ]}
        activeIndex={0}
        onIndexChange={() => {}}
        onResolveSignedUrl={() => photoUrl}
      />
    </>
  );
}
