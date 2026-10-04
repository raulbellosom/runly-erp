export const DEVELOPER_DOCS_DIR = 'docs'

// docs/*.md (developer docs) and docs/ejemplos/*.jsx (golden screens,
// templates/golden-screens.js): shipped in the download, ignored on upload.
export function isDeveloperDocPath(filePath) {
  const value = String(filePath ?? '')
  if (!value.startsWith(`${DEVELOPER_DOCS_DIR}/`) || value.includes('..')) return false
  return value.endsWith('.md') || (value.startsWith(`${DEVELOPER_DOCS_DIR}/ejemplos/`) && value.endsWith('.jsx'))
}
