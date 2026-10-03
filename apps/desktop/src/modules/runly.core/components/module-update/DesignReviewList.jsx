// "Revisión de diseño" block of the upload report: static findings from
// @runly/module-compiler design-review (file:line + rule message), grouped by
// file. Informative only — never blocks applying. "Copiar para la IA" puts a
// plain-text list on the clipboard so an external AI can fix it in one pass.
import { useState } from "react";
import { Badge, Button } from "@runly/ui";
import { ClipboardCopy, Paintbrush } from "lucide-react";
import { toast } from "sonner";

const MAX_ROWS = 50;

function groupByFile(findings) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.file)) groups.set(finding.file, []);
    groups.get(finding.file).push(finding);
  }
  return [...groups.entries()];
}

function toPlainText(findings) {
  return [
    "Corrige estos puntos de diseño de Runly en el módulo (archivo:línea — regla):",
    ...findings.map((f) => `- ${f.file}:${f.line} — ${f.message}`),
  ].join("\n");
}

export function DesignReviewList({ findings }) {
  const [showAll, setShowAll] = useState(false);
  if (!findings?.length) return null;
  const errors = findings.filter((f) => f.severity === "error").length;
  const visible = showAll ? findings : findings.slice(0, MAX_ROWS);

  async function copy() {
    try {
      await navigator.clipboard.writeText(toPlainText(findings));
      toast.success("Lista copiada. Pégala en tu asistente de IA.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Paintbrush className="h-4 w-4" /> Revisión de diseño
          <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">
            {findings.length} {findings.length === 1 ? "punto" : "puntos"}{errors ? `, ${errors} importantes` : ""}
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={copy}>
          <ClipboardCopy className="h-4 w-4" /> Copiar para la IA
        </Button>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        No impide aplicar, pero tus pantallas se verán mejor si los corriges.
      </p>
      <div className="space-y-2">
        {groupByFile(visible).map(([file, items]) => (
          <div key={file} className="space-y-1">
            <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{file}</p>
            <ul className="space-y-1">
              {items.map((item, index) => (
                <li key={`${item.line}-${item.rule}-${index}`} className="flex items-start gap-2 text-sm">
                  <Badge variant={item.severity === "error" ? "destructive" : "warning"} className="shrink-0">
                    {item.severity === "error" ? "Importante" : "Aviso"}
                  </Badge>
                  <span className="min-w-0">
                    <span className="font-mono text-xs">línea {item.line}</span> — {item.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {findings.length > MAX_ROWS && !showAll && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setShowAll(true)}>
          Ver los {findings.length - MAX_ROWS} restantes
        </Button>
      )}
    </section>
  );
}
