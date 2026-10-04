// Module Builder — "Crear módulo" (spec 2026-10-03-rme3-module-platform-v2
// §5 goal 9, plan Task 5.1/5.2): start from a template, from a description
// turned into a draft by MirAI ("Con IA"), or blank. Header and footer stay
// fixed; only the middle scrolls.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, TextareaField,
} from "@runly/ui";
import { AlertTriangle, LayoutTemplate, Sparkles, SquarePlus } from "lucide-react";
import { runly } from "../../../../lib/runly";
import { resolveLucideIcon } from "../../lib/builderHelpers";

const MODES = [
  { key: "template", label: "Desde plantilla", description: "Un módulo listo para usar que puedes ajustar.", icon: LayoutTemplate },
  { key: "ai", label: "Con IA", description: "Describe lo que necesitas y MirAI arma el borrador.", icon: Sparkles },
  { key: "blank", label: "En blanco", description: "Empiezas sin entidades.", icon: SquarePlus },
];

const suggestKey = (name) => {
  const slug = String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return slug ? `custom.${slug}` : "";
};

function TemplateGrid({ templates, value, onChange }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {templates.filter((template) => template.key !== "blank").map((template) => {
        const Icon = resolveLucideIcon(template.icon);
        const active = value === template.key;
        return (
          <button
            key={template.key}
            type="button"
            onClick={() => onChange(template.key)}
            aria-pressed={active}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors ${active ? "border-(--brand-primary) bg-(--brand-primary)/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50"}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{template.label}</span>
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">{template.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DraftPreview({ draft }) {
  const { definition, errors } = draft;
  return (
    <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
      <p className="text-sm font-medium">Borrador de MirAI</p>
      {(definition.entities ?? []).map((entity) => (
        <div key={entity.key} className="space-y-1">
          <p className="text-sm">{entity.label} <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{entity.key}</span></p>
          <div className="flex flex-wrap gap-1">
            {(entity.fields ?? []).map((field) => (
              <Badge key={field.key} variant="outline">{field.label}{field.required ? " *" : ""}</Badge>
            ))}
          </div>
        </div>
      ))}
      {errors?.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Quedan {errors.length} detalle(s) por corregir; podrás revisarlos en el editor antes de publicar.
        </p>
      )}
    </div>
  );
}

export function NewModuleDialog({ open, onOpenChange, token, onCreate, creating }) {
  const [mode, setMode] = useState("template");
  const [template, setTemplate] = useState("visitas");
  const [form, setForm] = useState({ name: "", moduleKey: "", description: "" });
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState(null);

  const capabilitiesQuery = useQuery({
    queryKey: ["module-builder-capabilities", token],
    queryFn: () => runly.builder.getCapabilities(token),
    enabled: open && Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const capabilities = capabilitiesQuery.data?.data;
  const templates = useMemo(() => (Array.isArray(capabilities?.templates) ? capabilities.templates.filter((item) => typeof item === "object") : []), [capabilities]);
  const aiAvailable = Boolean(capabilities?.aiDraft);

  const draftMutation = useMutation({
    mutationFn: async () => {
      const result = await runly.builder.aiDraft(prompt, token);
      return result.data;
    },
    onSuccess: (data) => {
      setDraft(data);
      setForm((current) => ({ ...current, name: current.name || data.definition.name, description: current.description || data.definition.description || "" }));
    },
  });

  const suggestedKey = suggestKey(form.name);
  const canCreate = form.name.trim() && (mode !== "ai" || draft);

  function submit() {
    const base = { name: form.name.trim(), moduleKey: form.moduleKey || undefined, description: form.description };
    if (mode === "ai") onCreate({ ...base, definition: { ...draft.definition, name: form.name.trim(), description: form.description || draft.definition.description } });
    else onCreate({ ...base, template: mode === "blank" ? "blank" : template });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Crear módulo</DialogTitle>
          <DialogDescription>Elige cómo empezar. Podrás editarlo todo después.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Cómo empezar">
            {MODES.map((item) => {
              const disabled = item.key === "ai" && !aiAvailable;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.key}
                  disabled={disabled}
                  onClick={() => setMode(item.key)}
                  className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${mode === item.key ? "border-(--brand-primary) bg-(--brand-primary)/5" : "cursor-pointer border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50"}`}
                >
                  <Icon className="h-4 w-4 text-(--brand-primary)" />
                  <span className="mt-1 block text-sm font-semibold">{item.label}</span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">{disabled ? "La IA no está configurada en esta instancia." : item.description}</span>
                </button>
              );
            })}
          </div>

          {mode === "template" && <TemplateGrid templates={templates} value={template} onChange={setTemplate} />}

          {mode === "ai" && (
            <div className="space-y-2">
              <TextareaField
                id="ai-module-description"
                label="¿Qué necesitas registrar?"
                rows={4}
                value={prompt}
                placeholder="Ej. Quiero llevar el control de las visitas de mis técnicos a clientes: cliente, técnico, fecha, motivo, estado y lo que se hizo."
                onChange={(e) => { setPrompt(e.target.value); setDraft(null); }}
              />
              <div className="flex justify-end">
                <Button variant="outline" disabled={prompt.trim().length < 10 || draftMutation.isPending} onClick={() => draftMutation.mutate()}>
                  <Sparkles className="h-4 w-4" />
                  {draftMutation.isPending ? "Generando..." : draft ? "Generar otra vez" : "Generar borrador"}
                </Button>
              </div>
              {draftMutation.isError && <p className="text-sm text-red-600">{draftMutation.error?.message ?? "La IA no respondió."}</p>}
              {draft && <DraftPreview draft={draft} />}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="new-module-name" label="Nombre" required value={form.name} placeholder="Control de visitas" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField
              id="new-module-key"
              label="Clave del módulo"
              value={form.moduleKey}
              placeholder={suggestedKey || "custom.mi-modulo"}
              hint="Se sugiere a partir del nombre. No podrá cambiarse después."
              onChange={(e) => setForm((f) => ({ ...f, moduleKey: e.target.value }))}
            />
          </div>
          <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canCreate || creating} onClick={submit}>{creating ? "Creando..." : "Crear módulo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
