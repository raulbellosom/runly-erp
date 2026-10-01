import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, QrCode, Ban } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "./Button.jsx";
import { Badge } from "./Badge.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./Dialog.jsx";
import { ShareLinkDialog } from "./ShareLinkDialog.jsx";

// Lists, creates, copies (with QR) and revokes the public links of one module
// resource. Spec: docs/superpowers/specs/2026-09-28-module-public-links-design.md.

const STATUS_BADGE = {
  activo: { label: "Activo", variant: "success" },
  vencido: { label: "Vencido", variant: "warning" },
  agotado: { label: "Agotado", variant: "warning" },
  revocado: { label: "Revocado", variant: "secondary" },
};

export function publicLinkUrl(link, origin = typeof window !== "undefined" ? window.location.origin : "") {
  return link?.path ? `${origin}${link.path}` : "";
}

export function createPublicLinksApi({ apiBaseUrl, token, companyId, moduleKey }) {
  const base = `${String(apiBaseUrl ?? "").replace(/\/+$/, "")}/modules/${encodeURIComponent(moduleKey)}/public-links`;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(companyId ? { "X-Runly-Company-Id": companyId } : {}),
  };
  async function call(url, init = {}) {
    const res = await fetch(url, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "No se pudo completar la operación.");
    return json.data;
  }
  return {
    list: ({ resource, recordId }) => {
      const qs = new URLSearchParams({ resource });
      if (recordId) qs.set("recordId", recordId);
      return call(`${base}?${qs}`);
    },
    create: (payload) => call(base, { method: "POST", body: JSON.stringify(payload) }),
    revoke: (id) => call(`${base}/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
  };
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function QrDialog({ open, onOpenChange, url, title = "Código QR" }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    if (!open || !url) return;
    QRCode.toDataURL(url, { margin: 1, width: 320 }).then(setDataUrl).catch(() => setDataUrl(""));
  }, [open, url]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Escanéalo para abrir el enlace.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 p-4">
          {dataUrl ? <img src={dataUrl} alt="Código QR del enlace" className="h-64 w-64 rounded-md bg-white p-2" /> : null}
          {dataUrl ? (
            <a href={dataUrl} download="enlace-qr.png" className="text-sm text-[--color-primary] underline">
              Descargar imagen
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// `api` lets an official module plug in its own endpoints with the same
// { list, create, revoke } contract (links must carry `path`, the SPA path
// of the public page); RME3 modules keep using createPublicLinksApi.
export function PublicLinksPanel({ apiBaseUrl, token, companyId, moduleKey, resource, recordId = null, title = "Enlaces públicos", api: customApi = null }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [qrLink, setQrLink] = useState(null);
  const [revokeLink, setRevokeLink] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const api = customApi ?? createPublicLinksApi({ apiBaseUrl, token, companyId, moduleKey });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLinks((await api.list({ resource, recordId })) ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, token, companyId, moduleKey, resource, recordId, customApi]);

  useEffect(() => { load(); }, [load]);

  async function copy(link) {
    try {
      await navigator.clipboard.writeText(publicLinkUrl(link));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("No se pudo copiar el enlace.");
    }
  }

  async function confirmRevoke() {
    if (!revokeLink) return;
    setRevoking(true);
    try {
      await api.revoke(revokeLink.id);
      setRevokeLink(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Link2 className="mr-1 h-4 w-4" /> Crear enlace
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando enlaces...</p>
      ) : links.length === 0 ? (
        <EmptyState icon={Link2} title="Sin enlaces" description="Crea un enlace para compartir sin necesidad de cuenta." />
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
          {links.map((link) => {
            const badge = STATUS_BADGE[link.status] ?? STATUS_BADGE.activo;
            const active = link.status === "activo";
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{link.label || "Enlace sin nombre"}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Usos: {link.useCount}{link.maxUses ? ` / ${link.maxUses}` : ""}
                    {link.expiresAt ? ` · Vence ${formatDate(link.expiresAt)}` : " · Sin vencimiento"}
                  </p>
                </div>
                {active ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => copy(link)} aria-label="Copiar enlace">
                      <Copy className="mr-1 h-4 w-4" /> {copiedId === link.id ? "Copiado" : "Copiar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setQrLink(link)} aria-label="Ver código QR">
                      <QrCode className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevokeLink(link)} aria-label="Revocar enlace">
                      <Ban className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ShareLinkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(payload) => api.create({ resource, recordId: recordId ?? undefined, ...payload })}
        onCreated={load}
      />
      <QrDialog open={!!qrLink} onOpenChange={(open) => !open && setQrLink(null)} url={publicLinkUrl(qrLink)} />
      <ConfirmDialog
        open={!!revokeLink}
        onOpenChange={(open) => !open && setRevokeLink(null)}
        title="Revocar enlace"
        description="Quien tenga este enlace ya no podrá abrirlo. Esta acción no se puede deshacer."
        confirmLabel="Revocar"
        loading={revoking}
        onConfirm={confirmRevoke}
      />
    </section>
  );
}
