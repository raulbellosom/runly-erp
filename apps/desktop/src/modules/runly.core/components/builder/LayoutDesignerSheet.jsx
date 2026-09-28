// Module Builder — "Diseño" of one entity: tabs/sections/fields tree (form,
// and optionally an independent detail tree), visibility rules, detail
// header/KPIs and open mode, next to a live preview that re-renders on every
// change. Works on a local draft written to the definition on "Guardar diseño".
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SwitchField,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@runly/ui";
import { ChevronDown, Eye, Settings2 } from "lucide-react";
import {
  createDefaultLayout,
  disableDetailTree,
  enableDetailTree,
  hasDetailTree,
  pruneLayout,
  relatedSources,
  treeOf,
  withTree,
} from "../../lib/layoutHelpers";
import { LayoutTree } from "./LayoutTree";
import { LayoutDetailPanel } from "./LayoutDetailPanel";
import { RuleDialog } from "./RuleDialog";
import { LayoutRealPreview } from "./preview/LayoutRealPreview";

function DetailSettings({ draft, entity, readOnly, onChange, onPatchField }) {
  const [open, setOpen] = useState(false);
  const hero = draft.detail?.hero;
  const summary = [
    draft.mode === "page" ? "Página completa" : draft.mode === "sheet" ? "Ventana lateral" : "Apertura automática",
    hero?.titleField ? "con encabezado" : "sin encabezado",
    draft.detail?.kpis?.length ? `${draft.detail.kpis.length} indicador(es)` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <button type="button" className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Settings2 className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Encabezado del detalle y apertura</span>
          <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-[hsl(var(--border))] p-3">
          <LayoutDetailPanel layout={draft} entity={entity} readOnly={readOnly} onChange={onChange} onPatchField={onPatchField} />
        </div>
      )}
    </div>
  );
}

export function LayoutDesignerSheet({ open, onOpenChange, moduleKey, entities = [], entity, readOnly, onSave, onPatchField }) {
  const [draft, setDraft] = useState(null);
  // Small screens switch between structure and preview; large ones show both.
  const [pane, setPane] = useState("structure");
  const [target, setTarget] = useState("form");
  const [ruleEdit, setRuleEdit] = useState(null);

  useEffect(() => {
    if (!open) return;
    const fieldKeys = (entity.fields ?? []).map((field) => field.key);
    setDraft(entity.layout ? pruneLayout(entity.layout, fieldKeys) : createDefaultLayout(entity));
    setPane("structure");
    setTarget("form");
    // Only re-seed when the sheet opens: autosave re-renders must not wipe
    // the draft being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewEntity = useMemo(() => ({ ...entity, layout: draft }), [entity, draft]);
  const detailOwnTree = hasDetailTree(draft);
  const editingDetailTree = target === "detail" && detailOwnTree;
  const tree = draft ? treeOf(draft, editingDetailTree ? "detail" : "form") : null;

  function changeTree(nextTree) {
    setDraft((current) => withTree(current, editingDetailTree ? "detail" : "form", nextTree));
  }

  function save() {
    onSave(draft);
    onOpenChange(false);
  }

  function reset() {
    onSave(undefined);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-[min(96vw,1440px)]">
        <SheetHeader className="shrink-0 space-y-3 pb-3 pr-8">
          <div>
            <SheetTitle>Diseño de {entity.label}</SheetTitle>
            <SheetDescription>Organiza cómo se ve el formulario y el detalle. La vista previa se actualiza al instante.</SheetDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={target} onValueChange={setTarget}>
              <TabsList>
                <TabsTrigger value="form">Formulario</TabsTrigger>
                <TabsTrigger value="detail">Detalle</TabsTrigger>
              </TabsList>
            </Tabs>
            {target === "detail" && (
              <SwitchField
                label="Detalle con diseño propio"
                checked={detailOwnTree}
                disabled={readOnly}
                onChange={(checked) => setDraft((current) => (checked ? enableDetailTree(current) : disableDetailTree(current)))}
              />
            )}
            <Tabs value={pane} onValueChange={setPane} className="ml-auto lg:hidden">
              <TabsList>
                <TabsTrigger value="structure">Estructura</TabsTrigger>
                <TabsTrigger value="preview">Vista previa</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </SheetHeader>

        {draft && (
          <div className="-mx-6 grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className={`min-h-0 space-y-4 overflow-y-auto px-6 py-2 lg:border-r lg:border-[hsl(var(--border))] ${pane === "preview" ? "hidden lg:block" : ""}`}>
              <DetailSettings draft={draft} entity={entity} readOnly={readOnly} onChange={setDraft} onPatchField={onPatchField} />
              {target === "detail" && !detailOwnTree ? (
                <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  El detalle usa las mismas pestañas y secciones que el formulario. Activa "Detalle con diseño propio" para organizarlo por separado.
                </p>
              ) : (
                <LayoutTree
                  layout={tree}
                  entity={entity}
                  readOnly={readOnly}
                  onChange={changeTree}
                  onEditRule={setRuleEdit}
                  relatedOptions={relatedSources({ entities }, entity.key)}
                />
              )}
            </div>
            <div className={`min-h-0 overflow-y-auto bg-[hsl(var(--muted))]/30 px-6 py-2 ${pane === "structure" ? "hidden lg:block" : ""}`}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                <Eye className="h-3.5 w-3.5" />
                Vista previa del {target === "form" ? "formulario" : "detalle"} con datos de ejemplo
              </p>
              <LayoutRealPreview moduleKey={moduleKey} entities={entities} entity={previewEntity} kind={target} />
            </div>
          </div>
        )}

        <div className="-mx-6 mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-6 pt-3">
          {!readOnly && entity.layout ? (
            <Button variant="ghost" onClick={reset}>Usar diseño automático</Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? "Cerrar" : "Cancelar"}</Button>
            {!readOnly && <Button onClick={save}>Guardar diseño</Button>}
          </div>
        </div>
      </SheetContent>

      <RuleDialog
        open={Boolean(ruleEdit)}
        onOpenChange={(next) => !next && setRuleEdit(null)}
        title={ruleEdit?.title ?? ""}
        rule={ruleEdit?.rule ?? null}
        fields={entity.fields ?? []}
        excludeFields={ruleEdit?.excludeFields ?? []}
        onSave={(rule) => changeTree(ruleEdit.apply(rule))}
      />
    </Sheet>
  );
}
