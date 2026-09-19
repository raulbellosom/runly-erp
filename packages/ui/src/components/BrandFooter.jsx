import { cn } from "../lib/utils.js";

export function BrandFooter({ className, editionName = "Jaguar" }) {
  return (
    <footer className={cn("shrink-0 h-12 border-t border-[hsl(var(--border))] px-4 flex items-center justify-between gap-4 bg-[hsl(var(--background))]", className)}>
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none">
        Runly ERP {editionName} <span className="font-medium">v0.1</span>
      </span>
      <a
        href="https://racoondevs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none hover:text-[hsl(var(--foreground))] transition-colors duration-150"
      >
        Hecho con amor por Racoon Devs
      </a>
    </footer>
  );
}
