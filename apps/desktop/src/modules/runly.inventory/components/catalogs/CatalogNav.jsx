import { SelectField, cn } from '@runly/ui'
import { CATALOGS } from './catalog-config.js'

// Sticky side list on md+, a select below md.
export function CatalogNav({ active, counts, onSelect }) {
  return (
    <>
      <div className="md:hidden">
        <SelectField label="Catálogo" value={active} onValueChange={onSelect}
          options={CATALOGS.map((c) => ({ value: c.key, label: `${c.label} (${counts[c.key] ?? 0})`, icon: c.icon }))} />
      </div>
      <nav aria-label="Catálogos" className="hidden md:block">
        <ul className="glass-shell-flat sticky top-4 space-y-1 rounded-2xl p-2">
          {CATALOGS.map(({ key, label, icon: Icon }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSelect(key)}
                aria-current={active === key ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  active === key
                    ? 'bg-[hsl(var(--primary))]/10 font-medium text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active === key && 'text-[hsl(var(--primary))]')} />
                <span className="flex-1 truncate">{label}</span>
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs tabular-nums">{counts[key] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
