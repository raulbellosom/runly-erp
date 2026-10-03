// "Paquete base" download in Módulos > Subir módulo: a complete sample module
// (one entity, its views and API, a React dashboard) plus the developer guide,
// AGENTS.md, the offline docs and reference screens — to start a module in
// code or with an AI (ChatGPT, Claude) and upload it back here.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, TextField } from "@runly/ui";
import { Download, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../../lib/runly";

const KEY_RE = /^custom\.[a-z][a-z0-9]{1,39}$/;

// "Visitas a clientes" -> "custom.visitasaclientes"
export function keyFromName(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 40);
  return slug ? `custom.${slug}` : "";
}

export function StarterPackageCard({ token }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const effectiveKey = keyTouched ? key : keyFromName(name);
  const keyError = effectiveKey && !KEY_RE.test(effectiveKey)
    ? "Usa custom.<nombre> en minúsculas, sin espacios ni guiones."
    : undefined;

  const download = useMutation({
    mutationFn: async () => {
      const blob = await runly.builder.starterPackage({ key: effectiveKey, name: name.trim() }, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${effectiveKey}-paquete-base.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success("Paquete base descargado. Ábrelo, pásalo a tu asistente de IA y sube aquí el resultado."),
    onError: (error) => toast.error(error?.message || "No se pudo descargar el paquete base."),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3 text-left text-sm transition-colors hover:bg-muted/60"
      >
        <PackagePlus className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block font-medium text-foreground">¿Vas a crear un módulo nuevo?</span>
          <span className="block text-xs text-muted-foreground">Descarga un paquete base con un módulo de ejemplo, la guía y las instrucciones para tu IA.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <PackagePlus className="h-4 w-4 text-primary" /> Paquete base
      </p>
      <p className="text-xs text-muted-foreground">
        Trae un módulo instalable con una entidad de ejemplo, sus pantallas y su API, más <code>GUIA_DESARROLLO_RUNLY.md</code>,{" "}
        <code>AGENTS.md</code>, la documentación en <code>docs/</code> y pantallas de referencia. Dale el ZIP a tu asistente de IA
        con lo que necesitas y sube aquí el resultado.
      </p>
      <TextField label="Nombre del módulo" value={name} onChange={(e) => setName(e.target.value)} placeholder="Visitas a clientes" />
      <TextField
        label="Clave"
        value={effectiveKey}
        onChange={(e) => { setKeyTouched(true); setKey(e.target.value.trim()); }}
        placeholder="custom.visitas"
        error={keyError}
        hint="No se puede cambiar después de instalar el módulo."
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="button" disabled={!effectiveKey || Boolean(keyError) || download.isPending} onClick={() => download.mutate()}>
          <Download className="h-4 w-4" />
          {download.isPending ? "Generando..." : "Descargar paquete base"}
        </Button>
      </div>
    </div>
  );
}
