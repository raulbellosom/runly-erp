// Branded frame for public module pages opened through a public link: company
// logo + name header, content, and a small Runly footer.

export function PublicLinkFrame({ publicLink, title, children, className = "" }) {
  const company = publicLink?.company ?? {};
  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background))]">
      <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name || "Logo"} className="h-9 w-9 rounded-md object-contain" />
          ) : null}
          <div className="min-w-0">
            {company.name ? <p className="truncate text-sm font-semibold">{company.name}</p> : null}
            {title ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{title}</p> : null}
          </div>
        </div>
      </header>
      <main className={`mx-auto w-full max-w-2xl flex-1 px-4 py-6 ${className}`}>{children}</main>
      <footer className="py-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Con tecnología de Runly</footer>
    </div>
  );
}
