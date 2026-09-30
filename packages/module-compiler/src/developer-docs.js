import { readFileSync } from 'node:fs'

// Offline copy of the public developer docs (docs/developers/*.md), shipped
// under docs/ in the Builder's "Descargar ZIP" only — not in compileModule(),
// so doc edits never change an installed module's packageHash. Regenerate with
// scripts/generate-module-developer-docs.mjs.
export const DEVELOPER_DOCS_DIR = 'docs'

const snapshot = JSON.parse(readFileSync(new URL('./developer-docs.json', import.meta.url), 'utf8'))

export function developerDocFiles() {
  return snapshot.files.map((file) => ({ path: `${DEVELOPER_DOCS_DIR}/${file.name}`, content: file.content }))
}

export function isDeveloperDocPath(filePath) {
  const value = String(filePath ?? '')
  return value.startsWith(`${DEVELOPER_DOCS_DIR}/`) && value.endsWith('.md') && !value.includes('..')
}
