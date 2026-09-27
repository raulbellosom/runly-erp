// Module Builder — validation diagnostics (Etapa 12). Renders exactly what
// @runly/module-compiler's validateModuleDefinition() returns
// (path/code/message/severity) — no separate frontend validator.
import { Alert, AlertTitle, AlertDescription } from "@runly/ui";
import { AlertTriangle } from "lucide-react";

export function DiagnosticsPanel({ diagnostics }) {
  if (!diagnostics?.errors?.length) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{diagnostics.errors.length} problema(s) de validación</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-1 text-sm">
          {diagnostics.errors.map((error, index) => (
            <li key={index}>
              <span className="font-mono text-xs opacity-70">{error.path || "(raíz)"}</span> — {error.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
