import { Button } from '@runly/ui'
import { Plus, Upload } from 'lucide-react'
import { catalogByKey } from './catalog-config.js'

export function CatalogPanel({ catalogKey, createLabel, onCreate, onImport, children }) {
  const { label, description, icon: Icon } = catalogByKey(catalogKey)
  return (
    <section className="glass-shell-flat min-w-0 space-y-4 rounded-2xl p-4 md:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">{label}</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onImport ? (
            <Button type="button" variant="outline" size="sm" onClick={onImport}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Importar
            </Button>
          ) : null}
          {onCreate ? (
            <Button type="button" size="sm" onClick={onCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />{createLabel}
            </Button>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  )
}
