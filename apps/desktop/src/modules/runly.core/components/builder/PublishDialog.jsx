// Module Builder — publish impact + confirm (Etapa 17). getPublishImpact()
// shows real compiled counts up front; the actual schema-diff safety check
// (additive vs. destructive) is authoritative only at the real publish call
// — nothing here recomputes or promises a plan that publish could later
// contradict. A destructive block leaves the draft and the installed module
// untouched, matching the spec's "Draft must be preserved" rule.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@runly/ui";
import { AlertTriangle, Rocket, Tag } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../../lib/runly";
import { compareVersions, versionOptions } from "../../lib/versionSuggestion";
import { StructureChangesTable, missingDecisions } from "../module-update/StructureChangesTable";

// A blocked plan only needs the admin's decisions when every blocker is one.
const DECIDABLE = new Set(["backfill_required", "conversion_failing_rows"]);
const needsOnlyDecisions = (plan) => !plan?.drift?.length && (plan?.blockers ?? []).length > 0 && plan.blockers.every((entry) => DECIDABLE.has(entry.reason));

// Version step: suggests patch / minor / major from what changed since the
// last publish (lib/versionSuggestion.js) and saves the chosen version into
// the draft right before publishing.
function VersionPicker({ plan, publishedVersion, draftVersion, value, onChange }) {
  if (plan.first) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <Tag className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        Primera publicación: versión <strong>{draftVersion}</strong>.
      </p>
    );
  }
  const options = [...plan.options];
  if (compareVersions(draftVersion, publishedVersion) > 0 && !options.some((option) => option.version === draftVersion)) {
    options.push({ level: "custom", label: "La que escribiste", help: "Definida en la pestaña General.", version: draftVersion });
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Nueva versión <span className="font-normal text-[hsl(var(--muted-foreground))]">(publicada: v{publishedVersion})</span></p>
      {plan.changes.reasons.length > 0 && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Desde la última publicación {plan.changes.reasons.join(", ")}.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Nueva versión">
        {options.map((option) => (
          <button
            key={option.level}
            type="button"
            role="radio"
            aria-checked={value === option.version}
            onClick={() => onChange(option.version)}
            className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors ${value === option.version ? "border-(--brand-primary) bg-(--brand-primary)/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50"}`}
          >
            <span className="flex items-center justify-between gap-1">
              <span className="text-sm font-semibold">v{option.version}</span>
              {option.recommended && <span className="rounded-full bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Recomendada</span>}
            </span>
            <span className="block text-xs font-medium">{option.label}</span>
            <span className="block text-[11px] text-[hsl(var(--muted-foreground))]">{option.help}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PublishDialog({ open, onOpenChange, projectId, token, moduleKey, onPublished, definition, publishedDefinition, publishedVersion, onVersionChange }) {
  const queryClient = useQueryClient();
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const [result, setResult] = useState(null);
  const [version, setVersion] = useState(null);
  const [decisions, setDecisions] = useState({});
  const plan = versionOptions({ publishedVersion, publishedDefinition, definition });

  useEffect(() => {
    if (!open) { setImpact(null); setBlocked(null); setResult(null); setVersion(null); setDecisions({}); return; }
    const draftVersion = definition?.version;
    setVersion(publishedVersion && compareVersions(draftVersion, publishedVersion) > 0 ? draftVersion : plan.suggested);
    setLoading(true);
    runly.builder.getPublishImpact(projectId, token)
      .then((res) => setImpact(res.data))
      .catch((err) => toast.error(err.message ?? "No se pudo calcular el impacto."))
      .finally(() => setLoading(false));
    // The suggestion is computed once per opening, from the draft at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, token]);

  async function handlePublish() {
    setPublishing(true);
    const pendingPlan = blocked && needsOnlyDecisions(blocked) ? blocked : null;
    setBlocked(null);
    try {
      if (version && version !== definition?.version) {
        const next = { ...definition, version };
        await runly.builder.updateDefinition(projectId, { definition: next }, token);
        onVersionChange?.(version);
      }
      const res = await runly.builder.publishProject(projectId, token, pendingPlan ? { decisions } : {});
      setResult(res.data);
      toast.success(res.data.installed ? "Módulo instalado correctamente." : "Módulo actualizado correctamente.");
      onPublished?.();
      queryClient.invalidateQueries({ queryKey: ["module-builder-projects"] });
    } catch (error) {
      // error.details is the SDK's parsed JSON body ({error, message, details}); its inner
      // `details` is module-builder-service.js's ModuleBuilderError.details, which for a
      // publish failure is ModulePackagePublishError's details object — the original
      // schema-diff plan (operations/drift/safety) lives one level deeper, at `.diagnostics`
      // (see module-package-service.js's catch block: `diagnostics: error?.details ?? null`).
      const schemaPlan = error.details?.details?.diagnostics;
      if (error.status === 409 && schemaPlan) {
        setBlocked(schemaPlan);
      } else {
        toast.error(error.message ?? "No se pudo publicar el módulo.");
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header and footer stay fixed; only the middle scrolls (structure decisions can be long). */}
      <DialogContent className="flex max-h-[90dvh] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Publicar {definition?.name || moduleKey}</DialogTitle>
          <DialogDescription>
            {impact?.action === "UPDATE" ? "Se actualizará el módulo ya instalado." : "Se instalará un módulo nuevo en esta instancia."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
        {loading && <Skeleton className="h-32 w-full rounded-xl" />}

        {impact && !result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-[hsl(var(--border))] p-2.5">
                <p className="text-[hsl(var(--muted-foreground))]">Entidades</p>
                <p className="text-lg font-semibold">{impact.entityCount}</p>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] p-2.5">
                <p className="text-[hsl(var(--muted-foreground))]">Campos</p>
                <p className="text-lg font-semibold">{impact.fieldCount}</p>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] p-2.5">
                <p className="text-[hsl(var(--muted-foreground))]">Vistas</p>
                <p className="text-lg font-semibold">{impact.viewCount}</p>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] p-2.5">
                <p className="text-[hsl(var(--muted-foreground))]">Permisos</p>
                <p className="text-lg font-semibold">{impact.permissionCount}</p>
              </div>
            </div>
            <VersionPicker
              plan={plan}
              publishedVersion={publishedVersion}
              draftVersion={definition?.version ?? "0.1.0"}
              value={version}
              onChange={setVersion}
            />
            {!blocked && <p className="text-xs text-[hsl(var(--muted-foreground))]">{impact.schemaNote}</p>}
          </div>
        )}

        {blocked && needsOnlyDecisions(blocked) && (
          <div className="space-y-2">
            <p className="text-sm">Esta versión cambia datos que ya existen. Indica qué hacer y vuelve a publicar; el borrador y el módulo instalado siguen intactos.</p>
            <StructureChangesTable rows={blocked.structure} decisions={decisions} onChange={setDecisions} disabled={publishing} />
          </div>
        )}

        {blocked && !needsOnlyDecisions(blocked) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Publicación bloqueada</AlertTitle>
            <AlertDescription>
              <p className="mb-1">El borrador no se publicó. El módulo instalado y tus cambios siguen intactos.</p>
              {Array.isArray(blocked.structure) && blocked.structure.some((row) => row.blocker) && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {blocked.structure.filter((row) => row.blocker).map((row) => <li key={row.id}>{row.description}</li>)}
                </ul>
              )}
              {Array.isArray(blocked.drift) && blocked.drift.length > 0 && (
                <p className="mt-1">Se detectó una diferencia entre el esquema instalado y el esperado (drift).</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {result && !blocked && (
          <Alert>
            <Rocket className="h-4 w-4" />
            <AlertTitle>Publicado</AlertTitle>
            <AlertDescription>
              Resultado: {result.outcome}. {result.installed ? "El módulo quedó instalado y disponible en Módulos." : "El paquete se actualizó; revisa Módulos para confirmar el estado."}
            </AlertDescription>
          </Alert>
        )}

        {result?.pendingGrants?.length > 0 && (
          <Alert variant="warning">
            <AlertTitle>Automatizaciones pendientes de autorizar</AlertTitle>
            <AlertDescription>
              Un administrador debe autorizar {result.pendingGrants.length === 1 ? "1 servicio" : `${result.pendingGrants.length} servicios`} en Módulos &gt; detalle del módulo para que las automatizaciones funcionen.
            </AlertDescription>
          </Alert>
        )}

        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result ? "Cerrar" : "Cancelar"}</Button>
          {!result && (
            <Button onClick={handlePublish} disabled={publishing || loading || (blocked && (!needsOnlyDecisions(blocked) || missingDecisions(blocked.structure, decisions).length > 0))}>
              {publishing ? "Publicando..." : blocked ? "Publicar con estas decisiones" : version ? `Publicar v${version}` : "Publicar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
