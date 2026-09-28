// Module Builder — "Diseño" tree: tabs -> sections -> fields, drawn as nested
// cards (tab = folder card, section = accented card, field = chip) with a
// small legend so authors understand the hierarchy. Section cards live in
// LayoutSectionCard.jsx; rules are edited through `onEditRule` (RuleDialog).
import {
  Badge,
  Button,
  TextField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@runly/ui";
import { ChevronRight, FolderPlus, LayoutGrid, Link2, PanelTop, Paperclip, Plus, TextCursorInput } from "lucide-react";
import {
  addSection,
  addTab,
  canAddTab,
  hasAttachmentsSection,
  moveTab,
  placeField,
  removeTab,
  setTabRule,
  unplacedFields,
  updateTab,
} from "../../lib/layoutHelpers";
import { ConditionButton, FieldChip, FieldMenu, OrderButtons, RuleBadge, SectionCard } from "./LayoutSectionCard";

function fieldSections(layout) {
  return layout.tabs.flatMap((tab) => tab.sections
    .filter((section) => section.type !== "attachments" && section.type !== "related")
    .map((section) => ({ key: section.key, label: layout.tabs.length > 1 ? `${tab.label} / ${section.label}` : section.label })));
}

function Legend() {
  const items = [
    { icon: PanelTop, title: "Pestaña", text: "Divide la pantalla en páginas" },
    { icon: LayoutGrid, title: "Sección", text: "Agrupa campos bajo un título" },
    { icon: TextCursorInput, title: "Campo", text: "Un dato del registro" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[hsl(var(--muted))]/50 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
      {items.map((item, index) => (
        <span key={item.title} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight className="h-3 w-3" />}
          <item.icon className="h-3.5 w-3.5 text-[hsl(var(--foreground))]" />
          <strong className="font-medium text-[hsl(var(--foreground))]">{item.title}</strong>
          <span className="hidden sm:inline">· {item.text}</span>
        </span>
      ))}
    </div>
  );
}

// One menu for everything that can be added to a tab, each with a short
// explanation of what it is.
function AddToTabMenu({ layout, tab, relatedOptions, onChange }) {
  const withAttachments = hasAttachmentsSection(layout);
  const add = (payload) => onChange(addSection(layout, tab.key, payload));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="border-dashed">
          <Plus className="h-3.5 w-3.5" /> Agregar a "{tab.label}"
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuItem onSelect={() => add({ label: "Nueva sección" })}>
          <LayoutGrid className="text-sky-600" />
          <span className="flex flex-col">
            <span>Sección de campos</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Un grupo de campos con título</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={withAttachments} onSelect={() => add({ label: "Documentos", type: "attachments" })}>
          <Paperclip className="text-amber-600" />
          <span className="flex flex-col">
            <span>Documentos adjuntos{withAttachments ? " (ya agregada)" : ""}</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Lista para adjuntar varios archivos sueltos</span>
          </span>
        </DropdownMenuItem>
        {relatedOptions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Registros relacionados (solo detalle)</DropdownMenuLabel>
            {relatedOptions.map((option) => (
              <DropdownMenuItem key={`${option.source.entity}.${option.source.field}`} onSelect={() => add({ label: option.label, type: "related", source: option.source })}>
                <Link2 className="text-violet-600" />
                {option.description}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LayoutTree({ layout, entity, readOnly, onChange, onEditRule, relatedOptions = [] }) {
  const fieldsByKey = new Map((entity.fields ?? []).map((field) => [field.key, field]));
  const targets = fieldSections(layout);
  const unplaced = unplacedFields(layout, entity);
  const multiTab = layout.tabs.length > 1;
  const relatedLabel = (section) => relatedOptions.find((option) => option.source.entity === section.source?.entity && option.source.field === section.source?.field)?.description;

  return (
    <div className="space-y-4">
      <Legend />

      {unplaced.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">Campos sin colocar ({unplaced.length})</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Si no los colocas, aparecerán al final en "Otros datos". Usa el menú (···) para moverlos a una sección.</p>
          {unplaced.map((field) => (
            <FieldChip
              key={field.key}
              field={field}
              menu={readOnly || !targets.length ? null : <FieldMenu label={field.label} targets={targets} onMove={(target) => onChange(placeField(layout, field.key, target))} />}
            />
          ))}
        </div>
      )}

      {layout.tabs.map((tab, index) => (
        <div key={tab.key} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
            <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-(--brand-primary)/10 px-2 py-1 text-xs font-semibold text-(--brand-primary)">
              <PanelTop className="h-3.5 w-3.5" />
              {multiTab ? `Pestaña ${index + 1}` : "Página única"}
            </span>
            <TextField
              className="min-w-40 flex-1"
              aria-label="Nombre de la pestaña"
              placeholder="Nombre de la pestaña"
              value={tab.label}
              disabled={readOnly}
              onChange={(e) => onChange(updateTab(layout, tab.key, { label: e.target.value }))}
            />
            {multiTab ? (
              <>
                <RuleBadge rule={tab.visibleWhen} fieldsByKey={fieldsByKey} />
                {!readOnly && (
                  <ConditionButton
                    label={tab.label}
                    active={Boolean(tab.visibleWhen)}
                    onClick={() => onEditRule({
                      title: tab.label,
                      rule: tab.visibleWhen,
                      excludeFields: tab.sections.flatMap((section) => section.fields ?? []),
                      apply: (rule) => setTabRule(layout, tab.key, rule),
                    })}
                  />
                )}
                <OrderButtons label={tab.label} readOnly={readOnly} onUp={() => onChange(moveTab(layout, tab.key, -1))} onDown={() => onChange(moveTab(layout, tab.key, 1))} onRemove={() => onChange(removeTab(layout, tab.key))} />
              </>
            ) : (
              <Badge variant="outline" className="shrink-0 text-[11px]">Sin barra de pestañas</Badge>
            )}
          </div>
          <div className="space-y-3 p-3">
            {tab.sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                layout={layout}
                fieldsByKey={fieldsByKey}
                targets={targets}
                readOnly={readOnly}
                onChange={onChange}
                onEditRule={onEditRule}
                relatedLabel={section.type === "related" ? relatedLabel(section) : null}
              />
            ))}
            {!tab.sections.length && (
              <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Esta pestaña está vacía.</p>
            )}
            {!readOnly && <AddToTabMenu layout={layout} tab={tab} relatedOptions={relatedOptions} onChange={onChange} />}
          </div>
        </div>
      ))}

      {!readOnly && canAddTab(layout) && (
        <Button size="sm" variant="ghost" onClick={() => onChange(addTab(layout, `Pestaña ${layout.tabs.length + 1}`))}>
          <FolderPlus className="h-4 w-4" /> {multiTab ? "Agregar pestaña" : "Dividir en pestañas (agregar otra)"}
        </Button>
      )}
    </div>
  );
}
