// Loads a module's help content (overview.md + views/*.md, each with a tiny
// `key: value` frontmatter block) into HELP-kind blueprint objects ready to
// spread into a manifest's `blueprints: [...]` array. No YAML/gray-matter
// dependency — the frontmatter is deliberately just flat key:value lines,
// which is all title/summary/viewKey need.
import fs from 'node:fs'
import path from 'node:path'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function parseFrontmatter(raw) {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return { meta: {}, body: raw.trim() }
  const [, frontmatter, body] = match
  const meta = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key) meta[key] = value
  }
  return { meta, body: body.trim() }
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function loadHelpBlueprints(moduleKey, helpDir) {
  const blueprints = []

  const overviewPath = path.join(helpDir, 'overview.md')
  if (fs.existsSync(overviewPath)) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(overviewPath, 'utf8'))
    if (!meta.title || !meta.summary) {
      console.warn(`[help] ${moduleKey}: overview.md incompleto (falta title o summary), usando valores por defecto`)
    }
    blueprints.push({
      key: `${moduleKey}.help.overview`,
      kind: 'HELP',
      version: '0.1.0',
      schema: {
        scope: 'module',
        viewKey: null,
        title: meta.title || moduleKey,
        summary: meta.summary || '',
        content: body,
      },
    })
  }

  const viewsDir = path.join(helpDir, 'views')
  if (fs.existsSync(viewsDir)) {
    for (const file of fs.readdirSync(viewsDir)) {
      if (!file.endsWith('.md')) continue
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(viewsDir, file), 'utf8'))
      if (!meta.viewKey) {
        console.warn(`[help] ${moduleKey}: ${file} no declara "viewKey" en el frontmatter, se omite`)
        continue
      }
      const slug = slugify(file.replace(/\.md$/, ''))
      blueprints.push({
        key: `${moduleKey}.help.view.${slug}`,
        kind: 'HELP',
        version: '0.1.0',
        schema: {
          scope: 'view',
          viewKey: meta.viewKey,
          title: meta.title || meta.viewKey,
          summary: meta.summary || '',
          content: body,
        },
      })
    }
  }

  return blueprints
}
