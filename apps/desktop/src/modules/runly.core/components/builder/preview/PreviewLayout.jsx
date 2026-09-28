// Module Builder preview — layout-aware body for FORM/DETAIL previews: tab
// strip, titled sections with 1-3 columns, attachments placeholder, and the
// detail hero + KPI strip. Mirrors what compiler/templates/layout-views.js emits.
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@runly/ui";
import { Image as ImageIcon, Paperclip, Upload } from "lucide-react";
import { FieldValue, WIDE_TYPES, formatPlain } from "./previewPrimitives";

const GRID = { 1: "grid gap-4", 2: "grid gap-4 sm:grid-cols-2", 3: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" };

function AttachmentsPlaceholder({ label }) {
  return (
    <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
      <Paperclip className="h-4 w-4" />
      {label}: arrastra archivos o haz clic para subirlos
    </div>
  );
}

export function PreviewLayoutBody({ layout, fieldsByKey, renderField }) {
  const [active, setActive] = useState(layout.tabs[0]?.key);
  const current = layout.tabs.find((tab) => tab.key === active) ?? layout.tabs[0];
  return (
    <div className="space-y-4 p-5">
      {layout.tabs.length > 1 && (
        <Tabs value={current.key} onValueChange={setActive}>
          <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden scrollbar-none">
            {layout.tabs.map((tab) => <TabsTrigger key={tab.key} value={tab.key}>{tab.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      {current.sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <h4 className="text-sm font-semibold">{section.label}</h4>
          {section.type === "attachments" ? (
            <AttachmentsPlaceholder label={section.label} />
          ) : section.type === "related" ? (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
              Lista de {section.label.toLowerCase()} de este registro (solo en el detalle).
            </div>
          ) : (
            <div className={GRID[section.columns ?? 2] ?? GRID[2]}>
              {(section.fields ?? []).map((key) => fieldsByKey.get(key)).filter(Boolean).map((field) => (
                <div key={field.key} className={WIDE_TYPES.has(field.type) ? "sm:col-span-full" : ""}>
                  {renderField(field)}
                </div>
              ))}
              {!section.fields?.length && <p className="text-xs text-[hsl(var(--muted-foreground))]">Sección vacía.</p>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function PreviewHero({ layout, fieldsByKey, row }) {
  const hero = layout.detail?.hero;
  const kpis = layout.detail?.kpis ?? [];
  if (!hero?.titleField && !kpis.length) return null;
  const subtitle = (hero?.subtitleFields ?? []).map((key) => formatPlain(fieldsByKey.get(key) ?? {}, row[key])).filter(Boolean).join(" · ");
  return (
    <div className="space-y-3 border-b border-[hsl(var(--border))] px-5 py-4">
      {hero?.titleField && (
        <div className="flex items-center gap-4">
          {hero.imageField && (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--muted))]">
              <ImageIcon className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <h3 className="truncate text-lg font-semibold">{formatPlain(fieldsByKey.get(hero.titleField) ?? {}, row[hero.titleField]) || "Título del registro"}</h3>
            {subtitle && <p className="truncate text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>}
            {hero.statusField && <FieldValue field={fieldsByKey.get(hero.statusField) ?? {}} value={row[hero.statusField]} compact />}
          </div>
        </div>
      )}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.field} className="rounded-xl bg-[hsl(var(--muted))] px-3 py-2">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{kpi.label}</p>
              <p className="text-sm font-semibold tabular-nums">{formatPlain(fieldsByKey.get(kpi.field) ?? {}, row[kpi.field]) || "—"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilePreviewControl({ field }) {
  const Icon = field.accept === "image" ? ImageIcon : Upload;
  return (
    <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
      <Icon className="h-4 w-4" />
      {field.accept === "image" ? (field.camera ? "Seleccionar imagen o tomar foto" : "Seleccionar imagen") : "Seleccionar archivo"}
    </div>
  );
}
