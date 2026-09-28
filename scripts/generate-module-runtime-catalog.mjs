#!/usr/bin/env node
// Regenerates packages/module-compiler/src/runtime-catalog.json: the
// libraries a module's React components (components/*.jsx) can import, with
// the versions actually installed for the web app. The catalog feeds the
// GUIA_DESARROLLO_RUNLY.md every Builder ZIP ships with.
//
// Run after upgrading any of these dependencies:
//   node scripts/generate-module-runtime-catalog.mjs
// apps/api/src/services/__tests__/module-runtime-catalog.test.js fails when
// the catalog no longer matches the installed versions or the bundler's
// BUNDLE_EXTERNALS.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(repoRoot, 'packages/module-compiler/src/runtime-catalog.json')
const DOC_OUT = path.join(repoRoot, 'docs/developers/librerias.md')

// shared: resolved from the app at runtime (bundler externals, no bundle weight).
// bundled: esbuild copies them into the module bundle (adds weight).
export const LIBRARIES = [
  { name: 'react', category: 'shared', imports: 'useState, useEffect, useMemo, useCallback, useRef, useContext, createContext, forwardRef, memo, Fragment' },
  { name: 'react-dom', category: 'shared', imports: 'createPortal, flushSync' },
  { name: '@runly/ui', category: 'shared', imports: 'PageHeader, Card, Button, TextField, SelectField, DatePickerField, RunlyTable, DataTable, Dialog, Sheet, ConfirmDialog, EmptyState, ErrorState, Skeleton, Badge, Tabs, buildApiHeaders ...', source: 'packages/ui' },
  { name: '@runly/sdk', category: 'shared', imports: 'createRunlyClient', source: 'packages/sdk' },
  { name: '@runly/validators', category: 'shared', imports: 'Esquemas Zod compartidos', source: 'packages/validators' },
  { name: '@tanstack/react-query', category: 'shared', imports: 'useQuery, useMutation, useQueryClient' },
  { name: 'react-router-dom', category: 'shared', imports: 'useNavigate, useParams, useLocation, Link' },
  { name: 'zustand', category: 'shared', imports: 'create' },
  { name: 'sonner', category: 'shared', imports: 'toast' },
  { name: 'lucide-react', category: 'shared', imports: 'Iconos: Plus, Pencil, Trash2, Search, Calendar ...' },
  { name: 'recharts', category: 'shared', imports: 'ResponsiveContainer, BarChart, LineChart, PieChart, AreaChart, Tooltip, Legend' },
  { name: 'qrcode', category: 'shared', imports: 'QRCode (default), create, toCanvas, toDataURL, toString para generar códigos QR' },
  { name: '@zxing/browser', category: 'shared', imports: 'BrowserQRCodeReader, BrowserMultiFormatReader para leer códigos QR desde cámara, imagen o video' },
  { name: 'react-hook-form', category: 'bundled', imports: 'useForm, Controller (prefiere los campos de @runly/ui)' },
  { name: 'motion', category: 'bundled', imports: 'motion, AnimatePresence (~280 KB, usar con moderacion)' },
  { name: 'tailwindcss', category: 'styles', imports: 'Clases utilitarias en className (sin importar nada)' },
]

function installedVersion(library) {
  const candidates = library.source
    ? [path.join(repoRoot, library.source, 'package.json')]
    : [path.join(repoRoot, 'apps/desktop/node_modules', library.name, 'package.json')]
  for (const file of candidates) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version
  }
  throw new Error(`No se encontro la version instalada de ${library.name} (${candidates.join(', ')})`)
}

export function buildCatalog() {
  return { libraries: LIBRARIES.map((library) => ({ name: library.name, version: installedVersion(library), category: library.category, imports: library.imports })) }
}

const CATEGORY_LABELS = {
  shared: 'Incluida en la app (no pesa en tu módulo)',
  bundled: 'Se empaqueta en tu módulo (agrega peso)',
  styles: 'Estilos',
}

