// packages/ui/src/runly-renderer/detail-section-shell.jsx
//
// Card + title header for one RunlyDetail section. When the section is
// `collapsible`, the header becomes a toggle; `defaultCollapsed: "mobile"`
// starts collapsed only on small screens (long lists like permission trees).
import { useState } from "react";
import * as LucideIcons from "lucide-react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

export function DetailSectionShell({ section, className, children }) {
  const isMobile = useIsMobile(1024);
  const [collapsed, setCollapsed] = useState(() =>
    section.defaultCollapsed === "mobile" ? isMobile : section.defaultCollapsed === true,
  );
  const collapsible = section.collapsible === true;
  const isOpen = !collapsible || !collapsed;
  const SectionIcon = section.icon ? LucideIcons[section.icon] : null;

  const titleContent = (
    <>
      {SectionIcon ? (
        <SectionIcon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      ) : null}
      <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
        {section.title}
      </h4>
    </>
  );

  return (
    <div className={cn("glass-shell-flat rounded-xl px-5 py-4", isOpen && "space-y-4", className)}>
      {section.title ? (
        collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={isOpen}
            className={cn(
              "w-full flex items-center gap-2 text-left",
              isOpen && "pb-3 border-b border-[hsl(var(--border))]",
            )}
          >
            {titleContent}
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150",
                isOpen && "rotate-180",
              )}
            />
          </button>
        ) : (
          <div className="pb-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
            {titleContent}
          </div>
        )
      ) : null}
      {isOpen ? children : null}
    </div>
  );
}
