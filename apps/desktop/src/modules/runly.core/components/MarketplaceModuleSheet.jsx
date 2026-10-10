// Marketplace module detail + explicit install/update. The server performs every
// check: preflight (download, SHA-256, signature, ZIP identity/surface,
// compatibility) runs first without side effects, then the official package
// pipeline installs. Steps show the phases the server actually reported.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Badge } from "@runly/ui";
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import { StructureChangesTable, missingDecisions } from "./module-update/StructureChangesTable";
import { COMPATIBILITY_REASONS, DEPENDENCY_STATUS, SCOPE_TEXT, STATE_LABELS, availableAction, stepStatuses } from "../lib/marketplace";
import { ModuleAlerts, TrustBadge, date } from "./MarketplaceBadges";

const STEP_ICONS = { done: CheckCircle2, running: Loader2, failed: XCircle, pending: Circle };
const STEP_TONES = { done: "text-emerald-600", running: "animate-spin text-[hsl(var(--muted-foreground))]", failed: "text-red-600", pending: "text-[hsl(var(--muted-foreground))]" };
const Section = ({ title, children }) => <section className="space-y-1"><p className="text-sm font-medium">{title}</p>{children}</section>;
const List = ({ items }) => <ul className="list-disc pl-5 text-sm">{items.map((item) => <li key={item} className="break-all">{item}</li>)}</ul>;

function Steps({ completed, running, failedPhase }) {
  return (
    <ol className="space-y-1" aria-label="Progreso de instalación">
      {stepStatuses({ completed, running, failedPhase }).map((step) => {
        const Icon = STEP_ICONS[step.status];
        return <li key={step.id} data-step={step.id} data-status={step.status} className="flex items-center gap-2 text-sm"><Icon className={`h-4 w-4 ${STEP_TONES[step.status]}`} aria-hidden="true" />{step.label}</li>;
      })}
    </ol>
  );
}

