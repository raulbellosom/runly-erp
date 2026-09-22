import { useFileRefSignedUrl } from "../hooks/useFileRefSignedUrl";
import { ENTITY_TYPE_BY_VALUE } from "../lib/entityReferenceTypes";
import VehicleStatusBadge from "../../runly.fleet/components/VehicleStatusBadge";
import { InventoryStatusBadge } from "../../runly.inventory/components/InventoryStatusBadge";

const STATUS_BADGE_BY_TYPE = {
  vehicle: VehicleStatusBadge,
  inventory_item: InventoryStatusBadge,
};

// One row shared by every connector type's list, in both the "Todos" merged
// search and each type's own filtered list — a cover photo (when the record
// has one, e.g. a vehicle or inventory item) or the type's icon, title,
// subtitle, and a status badge for the types that carry one. Having every
// module render through the same row is the core of this redesign: no
// module gets a plainer or richer picker than another.
export function ConnectorRow({ entityType, opt, isSelected = false, disabled = false, onClick, showTypeLabel = false }) {
  const meta = ENTITY_TYPE_BY_VALUE[entityType];
  const Icon = meta?.Icon;
  const hasPhoto = Boolean(opt.coverImageFileId);
  const { data: photoUrl } = useFileRefSignedUrl(opt.coverImageFileId, "card", hasPhoto);
  const StatusBadge = opt.statusBadgeType ? STATUS_BADGE_BY_TYPE[opt.statusBadgeType] : null;
  const subtitleLine = showTypeLabel && meta
    ? [meta.label, opt.subtitle].filter(Boolean).join(" · ")
    : opt.subtitle;

  return (
    <button
      type="button"
      data-connector-row
      onClick={onClick}
      disabled={disabled}
      title={opt.label}
      className={[
        "flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        isSelected ? "bg-[hsl(var(--primary)/0.1)] ring-1 ring-[hsl(var(--primary))]" : "hover:bg-[hsl(var(--muted))]",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <div className="h-9 w-9 rounded-md overflow-hidden bg-[hsl(var(--muted))] shrink-0 flex items-center justify-center">
        {hasPhoto && photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : Icon ? (
          <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="chat-font-display text-xs font-semibold truncate">{opt.label}</p>
        {subtitleLine && (
          <p className="chat-font-mono text-[10px] text-[hsl(var(--muted-foreground))] truncate">{subtitleLine}</p>
        )}
      </div>
      {StatusBadge && opt.status && <StatusBadge status={opt.status} />}
    </button>
  );
}
