// Marketplace catalog source (instance administrators). Feed URLs, cache policy
// and the trust store view. Official/community keys ship with Runly releases and
// cannot be added here; an administrator may only add managed-catalog keys or
// revoke a key locally (never re-trust or promote it). No private keys exist here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton, Switch, ErrorState, Badge, Textarea } from "@runly/ui";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";

const DOMAIN_LABELS = { official: "Oficial Runly", community: "Comunidad", managed: "Administrado" };
const STATE_LABELS = { active: "Activa", retiring: "En retiro", revoked: "Revocada" };

function SourceForm({ source, token, onDone }) {
  const queryClient = useQueryClient();
  const [officialUrl, setOfficialUrl] = useState(source.officialUrl ?? "");
  const [communityUrl, setCommunityUrl] = useState(source.communityUrl ?? "");
  const [managedKeys, setManagedKeys] = useState((source.managedKeys ?? []).map((k) => (typeof k === "string" ? k : k.publicKey)).join("\n"));
  const [allowCachedView, setAllowCachedView] = useState(source.policy.allowCachedView);
  const [maxCacheAgeDays, setMaxCacheAgeDays] = useState(String(source.policy.maxCacheAgeDays));
  const [revoking, setRevoking] = useState(null);
  const refresh = () => ["module-catalog-v2", "module-catalog-v2-source"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const save = useMutation({
    mutationFn: () => runly.moduleCatalog.configureSourceV2({ officialUrl: officialUrl.trim(), communityUrl: communityUrl.trim(), managedKeys: managedKeys.split("\n").map((k) => k.trim()).filter(Boolean), policy: { allowCachedView, maxCacheAgeDays: Number(maxCacheAgeDays) } }, token),
    onSuccess: () => { toast.success("Origen del catálogo guardado"); refresh(); onDone(); },
    onError: (error) => toast.error("No se pudo guardar", { description: error.details?.message ?? error.message }),
  });
  const revoke = useMutation({
    mutationFn: (keyId) => runly.moduleCatalog.configureSourceV2({ revokeKeyIds: [keyId] }, token),
    onSuccess: () => { toast.success("Clave revocada en esta instancia"); setRevoking(null); refresh(); },
    onError: (error) => toast.error("No se pudo revocar", { description: error.details?.message ?? error.message }),
  });
  return (
    <>
      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
        <div className="space-y-1">
          <Label htmlFor="catalog-official-url">Catálogo oficial (snapshot firmado)</Label>
          <Input id="catalog-official-url" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://…/catalog/official" maxLength={2048} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="catalog-community-url">Catálogo de comunidad o administrado (v2 firmado)</Label>
          <Input id="catalog-community-url" value={communityUrl} onChange={(e) => setCommunityUrl(e.target.value)} placeholder="https://…/catalog/community" maxLength={2048} />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setOfficialUrl(source.defaults.officialUrl); setCommunityUrl(source.defaults.communityUrl); }}>Usar catálogo de Runly</Button>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Sólo HTTPS o un archivo local explícito (file://). Un catálogo cuya firma no corresponde a una clave de confianza no se usa.</p>
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Mostrar la última copia verificada si el catálogo no responde</span><Switch checked={allowCachedView} onCheckedChange={setAllowCachedView} aria-label="Mostrar copia verificada sin conexión" /></label>
          <div className="flex items-center gap-2 text-sm"><Label htmlFor="catalog-max-age">Antigüedad máxima de esa copia (días)</Label><Input id="catalog-max-age" className="w-20" inputMode="numeric" value={maxCacheAgeDays} onChange={(e) => setMaxCacheAgeDays(e.target.value.replace(/\D/g, "").slice(0, 3))} /></div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Nunca se instala desde una copia en caché: instalar siempre vuelve a descargar y verificar.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="catalog-managed-keys">Claves de catálogos administrados (una por línea, Ed25519 SPKI base64)</Label>
          <Textarea id="catalog-managed-keys" className="min-h-20 font-mono text-xs" value={managedKeys} onChange={(e) => setManagedKeys(e.target.value)} />
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Una clave administrada nunca convierte un módulo en «Oficial Runly».</p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Trust store</p>
          <ul className="divide-y divide-[hsl(var(--border))] text-sm">
            {source.trust.map((key) => (
              <li key={key.keyId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0"><code className="text-xs">{key.keyId.slice(0, 16)}…</code> <Badge variant="outline">{DOMAIN_LABELS[key.domain]}</Badge> <Badge variant={key.state === "revoked" ? "destructive" : "secondary"}>{STATE_LABELS[key.state]}</Badge>{key.notAfter && <span className="text-xs text-[hsl(var(--muted-foreground))]"> hasta {new Date(key.notAfter).toLocaleDateString()}</span>}</span>
                {key.state !== "revoked" && <Button size="sm" variant="ghost" onClick={() => setRevoking(key)}>Revocar aquí</Button>}
              </li>
            ))}
            {!source.trust.length && <li className="py-1.5 text-xs text-[hsl(var(--muted-foreground))]">Sin claves configuradas.</li>}
          </ul>
        </div>
      </div>
      <DialogFooter className="shrink-0">
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Guardando..." : "Guardar"}</Button>
      </DialogFooter>
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revocar clave en esta instancia"
        description={revoking ? `El contenido firmado con ${revoking.keyId.slice(0, 16)}… dejará de considerarse confiable aquí. Esta acción no se puede deshacer desde la interfaz.` : ""}
        confirmLabel="Revocar"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate(revoking.keyId)}
      />
    </>
  );
}

export function MarketplaceSourceDialog({ token, onOpenChange }) {
  const source = useQuery({ queryKey: ["module-catalog-v2-source", token], queryFn: async () => (await runly.moduleCatalog.sourceV2(token)).data, enabled: Boolean(token), retry: false });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Origen del catálogo</DialogTitle>
          <DialogDescription>Fuente del Marketplace para toda la instancia. Las claves privadas nunca se configuran en Runly.</DialogDescription>
        </DialogHeader>
        {source.isLoading ? <Skeleton className="h-48 rounded-xl" /> : source.isError ? <ErrorState title="No se pudo leer la configuración" description={source.error?.details?.message ?? source.error?.message} onRetry={() => source.refetch()} /> : <SourceForm source={source.data} token={token} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