export function MarketplaceModuleSheet({ entry, token, canManage, blocked, freshness = "fresh", onOpenChange }) {
  const queryClient = useQueryClient();
  const action = availableAction(entry, { canManage, blocked, freshness });
  const [acceptStale, setAcceptStale] = useState(false);
  const isUpdate = action?.type === "update";
  const [grants, setGrants] = useState(() => new Set((entry.services ?? []).map((service) => service.key)));
  const [accepted, setAccepted] = useState(false);
  const [plan, setPlan] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [progress, setProgress] = useState({ completed: [], running: null, failedPhase: null, error: null });
  const needsConsent = !entry.official;
  const fail = (error) => {
    const body = error.details ?? {};
    const structure = body.details?.structure ?? body.structure;
    if (error.status === 409 && structure) { setPlan({ structure }); setProgress((p) => ({ ...p, running: null, failedPhase: null, error: null })); return; }
    setProgress((p) => ({ ...p, running: null, failedPhase: body.details?.phase ?? p.running ?? "downloading", error: { code: body.error ?? "catalog_error", message: body.message ?? error.message } }));
  };
  const preflight = useMutation({
    mutationFn: () => runly.moduleCatalog.preflightV2(entry.key, { version: entry.version }, token),
    onMutate: () => setProgress({ completed: [], running: "downloading", failedPhase: null, error: null }),
    onSuccess: (result) => setProgress({ completed: result.data.phases, running: null, failedPhase: null, error: null }),
    onError: fail,
  });
  const install = useMutation({
    mutationFn: () => {
      const payload = { version: entry.version, confirmation: entry.confirmation, acceptCommunity: needsConsent && accepted, acceptStale: freshness === "stale" && acceptStale, grants: [...grants], ...(plan ? { decisions } : {}) };
      return isUpdate ? runly.moduleCatalog.updateV2(entry.key, payload, token) : runly.moduleCatalog.installV2(entry.key, payload, token);
    },
    onMutate: () => setProgress((p) => ({ ...p, running: "installing", failedPhase: null, error: null })),
    onSuccess: (result) => {
      setProgress({ completed: result.data.phases, running: null, failedPhase: null, error: null });
      toast.success(isUpdate ? `${entry.name} se actualizó a v${entry.version}` : `${entry.name} se instaló`, { description: entry.trustLabel });
      ["module-catalog-v2", "modules", "runtime-modules", "blueprints"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
    onError: fail,
  });
  const checked = progress.completed.includes("preflight");
  const finished = progress.completed.includes("enabled");
  const toggle = (key) => setGrants((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const installBlocked = !checked || (needsConsent && !accepted) || (freshness === "stale" && !acceptStale) || (plan && missingDecisions(plan.structure, decisions).length > 0) || install.isPending || finished;
  const compatibility = entry.compatibility;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle className="break-words">{entry.name ?? entry.key}</SheetTitle>
          <SheetDescription className="break-all">{entry.key} · v{entry.version}{entry.publisher ? ` · ${entry.publisher.displayName} (@${entry.publisher.handle})` : entry.official ? " · Runly" : ""}</SheetDescription>
        </SheetHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-2">
          <div className="flex flex-wrap items-center gap-1.5"><TrustBadge trust={entry.trust} /><Badge variant="secondary">{STATE_LABELS[entry.state] ?? entry.state}</Badge></div>
          <ModuleAlerts entry={entry} />
          {entry.description && <p className="whitespace-pre-line break-words text-sm">{entry.description}</p>}
          {entry.builtIn && <p className="text-sm text-[hsl(var(--muted-foreground))]">Este módulo forma parte de Runly y se actualiza con la plataforma; no se descarga desde el Marketplace.</p>}
          {(entry.state === "update" || entry.installedVersion) && <Section title="Versiones"><p className="text-sm">Instalada: v{entry.installedVersion ?? "—"} · Disponible: v{entry.version}</p></Section>}
          {entry.changelog && <Section title="Cambios"><p className="whitespace-pre-line text-sm text-[hsl(var(--muted-foreground))]">{entry.changelog}</p></Section>}
          {compatibility && (
            <Section title="Compatibilidad">
              <p className="text-sm">{compatibility.compatible ? "Compatible con esta instancia." : `No compatible: ${compatibility.reasons.map((r) => COMPATIBILITY_REASONS[r] ?? r).join(", ")}.`}</p>
              {compatibility.details?.runly && <p className="text-xs text-[hsl(var(--muted-foreground))]">Runly {compatibility.details.runly.current} · requiere ≥ {compatibility.details.runly.min}{compatibility.details.runly.max ? ` y ≤ ${compatibility.details.runly.max}` : ""}</p>}
              {compatibility.details?.dependencies?.length > 0 && <ul className="text-sm">{compatibility.details.dependencies.map((d) => <li key={d.key} className="flex flex-wrap items-center gap-2"><code className="text-xs">{d.key}</code><span className={d.status === "satisfied" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{DEPENDENCY_STATUS[d.status] ?? d.status}</span></li>)}</ul>}
            </Section>
          )}
          {entry.capabilities?.length > 0 && <Section title="Capacidades declaradas"><List items={entry.capabilities} /></Section>}
          {entry.events?.length > 0 && <Section title="Avisos que recibirá"><List items={entry.events} /></Section>}
          {entry.connections?.length > 0 && <Section title="Conexiones que ofrece"><List items={entry.connections.map((c) => c.label || c.target)} /></Section>}
          {entry.publishedAt && <p className="text-xs text-[hsl(var(--muted-foreground))]">Publicado: {date(entry.publishedAt)}</p>}
          {entry.sha256 && <p className="break-all text-xs text-[hsl(var(--muted-foreground))]">ZIP firmado (SHA-256): {entry.sha256}</p>}
          {action && (
            <section className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
              <p className="text-sm font-medium">{isUpdate ? "Actualizar" : "Instalar"}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{SCOPE_TEXT}</p>
              {(progress.completed.length > 0 || progress.running || progress.failedPhase) && <Steps {...progress} />}
              {progress.error && <p role="alert" className="rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">{progress.error.message} <code>({progress.error.code})</code></p>}
              {checked && entry.services?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Datos de otros módulos que podrá usar</p>
                  {entry.services.map((service) => (
                    <label key={service.key} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={grants.has(service.key)} onCheckedChange={() => toggle(service.key)} aria-label={service.label} disabled={finished} />
                      {service.label}{service.mutates && <Badge variant="outline">Escribe datos</Badge>}
                    </label>
                  ))}
                </div>
              )}
              {checked && needsConsent && (
                <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" /> Este módulo no es oficial de Runly</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Lo firma {entry.trust === "managed" ? "un catálogo configurado por la administración de esta instancia" : "el catálogo comunitario"}. «Publicador verificado» confirma la identidad del publicador, no la seguridad del código. Revisa publicador, capacidades y permisos antes de continuar.</p>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Acepto instalar un módulo no oficial" disabled={finished} />
                    <span>Acepto instalar <code className="break-all text-xs">{entry.confirmation}</code></span>
                  </label>
                </div>
              )}
              {checked && freshness === "stale" && (
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <Checkbox checked={acceptStale} onCheckedChange={(value) => setAcceptStale(value === true)} aria-label="Entiendo que el catálogo puede estar desactualizado" disabled={finished} />
                  <span>El catálogo no responde. Entiendo que la última copia verificada puede no incluir revocaciones recientes.</span>
                </label>
              )}
              {plan && <StructureChangesTable rows={plan.structure} decisions={decisions} onChange={setDecisions} disabled={install.isPending} />}
            </section>
          )}
        </div>
        <SheetFooter className="shrink-0 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{finished ? "Cerrar" : "Cancelar"}</Button>
          {action && !checked && <Button disabled={action.disabled || preflight.isPending} onClick={() => preflight.mutate()}>{preflight.isPending ? "Verificando..." : "Verificar"}</Button>}
          {action && checked && !finished && <Button disabled={installBlocked} onClick={() => install.mutate()}>{install.isPending ? "Instalando..." : isUpdate ? "Actualizar" : "Instalar"}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
