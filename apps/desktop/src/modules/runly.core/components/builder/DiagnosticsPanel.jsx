// Module Builder — validation diagnostics (Etapa 12). A slim bar listing what
// @runly/module-compiler's validateModuleDefinition() returns, reworded in
// Spanish with a shortcut to the tab that fixes it (lib/builderDiagnostics.js).
// It closes itself after a few seconds, like a toast.
import { useEffect, useRef } from "react";
import { AlertCircle, X } from "lucide-react";
import { describeDiagnostic } from "../../lib/builderDiagnostics";

const AUTO_DISMISS_MS = 8000;

export function DiagnosticsPanel({ diagnostics, definition, onGoToTab, onDismiss }) {
  // Keyed on the diagnostics only: the parent passes an inline onDismiss and
  // re-renders on every edit, which must not restart the countdown.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!diagnostics?.errors?.length) return undefined;
    const timer = setTimeout(() => dismissRef.current?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [diagnostics]);

  if (!diagnostics?.errors?.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      <ul className="min-w-0 flex-1 space-y-0.5">
        {diagnostics.errors.map((error, index) => {
          const item = describeDiagnostic(error, definition);
          return (
            <li key={index} className="truncate">
              {item.text}
              {item.location && <span className="text-[hsl(var(--muted-foreground))]"> · {item.location}</span>}
              {onGoToTab && (
                <button type="button" className="ml-2 font-medium text-red-600 hover:underline dark:text-red-400" onClick={() => onGoToTab(item.tab)}>
                  Ir a {item.tabLabel}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {onDismiss && (
        <button type="button" aria-label="Cerrar" className="shrink-0 rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
