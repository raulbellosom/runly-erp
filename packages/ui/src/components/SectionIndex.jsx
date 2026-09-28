import { useEffect, useState } from "react";
import { cn } from "../lib/utils.js";
import { SelectField } from "./FormFields.jsx";

// Scroll-spy index for long forms/pages. `sections` = [{ id, label, icon?, badge? }]
// where `id` is the DOM id of each section. Desktop renders a vertical list
// (make its container sticky); below md it collapses into a jump select.
// `scrollRoot` is the scrolling element (defaults to the viewport).
export function SectionIndex({ sections = [], scrollRoot = null, title, footer, className }) {
  const [active, setActive] = useState(sections[0]?.id ?? null);

  useEffect(() => {
    const targets = sections.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!targets.length || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root: scrollRoot, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [sections, scrollRoot]);

  function jump(id) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav aria-label={title ?? "Secciones"} className={className}>
      <div className="md:hidden">
        <SelectField
          value={active ?? undefined}
          onValueChange={jump}
          options={sections.map((s) => ({ value: s.id, label: s.label }))}
          placeholder="Ir a sección"
        />
      </div>
      <div className="hidden md:block">
        {title && (
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            {title}
          </p>
        )}
        <ul className="space-y-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === active;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => jump(section.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-[hsl(var(--primary))]/10 font-semibold text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  <span className="flex-1 truncate">{section.label}</span>
                  {section.badge != null && (
                    <span className="rounded-full bg-[hsl(var(--muted))] px-1.5 text-[11px] tabular-nums">{section.badge}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {footer}
      </div>
    </nav>
  );
}
