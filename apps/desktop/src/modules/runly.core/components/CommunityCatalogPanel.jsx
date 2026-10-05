// Módulos > "Catálogo v2" (Phase 7): parallel opt-in feed with official,
// community and admin-managed entries. Each trust level has its own icon,
// colour and wording; only "Oficial Runly" uses the official mark. Community
// installs require explicit admin acceptance. Nothing installs or uninstalls
// automatically; offline/stale data shows the last synchronization.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  EmptyState, ErrorState, ModuleNavIcon, Skeleton,
} from "@runly/ui";
import { AlertTriangle, BadgeCheck, Building2, Clock, CloudOff, PackageSearch, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import { StructureChangesTable, missingDecisions } from "./module-update/StructureChangesTable";

const TRUST = {
  official: { icon: BadgeCheck, label: "Oficial Runly", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  "community-verified": { icon: ShieldCheck, label: "Publicador verificado · Comunidad", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  community: { icon: Users, label: "Comunidad · publicador no verificado", className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  managed: { icon: Building2, label: "Catálogo administrado", className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  untrusted: { icon: ShieldAlert, label: "Firma no confiable", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
};
const ALERTS = {
  catalog_v2_rollback: "Se recibió un catálogo más antiguo que el último verificado.",
  catalog_v2_equivocation: "Se recibieron dos catálogos distintos con la misma secuencia.",
  catalog_v2_chain_broken: "El catálogo no continúa la cadena del último verificado.",
  catalog_v2_downgrade: "Se recibió un catálogo v1 donde se esperaba v2.",
  catalog_v2_signature_untrusted: "La firma del catálogo no es de una clave confiable.",
  catalog_v2_invalid: "El catálogo recibido no es válido.",
  catalog_v2_transport_rejected: "La descarga del catálogo fue bloqueada por seguridad.",
};
const REASONS = { runly_version: "Versión de Runly", contracts: "Contratos de compilador/runtime", services: "Servicios no disponibles", events: "Eventos no disponibles", connections: "Conexiones no disponibles", dependencies: "Módulos requeridos no instalados" };
const date = (value) => (value ? new Date(value).toLocaleString() : "—");

export function TrustBadge({ trust }) {
  const meta = TRUST[trust] ?? TRUST.untrusted;
  const Icon = meta.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`} data-trust={trust}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{meta.label}</span>;
}

function InstallDialog({ entry, token, onOpenChange }) {
  const queryClient = useQueryClient();
  const isUpdate = entry.state === "update";
  const [grants, setGrants] = useState(() => new Set((entry.services ?? []).map((service) => service.key)));
  const [accepted, setAccepted] = useState(false);
  const [plan, setPlan] = useState(null);
  const [decisions, setDecisions] = useState({});
  const needsConsent = !entry.official;
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { version: entry.version, confirmation: entry.confirmation, acceptCommunity: needsConsent && accepted, grants: [...grants], ...(plan ? { decisions } : {}) };
      return isUpdate ? runly.moduleCatalog.updateV2(entry.key, payload, token) : runly.moduleCatalog.installV2(entry.key, payload, token);
    },
    onSuccess: () => {
      toast.success(isUpdate ? `${entry.name} se actualizó a v${entry.version}` : `${entry.name} se instaló`, { description: TRUST[entry.trust]?.label });
      ["module-catalog-v2", "modules", "runtime-modules", "blueprints"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      onOpenChange(false);
    },
    onError: (error) => {
      const structure = error.details?.details?.structure ?? error.details?.structure;
      if (error.status === 409 && structure) setPlan({ structure });
      else toast.error(isUpdate ? "No se pudo actualizar" : "No se pudo instalar", { description: error.details?.message ?? error.message });
    },
  });
  const toggle = (key) => setGrants((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const blocked = (needsConsent && !accepted) || (plan && missingDecisions(plan.structure, decisions).length > 0);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isUpdate ? `Actualizar ${entry.name}` : `Instalar ${entry.name}`}</DialogTitle>
          <DialogDescription>{isUpdate ? `De v${entry.installedVersion} a v${entry.version}.` : `Versión ${entry.version}.`} {entry.changelog}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
          <section className="space-y-1">
            <TrustBadge trust={entry.trust} />
            {entry.publisher && <p className="text-sm">Publicador: <strong>{entry.publisher.displayName}</strong> <span className="text-[hsl(var(--muted-foreground))]">@{entry.publisher.handle}</span></p>}
            <p className="text-xs break-all text-[hsl(var(--muted-foreground))]">ZIP firmado: {entry.sha256}</p>
          </section>
          {entry.capabilities?.length > 0 && <section><p className="text-sm font-medium">Capacidades declaradas</p><ul className="list-disc pl-5 text-sm">{entry.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul></section>}
          {entry.services?.length > 0 && (
            <section className="space-y-2">
              <p className="text-sm font-medium">Datos de otros módulos que podrá usar</p>
              {entry.services.map((service) => (
                <label key={service.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={grants.has(service.key)} onCheckedChange={() => toggle(service.key)} aria-label={service.label} />
                  {service.label}{service.mutates && <Badge variant="outline">Escribe datos</Badge>}
                </label>
              ))}
            </section>
          )}
          {entry.events?.length > 0 && <section><p className="text-sm font-medium">Avisos que recibirá</p><ul className="list-disc pl-5 text-sm">{entry.events.map((event) => <li key={event}>{event}</li>)}</ul></section>}
          {entry.connections?.length > 0 && <section><p className="text-sm font-medium">Conexiones que ofrece</p><ul className="list-disc pl-5 text-sm">{entry.connections.map((c) => <li key={`${c.target}-${c.kind}`}>{c.label || c.target}</li>)}</ul></section>}
          {needsConsent && (
            <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" /> Este módulo no es oficial de Runly</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Lo firma {entry.trust === "managed" ? "un catálogo configurado por la administración de esta instancia" : "el catálogo comunitario"}. Revisa publicador, capacidades y permisos antes de continuar.</p>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Acepto instalar un módulo no oficial" />
                <span>Acepto instalar <code className="break-all text-xs">{entry.confirmation}</code></span>
              </label>
            </section>
          )}
          {plan && <StructureChangesTable rows={plan.structure} decisions={decisions} onChange={setDecisions} disabled={mutation.isPending} />}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={mutation.isPending || blocked} onClick={() => mutation.mutate()}>{mutation.isPending ? "Procesando..." : isUpdate ? "Actualizar" : "Instalar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CommunityCatalogPanel({ token, canManage }) {
  const [selected, setSelected] = useState(null);
  const query = useQuery({ queryKey: ["module-catalog-v2", token], queryFn: async () => (await runly.moduleCatalog.listV2(token)).data, enabled: Boolean(token), staleTime: 60 * 1000, retry: false });
  if (query.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>;
  if (query.isError) return <ErrorState title="No se pudo cargar el catálogo v2" description={query.error?.details?.message ?? query.error?.message} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data?.enabled) return <EmptyState icon={PackageSearch} title="Catálogo v2 no habilitado" description="El catálogo oficial sigue en Disponibles. La administración puede habilitar el catálogo v2 (comunidad y catálogos administrados) desde la configuración de la instancia." />;
  const blocked = data.offline || data.stale || Boolean(data.alert);
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Clock className="h-3.5 w-3.5" /> Última sincronización: {date(data.lastSync)} · secuencia {data.sequence} · vigente hasta {date(data.validUntil)}</p>
      {data.offline && <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><CloudOff className="h-4 w-4 shrink-0" /> Sin conexión: se muestra la última información verificada. Las revocaciones posteriores no se conocen hasta volver a sincronizar.</p>}
      {data.stale && <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><Clock className="h-4 w-4 shrink-0" /> La información está vencida; no se instalarán módulos hasta sincronizar un catálogo vigente.</p>}
      {data.alert && <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"><ShieldAlert className="h-4 w-4 shrink-0" /> {ALERTS[data.alert] ?? data.alert} Se conserva la última copia verificada.</p>}
      {!data.modules.length ? <EmptyState icon={PackageSearch} title="Sin módulos en el catálogo v2" description="No hay módulos publicados en este catálogo." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.modules.map((entry) => {
            const installable = canManage && !blocked && entry.state !== "installed" && entry.trust !== "untrusted" && !entry.revocation && entry.compatibility?.compatible;
            return (
              <Card key={entry.key} data-testid={`v2-module-${entry.key}`}>
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${entry.color ?? "#2563EB"}1f`, color: entry.color ?? "#2563EB" }}><ModuleNavIcon name={entry.icon ?? "Boxes"} size={18} /></span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{entry.name ?? entry.key}</span>
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">v{entry.version}{entry.publisher ? ` · ${entry.publisher.displayName}` : ""}</span>
                    </span>
                  </div>
                  <TrustBadge trust={entry.trust} />
                  <p className="flex-1 text-sm text-[hsl(var(--muted-foreground))]">{entry.description}</p>
                  {entry.revocation && <p className="rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">Revocado: {entry.revocation.reason}</p>}
                  {entry.installedWarning && <p className="rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">{entry.installedWarning.message} {entry.installedWarning.replacement ? `Recomendado: v${entry.installedWarning.replacement.version}.` : ""}</p>}
                  {entry.compatibility && !entry.compatibility.compatible && <p className="text-xs text-amber-700 dark:text-amber-300">No compatible: {entry.compatibility.reasons.map((r) => REASONS[r] ?? r).join(", ")}</p>}
                  <div className="flex items-center justify-between gap-2">
                    {entry.state === "installed" ? <Badge variant="secondary">Instalado</Badge> : <span />}
                    {entry.state !== "installed" && canManage && <Button size="sm" disabled={!installable} onClick={() => setSelected(entry)}>{entry.state === "update" ? "Revisar actualización" : "Instalar"}</Button>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {selected && <InstallDialog key={selected.key} entry={selected} token={token} onOpenChange={(open) => !open && setSelected(null)} />}
    </div>
  );
}
