// Module Builder — "Preparar para IA externa" (spec
// 2026-10-03-rme3-module-platform-v2 §5 goal 9, plan Task 5.3): a ready prompt
// (GET /module-builder/projects/:id/ai-prompt) to paste in ChatGPT, Claude or
// any other AI together with the module ZIP. The returned ZIP goes back in
// through Módulos > Subir actualización.
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton, TextareaField } from "@runly/ui";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../../lib/runly";

export function ExternalAiPromptDialog({ open, onOpenChange, projectId, token, onDownload, downloading }) {
  const query = useQuery({
    queryKey: ["module-builder-ai-prompt", projectId],
    queryFn: async () => (await runly.builder.aiPrompt(projectId, token)).data.prompt,
    enabled: open && Boolean(projectId && token),
    staleTime: 0,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(query.data ?? "");
      toast.success("Texto copiado", { description: "Pégalo en tu IA junto con el ZIP y escribe el cambio donde dice <<Describe aquí...>>." });
    } catch {
      toast.error("No se pudo copiar; selecciona el texto y cópialo manualmente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Preparar para IA externa</DialogTitle>
          <DialogDescription>
            1. Descarga el ZIP. 2. Copia este texto. 3. En tu IA adjunta el ZIP, pega el texto y describe el cambio. 4. Sube el ZIP que te devuelva en Módulos &gt; Subir actualización.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {query.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : (
            <TextareaField id="external-ai-prompt" label="Texto para la IA" rows={16} readOnly value={query.data ?? ""} className="font-mono text-xs" />
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={downloading} onClick={onDownload}>
            <Download className="h-4 w-4" /> {downloading ? "Descargando..." : "Descargar ZIP"}
          </Button>
          <Button disabled={!query.data} onClick={copy}>
            <Copy className="h-4 w-4" /> Copiar texto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
