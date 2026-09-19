import * as LucideIcons from "lucide-react";

function GlyphIcon({ name, className }) {
  const Icon = (name && LucideIcons[name]) || LucideIcons.FileText;
  return <Icon className={className} aria-hidden="true" />;
}

// Presentational only.
//   title    string
//   subtitle string ("" hides it)
//   rows     [{ key, label, value }]
//   imageUrl string | null — signed URL of the record's default/cover image, if any
export function FormPreviewPanel({ title, subtitle, rows, imageUrl, fallbackIcon = "FileText" }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="glass-shell sticky top-4 flex flex-col gap-4 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        <GlyphIcon name={fallbackIcon} className="h-3.5 w-3.5" />
        Vista previa
      </div>
      <div className="flex items-center gap-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl object-cover border border-[hsl(var(--border))]"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted)/0.4)] border border-[hsl(var(--border))]">
            <GlyphIcon name={fallbackIcon} className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[hsl(var(--foreground))]">{title || "—"}</p>
          {subtitle ? <p className="truncate text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
        </div>
      </div>
      {list.length > 0 ? (
        <dl className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
          {list.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[hsl(var(--muted-foreground))]">{row.label}</dt>
              <dd className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{row.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
