// Módulos > "Disponibles" (spec 2026-10-03-rme3-module-platform-v2 §8.5):
// official catalog entries with Instalar / Actualizar / Instalado and an
// install consent dialog listing the services, events and connections the
// module asks for. Served from cache with a "Sin conexión" notice offline.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  EmptyState, ErrorState, ModuleNavIcon, Skeleton,
} from "@runly/ui";
import { BadgeCheck, CloudOff, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import { StructureChangesTable, missingDecisions } from "./module-update/StructureChangesTable";

const EVENT_LABELS = {
  "inventory.item.created": "Cuando se crea un artículo de inventario",
  "inventory.item.updated": "Cuando se actualiza un artículo de inventario",
  "contacts.contact.created": "Cuando se crea un contacto",
  "projects.task.created": "Cuando se crea una tarea de proyecto",
};
const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function ConsentDialog({ entry, onOpenChange, token }) {
  const queryClient = useQueryClient();
  const isUpdate = entry?.state === "update";
  const [grants, setGrants] = useState(() => new Set((entry?.services ?? []).map((service) => service.key)));
  const [plan, setPlan] = useState(null);
  const [decisions, setDecisions] = useState({});
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { grants: [...grants], ...(plan ? { decisions } : {}) };
      return isUpdate ? runly.moduleCatalog.update(entry.key, payload, token) : runly.moduleCatalog.install(entry.key, payload, token);
    },
    onSuccess: (result) => {
      toast.success(isUpdate ? `${entry.name} se actualizó a v${result.data.version}` : `${entry.name} se instaló`, {
        description: result.data.official ? "Paquete oficial verificado." : undefined,
      });
      ["module-catalog", "modules", "runtime-modules", "blueprints"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      onOpenChange(false);
    },
    onError: (error) => {
      const structure = error.details?.details?.structure ?? error.details?.structure;
      if (error.status === 409 && structure) setPlan({ structure });
      else toast.error(isUpdate ? "No se pudo actualizar" : "No se pudo instalar", { description: error.details?.message ?? error.message });
    },
  });
  if (!entry) return null;
  const toggle = (key) => setGrants((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const blocked = plan && missingDecisions(plan.structure, decisions).length > 0;

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isUpdate ? `Actualizar ${entry.name}` : `Instalar ${entry.name}`}</DialogTitle>
          <DialogDescription>
            {isUpdate ? `De v${entry.installedVersion} a v${entry.version}.` : `Versión ${entry.version}.`} {entry.changelog}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
          {entry.services.length > 0 && (
            <section className="space-y-2">
              <p className="text-sm font-medium">Datos de otros módulos que podrá usar</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Siempre con los permisos de cada usuario y solo en su empresa. Puedes quitar los que no quieras autorizar.</p>
              {entry.services.map((service) => (
                <label key={service.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={grants.has(service.key)} onCheckedChange={() => toggle(service.key)} aria-label={service.label} />
                  {service.label}
                  {service.mutates && <Badge variant="outline">Escribe datos</Badge>}
                </label>
              ))}
            </section>
          )}
          {entry.events?.length > 0 && (
            <section className="space-y-1">
              <p className="text-sm font-medium">Avisos que recibirá</p>
              <ul className="list-disc pl-5 text-sm">{entry.events.map((event) => <li key={event}>{EVENT_LABELS[event] ?? event}</li>)}</ul>
            </section>
          )}
          {entry.connections?.length > 0 && (
            <section className="space-y-1">
              <p className="text-sm font-medium">Conexiones que ofrece</p>
              <ul className="list-disc pl-5 text-sm">{entry.connections.map((connection) => <li key={`${connection.target}-${connection.label}`}>{connection.label} (se activan en la pantalla Conexiones del módulo)</li>)}</ul>
            </section>
          )}
          {!entry.services.length && !entry.events?.length && !entry.connections?.length && (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Este módulo no usa datos de otros módulos.</p>
          )}
          {plan && <StructureChangesTable rows={plan.structure} decisions={decisions} onChange={setDecisions} disabled={mutation.isPending} />}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={mutation.isPending || blocked} onClick={() => mutation.mutate()}>
            {mutation.isPending ? (isUpdate ? "Actualizando..." : "Instalando...") : isUpdate ? "Actualizar" : "Instalar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CatalogAvailablePanel({ token, canManage }) {
  const [selected, setSelected] = useState(null);
  const query = useQuery({
    queryKey: ["module-catalog", token],
    queryFn: async () => (await runly.moduleCatalog.list(token)).data,
    enabled: Boolean(token),
    staleTime: 60 * 1000,
    retry: false,
  });

  if (query.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>;
  if (query.isError) return <ErrorState title="No se pudo cargar el catálogo" description={query.error?.details?.message ?? query.error?.message} onRetry={() => query.refetch()} />;
  const modules = query.data?.modules ?? [];

  return (
    <div className="space-y-3">
      {query.data?.offline && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <CloudOff className="h-4 w-4 shrink-0" /> Sin conexión con el catálogo: se muestra la última lista descargada. Los módulos instalados siguen funcionando.
        </p>
      )}
      {!modules.length ? (
        <EmptyState icon={PackageSearch} title="El catálogo está vacío" description="Todavía no hay módulos oficiales publicados." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((entry) => (
            <Card key={entry.key}>
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${entry.color}1f`, color: entry.color }}>
                    <ModuleNavIcon name={entry.icon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {entry.name}
                      {entry.official && <BadgeCheck className="h-4 w-4 text-sky-600" aria-label="Oficial" />}
                    </span>
                    <span className="block text-xs text-[hsl(var(--muted-foreground))]">v{entry.version} · {formatSize(entry.size)}</span>
                  </span>
                </div>
                <p className="flex-1 text-sm text-[hsl(var(--muted-foreground))]">{entry.description}</p>
                <div className="flex items-center justify-between gap-2">
                  {entry.state === "installed" ? <Badge variant="secondary">Instalado</Badge> : <Badge variant="outline">{entry.state === "update" ? `Instalada v${entry.installedVersion}` : "Oficial"}</Badge>}
                  {entry.state !== "installed" && canManage && (
                    <Button size="sm" disabled={query.data?.offline} onClick={() => setSelected(entry)}>
                      {entry.state === "update" ? "Actualizar" : "Instalar"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {selected && <ConsentDialog key={selected.key} entry={selected} token={token} onOpenChange={(open) => !open && setSelected(null)} />}
    </div>
  );
}
