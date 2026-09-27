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
  Badge,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@runly/ui";
import { AlertTriangle, Rocket } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../../lib/runly";

export function PublishDialog({ open, onOpenChange, projectId, token, moduleKey, onPublished }) {
  const queryClient = useQueryClient();
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) { setImpact(null); setBlocked(null); setResult(null); return; }
    setLoading(true);
    runly.builder.getPublishImpact(projectId, token)
      .then((res) => setImpact(res.data))
      .catch((err) => toast.error(err.message ?? "No se pudo calcular el impacto."))
      .finally(() => setLoading(false));
  }, [open, projectId, token]);

  async function handlePublish() {
    setPublishing(true);
    setBlocked(null);
    try {
      const res = await runly.builder.publishProject(projectId, token);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publicar {moduleKey}</DialogTitle>
          <DialogDescription>
            {impact?.action === "UPDATE" ? "Se actualizará el módulo ya instalado." : "Se instalará un módulo nuevo en esta instancia."}
          </DialogDescription>
        </DialogHeader>

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
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={impact.action === "UPDATE" ? "outline" : "default"}>{impact.action}</Badge>
              <span>{impact.currentVersion ?? "—"} → {impact.nextVersion}</span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{impact.schemaNote}</p>
          </div>
        )}

        {blocked && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Publicación bloqueada — cambios destructivos</AlertTitle>
            <AlertDescription>
              <p className="mb-1">El borrador no se publicó. El módulo instalado y tus cambios siguen intactos.</p>
              {Array.isArray(blocked.operations) && blocked.operations.some((op) => op.safety === "DESTRUCTIVE" || op.safety === "UNSUPPORTED") && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {blocked.operations
                    .filter((op) => op.safety === "DESTRUCTIVE" || op.safety === "UNSUPPORTED")
                    .map((op, i) => (
                      <li key={i}>
                        {op.type} — {op.table}{op.column ? `.${op.column}` : ""}
                      </li>
                    ))}
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result ? "Cerrar" : "Cancelar"}</Button>
          {!result && (
            <Button onClick={handlePublish} disabled={publishing || loading}>
              {publishing ? "Publicando..." : "Publicar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
