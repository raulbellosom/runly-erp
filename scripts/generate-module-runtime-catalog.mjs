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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, `${JSON.stringify(buildCatalog(), null, 2)}\n`)
  console.log(`[runtime-catalog] ${path.relative(repoRoot, OUT)} actualizado.`)
}
