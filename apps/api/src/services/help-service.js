// Read-only service backing GET /help/*. No AI, no Postgres FTS — the help
// bank is small (tens/low hundreds of short articles), so in-memory scoring
// is instant and keeps this feature working on any instance regardless of
// whether GROQ_API_KEY is configured. See
// docs/superpowers/specs/2026-09-26-module-help-system-design.md.

function pickArticle(schema) {
  return { title: schema.title, summary: schema.summary, content: schema.content }
}

// Manifests declare navigation.path / a HELP view's viewKey relative to the
// module's own screen (e.g. "/modules", "/company/address", "/"). The real
// frontend route is always prefixed with /app/m/<moduleKey>/... UNLESS the
// path opts out with an explicit "/app/" prefix (ModuleSidebar's
// buildFullPath, packages/ui/src/components/ModuleSidebar.jsx, has the exact
// same two rules) — e.g. runly.core's "Ayuda" nav entry points at the
// already-top-level /app/help screen, not a ModuleOutlet-routed one.
// currentPath here is already post-toApiPath (the /app prefix stripped), so
// this mirrors buildFullPath minus that prefix.
function toModuleApiPath(moduleKey, navPath) {
  if (!navPath) return null
  if (navPath.startsWith('/app/')) return navPath.slice(4) || '/'
  return navPath === '/' ? `/m/${moduleKey}` : `/m/${moduleKey}${navPath}`
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function buildSnippet(text, term) {
  const source = String(text ?? '')
  const idx = term ? normalize(source).indexOf(term) : -1
  if (idx === -1) return source.slice(0, 200).trim()
  const start = Math.max(0, idx - 80)
  const end = Math.min(source.length, idx + 120)
  return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`
}

export function createHelpService({ prisma }) {
  async function listModulesWithHelp() {
    const rows = await prisma.blueprint.findMany({
      where: { kind: 'HELP', enabled: true, module: { status: 'INSTALLED', enabled: true } },
      include: { module: true },
    })
    const byModule = new Map()
    for (const row of rows) {
      if (row.schema?.scope !== 'module') continue
      byModule.set(row.module.key, {
        moduleKey: row.module.key,
        name: row.module.name,
        icon: row.module.manifest?.icon ?? null,
        summary: row.schema.summary ?? '',
      })
    }
    return [...byModule.values()]
  }

  async function getModuleHelp(moduleKey) {
    const module_ = await prisma.runlyModule.findFirst({
      where: { key: moduleKey, status: 'INSTALLED', enabled: true },
    })
    if (!module_) return null

    const rows = await prisma.blueprint.findMany({
      where: { kind: 'HELP', enabled: true, moduleId: module_.id },
    })
    const overviewRow = rows.find((r) => r.schema?.scope === 'module')
    const viewRows = rows.filter((r) => r.schema?.scope === 'view')
    return {
      moduleKey,
      name: module_.name,
      overview: overviewRow ? pickArticle(overviewRow.schema) : null,
      views: viewRows.map((r) => ({
        viewKey: r.schema.viewKey,
        title: r.schema.title,
        summary: r.schema.summary,
      })),
    }
  }

  async function resolveHelp(currentPath) {
    const modules = await prisma.runlyModule.findMany({
      where: { status: 'INSTALLED', enabled: true },
    })

    const candidates = modules.flatMap((module_) =>
      (module_.manifest?.navigation ?? [])
        .map((nav) => ({ module: module_, navPath: toModuleApiPath(module_.key, nav.path) }))
        .filter((c) => c.navPath),
    )
    const matchedOwner = candidates
      .filter((c) => currentPath === c.navPath || currentPath.startsWith(`${c.navPath}/`))
      .sort((a, b) => b.navPath.length - a.navPath.length)[0]

    // Screens that aren't declared in any module's own navigation (the
    // app-shell home screen, an unknown/typo'd route) still get general
    // orientation instead of no help at all — runly.core is always
    // installed, so this fallback never itself returns null.
    const fallbackModule = matchedOwner ? null : modules.find((m) => m.key === 'runly.core')
    const owner = matchedOwner ?? (fallbackModule ? { module: fallbackModule, navPath: null } : null)

    if (!owner) {
      return { moduleKey: null, moduleName: null, overview: null, view: null }
    }

    const rows = await prisma.blueprint.findMany({
      where: { kind: 'HELP', enabled: true, moduleId: owner.module.id },
    })
    const overviewRow = rows.find((r) => r.schema?.scope === 'module')
    const viewRow = matchedOwner
      ? rows
          .filter((r) => r.schema?.scope === 'view')
          .map((r) => ({ row: r, apiPath: toModuleApiPath(owner.module.key, r.schema.viewKey) }))
          .filter(({ apiPath }) => apiPath && (currentPath === apiPath || currentPath.startsWith(`${apiPath}/`)))
          .sort((a, b) => b.apiPath.length - a.apiPath.length)[0]?.row
      : undefined

    return {
      moduleKey: owner.module.key,
      moduleName: owner.module.name,
      overview: overviewRow ? pickArticle(overviewRow.schema) : null,
      view: viewRow ? pickArticle(viewRow.schema) : null,
    }
  }

  async function searchHelp(query) {
    const rows = await prisma.blueprint.findMany({
      where: { kind: 'HELP', enabled: true, module: { status: 'INSTALLED', enabled: true } },
      include: { module: true },
    })
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    const results = []
    for (const row of rows) {
      const haystack = normalize(`${row.schema.title} ${row.schema.summary} ${row.schema.content}`)
      let score = 0
      for (const term of terms) {
        score += haystack.split(term).length - 1
      }
      if (score > 0) {
        results.push({
          moduleKey: row.module.key,
          moduleName: row.module.name,
          viewKey: row.schema.viewKey ?? null,
          title: row.schema.title,
          snippet: buildSnippet(row.schema.content || row.schema.summary, terms[0]),
          score,
        })
      }
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, 20)
  }

  return { listModulesWithHelp, getModuleHelp, resolveHelp, searchHelp }
}
