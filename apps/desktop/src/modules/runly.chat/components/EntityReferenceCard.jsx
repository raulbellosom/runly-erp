import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useFileRefSignedUrl } from "../hooks/useFileRefSignedUrl";
import { ENTITY_TYPE_BY_VALUE } from "../lib/entityReferenceTypes";
import VehicleStatusBadge from "../../runly.fleet/components/VehicleStatusBadge";
import { InventoryStatusBadge } from "../../runly.inventory/components/InventoryStatusBadge";

function formatBalance(balance, currency) {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency ?? "MXN" }).format(balance);
  } catch {
    // Unknown/invalid currency code — Intl throws rather than falling back.
    return `${balance} ${currency ?? ""}`.trim();
  }
}

// `attached` is true when this chip immediately follows a text bubble in the
// same message — it then drops its own border/background/top-radius in favor
// of matching whichever bubble color sits above it, so the two read as one
// continuous message instead of a card floating below a separate one. When
// there's no text above it (an entity-ref-only message), it keeps its own
// independent card look since there's nothing to visually continue.
export function EntityReferenceCard({ reference, attached = false, isOwn = false }) {
  const navigate = useNavigate();
  const [avatarErr, setAvatarErr] = useState(false);
  const Icon = ENTITY_TYPE_BY_VALUE[reference.entityType]?.Icon ?? ExternalLink;

  // hr_employee references may carry a real profile photo (or their linked
  // account's avatar) — resolved server-side at send time (see
  // chat-entity-references-service.js), only the signed URL itself is
  // fetched lazily here, same reasoning as file attachments: URLs expire,
  // this metadata is stored forever.
  const hasPhoto = reference.entityType === "hr_employee" && Boolean(reference.photoFileId);
  const { data: photoUrl } = useFileRefSignedUrl(reference.photoFileId, "card", hasPhoto);

  // vehicle/inventory_item references carry their own cover photo (resolved
  // server-side, see chat-entity-references-service.js) — separate hook call
  // from the hr_employee one above since useFileRefSignedUrl's `enabled` gate
  // needs its own fileId/condition pair.
  const hasCoverImage = (reference.entityType === "vehicle" || reference.entityType === "inventory_item") && Boolean(reference.coverImageFileId);
  const { data: coverImageUrl } = useFileRefSignedUrl(reference.coverImageFileId, "card", hasCoverImage);

  const hasBalance = reference.entityType === "ledger_account" && reference.balance != null;
  const hasVehicleStatus = reference.entityType === "vehicle" && Boolean(reference.status);
  const hasInventoryStatus = reference.entityType === "inventory_item" && Boolean(reference.status);

  const attachedClasses = isOwn
    ? "bg-(--brand-primary) text-(--brand-primary-foreground) border-transparent rounded-t-none"
    : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] border-transparent rounded-t-none";
  const standaloneClasses = "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]";
  const mutedTextClass = attached && isOwn ? "opacity-80" : "text-[hsl(var(--muted-foreground))]";

  return (
    <button
      type="button"
      onClick={() => navigate(reference.url)}
      className={[
        "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors max-w-full",
        attached ? attachedClasses : standaloneClasses,
      ].join(" ")}
    >
      {hasPhoto && photoUrl && !avatarErr ? (
        <img
          src={photoUrl}
          alt={reference.title}
          className="h-7 w-7 rounded-full object-cover shrink-0"
          onError={() => setAvatarErr(true)}
        />
      ) : hasCoverImage && coverImageUrl && !avatarErr ? (
        <img
          src={coverImageUrl}
          alt={reference.title}
          className="h-7 w-7 rounded-md object-cover shrink-0"
          onError={() => setAvatarErr(true)}
        />
      ) : (
        <Icon className={["h-3.5 w-3.5 shrink-0", attached && isOwn ? "" : "text-[hsl(var(--muted-foreground))]"].join(" ")} />
      )}
      <div className="min-w-0 flex-1">
        <p className="chat-font-display text-xs font-semibold truncate">{reference.title}</p>
        {reference.subtitle && (
          <p className={["chat-font-mono text-[10px] truncate", mutedTextClass].join(" ")}>
            {reference.subtitle}
          </p>
        )}
      </div>
      {hasBalance && (
        <span className="chat-font-mono text-xs font-bold shrink-0 ml-1 tabular-nums">
          {formatBalance(reference.balance, reference.currency)}
        </span>
      )}
      {hasVehicleStatus && (
        <span className="shrink-0 ml-1">
          <VehicleStatusBadge status={reference.status} />
        </span>
      )}
      {hasInventoryStatus && (
        <span className="shrink-0 ml-1">
          <InventoryStatusBadge status={reference.status} />
        </span>
      )}
    </button>
  );
}
