// Module Builder — "Diseño" of one entity: tabs/sections/fields tree, detail
// hero/KPIs and open mode, with a live preview. Works on a local draft that
// is only written to the definition on "Guardar diseño".
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@runly/ui";
import { createDefaultLayout, pruneLayout } from "../../lib/layoutHelpers";
import { LayoutTree } from "./LayoutTree";
import { LayoutDetailPanel } from "./LayoutDetailPanel";
import { LayoutRealPreview } from "./preview/LayoutRealPreview";

export function LayoutDesignerSheet({ open, onOpenChange, moduleKey, entity, readOnly, onSave }) {
  const [draft, setDraft] = useState(null);
  const [pane, setPane] = useState("structure");
  const [previewKind, setPreviewKind] = useState("form");

  useEffect(() => {
    if (!open) return;
    const fieldKeys = (entity.fields ?? []).map((field) => field.key);
    setDraft(entity.layout ? pruneLayout(entity.layout, fieldKeys) : createDefaultLayout(entity));
    setPane("structure");
    // Only re-seed when the sheet opens: autosave re-renders must not wipe
    // the draft being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewEntity = useMemo(() => ({ ...entity, layout: draft }), [entity, draft]);

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
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-5xl">
        <SheetHeader className="shrink-0 space-y-3 pb-4 pr-8">
          <div>
            <SheetTitle>Diseño de {entity.label}</SheetTitle>
            <SheetDescription>Organiza el formulario y el detalle en pestañas y secciones.</SheetDescription>
          </div>
          <Tabs value={pane} onValueChange={setPane}>
            <TabsList>
              <TabsTrigger value="structure">Estructura</TabsTrigger>
              <TabsTrigger value="preview">Vista previa</TabsTrigger>
            </TabsList>
          </Tabs>
        </SheetHeader>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-1">
          {draft && pane === "structure" && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <LayoutTree layout={draft} entity={entity} readOnly={readOnly} onChange={setDraft} />
              <LayoutDetailPanel layout={draft} entity={entity} readOnly={readOnly} onChange={setDraft} />
            </div>
          )}
          {draft && pane === "preview" && (
            <div className="space-y-4">
              <Tabs value={previewKind} onValueChange={setPreviewKind}>
                <TabsList>
                  <TabsTrigger value="form">Formulario</TabsTrigger>
                  <TabsTrigger value="detail">Detalle</TabsTrigger>
                </TabsList>
              </Tabs>
              <LayoutRealPreview moduleKey={moduleKey} entity={previewEntity} kind={previewKind} />
            </div>
          )}
        </div>

        <div className="-mx-6 mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-6 pt-4">
          {!readOnly && entity.layout ? (
            <Button variant="ghost" onClick={reset}>Usar diseño automático</Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? "Cerrar" : "Cancelar"}</Button>
            {!readOnly && <Button onClick={save}>Guardar diseño</Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
