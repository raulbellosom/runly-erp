import { Button, cn } from '@runly/ui'
import { ArrowLeft, ExternalLink, FolderUp, Scale } from 'lucide-react'

// One accent per importable format, reused by the help view, the empty
// drop zone and the drag overlay so the formats read the same everywhere.
const FORMAT_TONES = {
  excalidrawlib: 'bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300',
  excalidraw: 'bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300',
  svg: 'bg-amber-500/14 text-amber-800 ring-amber-500/30 dark:text-amber-300',
  zip: 'bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300',
}

export function FormatChip({ format, className }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold ring-1 ring-inset', FORMAT_TONES[format], className)}>
      .{format}
    </span>
  )
}

const FORMATS = [
  { format: 'excalidrawlib', title: 'Biblioteca de Excalidraw', result: 'Cada elemento se convierte en formas que puedes editar.' },
  { format: 'excalidraw', title: 'Dibujo de Excalidraw', result: 'Todo el dibujo queda como un solo elemento.' },
  { format: 'svg', title: 'Icono', result: 'Cada archivo queda como una imagen.' },
  { format: 'zip', title: 'Paquete de iconos', result: 'Varios SVG en un archivo, hasta 300.' },
]

const SOURCES = [
  { title: 'Bibliotecas de Excalidraw', host: 'libraries.excalidraw.com', href: 'https://libraries.excalidraw.com', hint: 'Gratuitas. En cada una, el botón Download baja el .excalidrawlib.' },
  { title: 'Iconos de arquitectura de AWS', host: 'aws.amazon.com', href: 'https://aws.amazon.com/architecture/icons/' },
  { title: 'Iconos de Azure', host: 'learn.microsoft.com', href: 'https://learn.microsoft.com/azure/architecture/icons/' },
  { title: 'Iconos de Google Cloud', host: 'cloud.google.com', href: 'https://cloud.google.com/icons' },
  { title: 'Iconos de topología de red de Cisco', host: 'cisco.com', href: 'https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html' },
]

const SAVE_STEPS = ['Selecciona los elementos en el Board.', 'Haz clic derecho sobre la selección (en pantallas táctiles, mantén presionado).', 'Elige «Guardar en biblioteca».']

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
      {children}
    </section>
  )
}

// Header row of the help view (replaces the panel title while it is open).
export function LibraryHelpHeader({ onBack }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon" variant="ghost" className="-ml-2 size-8" aria-label="Volver a la biblioteca" onClick={onBack}><ArrowLeft /></Button>
      <h2 className="flex-1 text-base font-semibold">Qué puedo importar</h2>
    </div>
  )
}

// In-panel guide: replaces the library list instead of floating over it, so
// it never covers the board or the panel's own controls.
export function LibraryHelpView({ canImport, onImport }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <Section title="Formatos">
          <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-xl border border-[hsl(var(--border))]">
            {FORMATS.map(({ format, title, result }) => (
              <li key={format} className="flex items-start gap-3 px-3 py-2.5">
                <FormatChip format={format} className="mt-0.5 w-27 justify-center" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{title}</p>
                  <p className="text-xs leading-snug text-[hsl(var(--muted-foreground))]">{result}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Dónde conseguirlas">
          <ul className="space-y-1">
            {SOURCES.map(({ title, host, href, hint }) => (
              <li key={href}>
                <a
                  href={href} target="_blank" rel="noreferrer"
                  className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug group-hover:text-[hsl(var(--primary))]">{title}</p>
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{host}</p>
                    {hint ? <p className="mt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{hint}</p> : null}
                  </div>
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Guardar tus propios elementos">
          <ol className="space-y-2 px-1">
            {SAVE_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-2.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[11px] font-semibold text-[hsl(var(--primary))]">{index + 1}</span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <p className="flex items-start gap-2 rounded-lg bg-[hsl(var(--muted)/0.6)] px-3 py-2.5 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
          <Scale className="mt-px size-3.5 shrink-0" aria-hidden />
          Cada biblioteca tiene su propia licencia. Revísala antes de usarla en documentos de la empresa.
        </p>
      </div>
      {canImport ? (
        <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
          <Button type="button" className="w-full" onClick={onImport}><FolderUp />Importar archivos</Button>
        </div>
      ) : null}
    </div>
  )
}