// Usage guide appended to the public libraries page.
const USAGE = `## Componentes de @runly/ui por uso

| Para | Usa |
|---|---|
| Estructura de pantalla | \`PageHeader\`, \`SectionCard\`, \`Card\` (\`CardHeader\`, \`CardTitle\`, \`CardContent\`), \`Tabs\` (\`TabsList\`, \`TabsTrigger\`, \`TabsContent\`), \`Separator\`, \`PageFooter\` |
| Estados | \`Skeleton\`, \`LoadingState\`, \`EmptyState\`, \`ErrorState\`, \`Alert\` |
| Indicadores | \`StatCard\`, \`StatStrip\`, \`Badge\`, \`ProgressBar\`, \`ProgressMeter\`, \`RingProgress\` |
| Formularios | \`TextField\`, \`TextareaField\`, \`NumberField\`, \`CurrencyField\`, \`SelectField\`, \`ComboboxField\`, \`CreatableComboboxField\`, \`TagsComboboxField\`, \`CheckboxField\`, \`SwitchField\`, \`DatePickerField\`, \`SwatchField\`, \`IconPickerField\`, \`MarkdownField\`, \`SegmentedControl\` |
| Tablas y listas | \`DataTable\`, \`RunlyTable\`, \`SearchInput\`, \`FilterBar\`, \`SortableList\` |
| Ventanas y menús | \`Dialog\`, \`Sheet\`, \`ConfirmDialog\`, \`DropdownMenu\`, \`ActionMenu\`, \`Popover\`, \`Tooltip\` |
| Archivos y cámara | \`FileUploader\`, \`FileAssetField\`, \`AttachmentsPanel\`, \`ImageViewer\`, \`CameraCaptureDialog\` |
| Utilidades | \`Button\`, \`CopyableValue\`, \`MarkdownViewer\`, \`buildApiHeaders\`, \`cn\`, \`useIsMobile\` |

\`window.confirm\`, \`window.alert\` y \`window.prompt\` están prohibidos: usa \`ConfirmDialog\` o \`Dialog\`.

## Ejemplos

**Datos con TanStack Query** (lectura y escritura):

\`\`\`jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buildApiHeaders } from '@runly/ui'
import { toast } from 'sonner'

function useEncuestas({ token, companyId, apiBaseUrl }) {
  return useQuery({
    queryKey: ['custom.encuestas', 'encuestas'],
    queryFn: async () => {
      const res = await fetch(\`\${apiBaseUrl}/encuestas/encuestas?pageSize=100\`, { headers: buildApiHeaders(token, companyId) })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron cargar las encuestas.')
      return payload.data
    },
    enabled: Boolean(token),
  })
}

function useCrearEncuesta({ token, companyId, apiBaseUrl }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values) => {
      const res = await fetch(\`\${apiBaseUrl}/encuestas/encuestas\`, {
        method: 'POST',
        headers: { ...buildApiHeaders(token, companyId), 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo crear.')
      return payload.data
    },
    onSuccess: () => {
      toast.success('Encuesta creada')
      queryClient.invalidateQueries({ queryKey: ['custom.encuestas'] })
    },
    onError: (error) => toast.error(error.message),
  })
}
\`\`\`

Empieza cada \`queryKey\` con la clave del módulo para no chocar con otras pantallas.

**Confirmación de una acción destructiva:**

\`\`\`jsx
import { useState } from 'react'
import { Button, ConfirmDialog } from '@runly/ui'

function DesactivarBoton({ onConfirm }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Desactivar</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="¿Desactivar la encuesta?"
        description="Dejará de aparecer en las listas." confirmLabel="Desactivar" onConfirm={onConfirm} />
    </>
  )
}
\`\`\`

**Gráfica con recharts** (usa los colores del tema):

\`\`\`jsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

<ResponsiveContainer width="100%" height={260}>
  <BarChart data={conteos}>
    <XAxis dataKey="opcion" />
    <YAxis allowDecimals={false} />
    <Tooltip />
    <Bar dataKey="total" fill="var(--brand-primary)" radius={[6, 6, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
\`\`\`

**Navegación** con la prop \`navigate\` o \`react-router-dom\`:

\`\`\`jsx
import { useParams } from 'react-router-dom'
navigate('/app/m/custom.encuestas/resultados')
\`\`\`

**Código QR** (generar y leer):

\`\`\`jsx
import QRCode from 'qrcode'
import { BrowserQRCodeReader } from '@zxing/browser'

const dataUrl = await QRCode.toDataURL('https://example.com/e/123')
const reader = new BrowserQRCodeReader()
const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
  if (result) { controls.stop(); onScan(result.getText()) }
})
\`\`\`

**Estado local compartido** entre componentes del módulo con \`zustand\`:

\`\`\`js
import { create } from 'zustand'
export const useFiltros = create((set) => ({ estado: 'TODAS', setEstado: (estado) => set({ estado }) }))
\`\`\`
`

// Public developer page (docs/developers/librerias.md, published on runly-web).
export function renderLibrariesDoc(catalog) {
  const rows = catalog.libraries.map((library) => `| \`${library.name}\` | ${library.version} | ${CATEGORY_LABELS[library.category]} | ${library.imports} |`)
  return [
    '---',
    'title: Librerías disponibles',
    'summary: Qué puedes importar en los componentes React de un módulo de Runly, con la versión exacta instalada.',
    'order: 6',
    '---',
    'Estas son las librerías que un componente de `components/` puede importar. Las marcadas como *incluidas en la app* se resuelven en tiempo de ejecución y no pesan en tu módulo; las demás las empaqueta esbuild dentro del bundle del módulo.',
    '',
    '| Librería | Versión | Disponibilidad | Qué importas |',
    '|---|---|---|---|',
    ...rows,
    '',
    USAGE,
    '## Librerías externas',
    '',
    'También puedes importar librerías ESM del navegador mediante una URL HTTPS completa, por ejemplo `https://esm.sh/<paquete>@<versión>`. El import se conserva en el bundle y el navegador lo descarga en tiempo de ejecución. Fija siempre la versión, usa sólo proveedores confiables y prefiere las librerías compartidas de la tabla para evitar depender de la red. No hay APIs de Node (`fs`, `path`, `crypto`) en el navegador.',
    '',
    '*Página generada por `scripts/generate-module-runtime-catalog.mjs` a partir de las versiones instaladas en Runly.*',
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = buildCatalog()
  fs.writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`)
  fs.writeFileSync(DOC_OUT, renderLibrariesDoc(catalog))
  console.log(`[runtime-catalog] ${path.relative(repoRoot, OUT)} y ${path.relative(repoRoot, DOC_OUT)} actualizados.`)
}
