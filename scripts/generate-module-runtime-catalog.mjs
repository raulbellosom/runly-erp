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
    'También puedes importar librerías del navegador desde `https://esm.sh/<paquete>`, pero prefiere las de la tabla. No hay APIs de Node (`fs`, `path`, `crypto`) en el navegador.',
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
