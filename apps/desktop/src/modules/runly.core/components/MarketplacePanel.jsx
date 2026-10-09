// Módulos > "Marketplace": the same verified Developer Hub catalog that feeds
// runly.mx, consumed from its signed feeds (official snapshot + community v2).
// Explore → detail → compatibility → install. Each trust level has its own icon,
// colour and wording; only "Oficial Runly" uses the official mark. Revoked and
// withdrawn never share wording. Nothing installs, updates or uninstalls
// automatically; offline/stale data shows the last verified synchronization.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, EmptyState, ErrorState, ModuleNavIcon, SearchInput, Skeleton } from "@runly/ui";
import { AlertTriangle, Clock, CloudOff, PackageSearch, Settings2, ShieldAlert } from "lucide-react";
import { runly } from "../../../lib/runly";
import { STATE_LABELS, TRUST_FILTERS, alertMessage, availableAction, filterModules } from "../lib/marketplace";
import { ModuleAlerts, TrustBadge, date, safeColor } from "./MarketplaceBadges";
import { MarketplaceModuleSheet } from "./MarketplaceModuleSheet";
import { MarketplaceSourceDialog } from "./MarketplaceSourceDialog";

function CatalogStatus({ data }) {
  const domains = [["official", "Oficial"], ["community", "Comunidad"]].filter(([id]) => data.catalogs?.[id]?.configured);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
        {domains.map(([id, label]) => {
          const domain = data.catalogs[id];
          return <span key={id} className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{label}: {domain.error ? `no disponible (${domain.error})` : `secuencia ${domain.sequence} · sincronizado ${date(domain.lastSync)}${domain.validUntil ? ` · vigente hasta ${date(domain.validUntil)}` : ""}`}</span>;
        })}
      </div>
      {data.offline && <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><CloudOff className="h-4 w-4 shrink-0" /> Sin conexión: se muestra la última copia verificada y puede estar desactualizada. Las revocaciones posteriores no se conocen hasta volver a sincronizar; no se instala nada mientras tanto.</p>}
      {data.stale && <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><Clock className="h-4 w-4 shrink-0" /> La información del catálogo está vencida; no se instalarán módulos hasta sincronizar un catálogo vigente.</p>}
      {data.alert && <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"><ShieldAlert className="h-4 w-4 shrink-0" /> {alertMessage(data.alert)} Se conserva la última copia verificada.</p>}
    </div>
  );
}

export function MarketplacePanel({ token, canManage }) {
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [trust, setTrust] = useState("all");
  const catalog = useQuery({ queryKey: ["module-catalog-v2", token], queryFn: async () => (await runly.moduleCatalog.listV2(token)).data, enabled: Boolean(token), staleTime: 60 * 1000, retry: false });
  const modules = useMemo(() => filterModules(catalog.data?.modules ?? [], { query, trust }), [catalog.data, query, trust]);
  const settingsButton = canManage && <Button variant="outline" size="sm" onClick={() => setSettings(true)}><Settings2 className="mr-1.5 h-4 w-4" /> Origen del catálogo</Button>;
  const dialogs = <>{settings && <MarketplaceSourceDialog token={token} onOpenChange={(open) => !open && setSettings(false)} />}</>;
  if (catalog.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>;
  if (catalog.isError) return <div className="space-y-3"><ErrorState title="No se pudo cargar el Marketplace" description={alertMessage(catalog.error?.details?.error) ?? catalog.error?.details?.message ?? catalog.error?.message} onRetry={() => catalog.refetch()} />{settingsButton}{dialogs}</div>;
  const data = catalog.data;
  if (!data?.enabled) return <div className="space-y-3"><EmptyState icon={PackageSearch} title="Marketplace no configurado" description="La administración de la instancia puede conectar el catálogo oficial de Runly o un catálogo administrado. Sólo se usan catálogos firmados con claves de confianza." />{settingsButton}{dialogs}</div>;
  const blocked = data.offline || data.stale || Boolean(data.alert);
  return (
    <div className="space-y-4">
      <CatalogStatus data={data} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, clave o publicador" className="sm:max-w-sm" maxLength={120} />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Confianza">
          {TRUST_FILTERS.map((filter) => <Button key={filter.id} size="sm" variant={trust === filter.id ? "default" : "outline"} aria-pressed={trust === filter.id} onClick={() => setTrust(filter.id)}>{filter.label}</Button>)}
          {settingsButton}
        </div>
      </div>
      {!modules.length ? <EmptyState icon={PackageSearch} title="Sin módulos" description={data.modules.length ? "Ningún módulo coincide con la búsqueda." : "No hay módulos publicados en este catálogo."} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((entry) => {
            const action = availableAction(entry, { canManage, blocked });
            return (
              <Card key={entry.key} data-testid={`v2-module-${entry.key}`} data-state={entry.state}>
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <button type="button" className="flex items-start gap-3 text-left" onClick={() => setSelected(entry)}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${safeColor(entry.color)}1f`, color: safeColor(entry.color) }}><ModuleNavIcon name={entry.icon ?? "Boxes"} size={18} /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold hover:underline">{entry.name ?? entry.key}</span>
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">v{entry.version}{entry.publisher ? ` · ${entry.publisher.displayName}` : entry.official ? " · Runly" : ""}</span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5"><TrustBadge trust={entry.trust} /><Badge variant="secondary">{STATE_LABELS[entry.state] ?? entry.state}</Badge></div>
                  <p className="line-clamp-3 flex-1 text-sm text-[hsl(var(--muted-foreground))]">{entry.description}</p>
                  <ModuleAlerts entry={entry} />
                  <div className="flex items-center justify-between gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(entry)}>Ver detalle</Button>
                    {action && <Button size="sm" disabled={action.disabled} onClick={() => setSelected(entry)}>{action.type === "update" ? "Revisar actualización" : "Instalar"}</Button>}
                    {entry.state === "installed" && entry.installedWarning && <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Versión revocada" />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {selected && <MarketplaceModuleSheet key={selected.key} entry={selected} token={token} canManage={canManage} blocked={blocked} onOpenChange={(open) => !open && setSelected(null)} />}
      {dialogs}
    </div>
  );
}
