import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
} from "@runly/ui";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { getSupabaseClient } from "../../../lib/supabase.js";

// Mirrors injectRunlyConfig's payload shape (dist-serve-service.js) so a
// manually-connected external site gets the exact same window.RUNLY_CONFIG
// an ERP-published dist site would have auto-injected for it. Without
// apiUrl the embeddable script defaults to same-origin ('/'), which is
// wrong for any site that isn't served by this ERP instance itself.
function buildSnippet({ companySlug, propertyId }) {
  const apiUrl = getApiUrl();
  const supabase = getSupabaseClient();
  const supabaseUrl = supabase.supabaseUrl;
  const supabaseAnonKey = supabase.supabaseKey;
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const sdkUrl = `${apiUrl}/public/site/runly-sdk.js`;

  const config = {
    company: companySlug,
    siteId: propertyId,
    apiUrl,
    supabaseUrl,
    supabaseAnonKey,
    storageKey,
  };

  return [
    "<script>",
    `  window.RUNLY_CONFIG = ${JSON.stringify(config, null, 2).replace(/\n/g, "\n  ")};`,
    "</script>",
    `<script src="${sdkUrl}" async></script>`,
  ].join("\n");
}

export function ConnectExternalSiteDialog({
  open,
  onOpenChange,
  companySlug,
  onCreate,
  onVerify,
  creating,
  verifying,
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [property, setProperty] = useState(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setDomain("");
    setProperty(null);
    setCopied(false);
  }

  async function handleCreate() {
    const created = await onCreate({ name, domain: domain || undefined });
    if (created) setProperty(created);
  }

  async function handleVerify() {
    const result = await onVerify(property.id);
    if (result?.verified) {
      setProperty(result.data);
      toast.success("Sitio verificado: ya estamos recibiendo datos.");
    } else {
      toast.info(
        "Aun no recibimos eventos de ese sitio. Verifica que el snippet este publicado.",
      );
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildSnippet({ companySlug, propertyId: property.id }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar sitio externo</DialogTitle>
        </DialogHeader>

        {!property ? (
          <div className="space-y-4">
            <TextField
              label="Nombre"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sitio principal"
            />
            <TextField
              label="Dominio"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="runly.mx"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Pega este fragmento antes de {"</body>"} en tu sitio externo:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs">
              {buildSnippet({ companySlug, propertyId: property.id })}
            </pre>
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copiado" : "Copiar snippet"}
            </Button>
          </div>
        )}

        <DialogFooter>
          {!property ? (
            <Button type="button" onClick={handleCreate} disabled={!name || creating}>
              {creating ? "Creando..." : "Crear sitio"}
            </Button>
          ) : (
            <Button type="button" onClick={handleVerify} disabled={verifying}>
              {verifying ? "Verificando..." : "Verificar conexion"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
