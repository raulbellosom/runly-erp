// Static design review for module React sources (spec
// 2026-10-03-rme3-module-platform-v2 §5.3). Line based on purpose: no parser
// dependency, fast, and precise enough to point a person or an AI at the exact
// line to fix. Findings never block an upload in v1.
const RULES = [
  { rule: 'native-select', severity: 'error', re: /<select[\s>]/, message: 'Usa SelectField o ComboboxField de @runly/ui en lugar de <select>.' },
  { rule: 'native-input', severity: 'error', re: /<input[\s>/]/, message: 'Usa TextField, CheckboxField o DatePickerField de @runly/ui en lugar de <input>.' },
  { rule: 'native-textarea', severity: 'error', re: /<textarea[\s>]/, message: 'Usa TextareaField de @runly/ui en lugar de <textarea>.' },
  { rule: 'window-dialog', severity: 'error', re: /window\.(confirm|alert|prompt)\s*\(/, message: 'No uses window.confirm/alert/prompt: usa ConfirmDialog o Dialog de @runly/ui.' },
  { rule: 'react-default-import', severity: 'error', re: /import\s+React\b/, message: "Importa los hooks por nombre (import { useState } from 'react'); no uses import React." },
  { rule: 'fixed-color', severity: 'warning', re: /\b(?:bg|text|border)-(?:white|black)\b|\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/, message: 'Color fijo: usa los tokens del tema (bg-card, text-foreground, border-border) para que funcione en modo claro y oscuro.' },
  { rule: 'emoji', severity: 'warning', re: /\p{Extended_Pictographic}/u, message: 'Runly no usa emojis en la interfaz: usa un icono de lucide-react.' },
]

const SOURCE_RE = /\.(?:jsx?|mjs)$/
const COMMENT_RE = /^\s*(?:\/\/|\*|\/\*)/
const SCREEN_RE = /export\s+default\s+function/
const HEADER_RE = /\b(?:PageHeader|ModulePage)\b/
const RELATIVE_IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

function resolveRelative(fromPath, specifier) {
  const parts = fromPath.split('/').slice(0, -1)
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment !== '.') parts.push(segment)
  }
  return parts.join('/')
}

function relativeImports(file) {
  return [...String(file.content ?? '').matchAll(RELATIVE_IMPORT_RE)].map((m) => resolveRelative(file.path, m[1]))
}

// Screens are the files components/index.js imports (what registry.register
// exposes as views). Without an index, every default-exported .jsx counts.
function screenPaths(files) {
  const index = files.find((file) => /^components\/index\.m?js$/.test(file.path))
  const imported = index ? new Set(relativeImports(index)) : null
  return imported?.size ? imported : null
}

// A screen may delegate its layout to a local component (Page -> CatalogPage);
// it is fine when that component (one level) renders the header.
function hasHeader(file, byPath) {
  if (HEADER_RE.test(file.content)) return true
  return relativeImports(file).some((target) => HEADER_RE.test(byPath.get(target)?.content ?? ''))
}

export function reviewComponentSources(files) {
  const findings = []
  const list = files ?? []
  const byPath = new Map(list.map((file) => [file.path, file]))
  const screens = screenPaths(list)
  for (const file of list) {
    if (!SOURCE_RE.test(file.path)) continue
    const content = String(file.content ?? '')
    const lines = content.split(/\r?\n/)
    lines.forEach((text, index) => {
      if (COMMENT_RE.test(text)) return
      for (const rule of RULES) {
        if (rule.re.test(text)) findings.push({ file: file.path, line: index + 1, rule: rule.rule, severity: rule.severity, message: rule.message })
      }
    })
    const isScreen = /\.jsx$/.test(file.path) && SCREEN_RE.test(content) && (!screens || screens.has(file.path))
    if (isScreen && !hasHeader(file, byPath)) {
      const line = lines.findIndex((text) => SCREEN_RE.test(text)) + 1
      findings.push({ file: file.path, line, rule: 'no-page-header', severity: 'warning', message: 'Toda pantalla empieza con PageHeader (o ModulePage).' })
    }
  }
  return findings
}
