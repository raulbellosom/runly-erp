import { Bug } from "lucide-react";
import { cn } from "../lib/utils.js";
import { requestBugReport } from "../lib/bugReportBus.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "./Tooltip.jsx";

export function BrandFooter({ className, editionName = "Jaguar", tip, activeModuleKey }) {
  function handleReportBug() {
    requestBugReport({
      context: activeModuleKey
        ? `${activeModuleKey} · ${window.location.pathname}`
        : window.location.pathname,
    });
  }

  return (
    <footer className={cn("shrink-0 h-12 border-t border-[hsl(var(--border))] px-4 flex items-center justify-between gap-4 bg-[hsl(var(--background))]", className)}>
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none shrink-0">
        Runly ERP {editionName} <span className="font-medium">v0.1</span>
      </span>
      {tip && (
        <span
          className="hidden md:block flex-1 min-w-0 truncate text-center text-[11px] text-[hsl(var(--muted-foreground))]"
          title={tip}
        >
          {tip}
        </span>
      )}
      <div className="flex items-center gap-3 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleReportBug}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors duration-150"
              aria-label="Reportar un problema"
            >
              <Bug size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Reportar un problema
          </TooltipContent>
        </Tooltip>
        <a
          href="https://racoondevs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none hover:text-[hsl(var(--foreground))] transition-colors duration-150"
        >
          Hecho con amor por Racoon Devs
        </a>
      </div>
    </footer>
  );
}
