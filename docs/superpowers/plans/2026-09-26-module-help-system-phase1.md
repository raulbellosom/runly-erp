# Module Help System — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every module a versioned, markdown-authored help bank (module overview + per-view articles), synced through the existing Blueprint mechanism, exposed via a read-only `/help/*` API and two frontend surfaces (a contextual help sheet + a browsable/searchable `/help` page) — with zero dependency on any AI engine.

**Architecture:** Reuse the existing `Blueprint` table (new `HELP` enum value on `BlueprintKind`, zero new tables) so content syncs exactly like every other blueprint kind already does on module install/enable/sync. A new dependency-free markdown+frontmatter loader (`@runly/module-engine`) turns `help/overview.md` + `help/views/*.md` files into blueprint entries at manifest-definition time. A thin `help-service.js` does in-memory keyword search/prefix-matching over those rows (no Postgres FTS, no AI). Frontend: a persistent header button opens a contextual `Sheet`, plus a full `/help` page, both rendering content with the already-existing `MarkdownViewer` component.

**Tech Stack:** Node.js, Hono, Prisma 7, Zod, React, react-router-dom, TanStack Query, `@runly/ui` (`Sheet`, `MarkdownViewer`, `PageHeader`, `EmptyState`, `Input`), Node's built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-26-module-help-system-design.md` — read it first for full rationale, edge cases, and the Phase 2-4 roadmap (not built in this plan).

---

### Task 1: Add `HELP` to `BlueprintKind` + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260926000000_blueprint_kind_add_help/migration.sql`

- [ ] **Step 1: Edit the enum**

In `prisma/schema.prisma`, find:

```prisma
enum BlueprintKind {
  ENTITY
  FORM
  TABLE
  DASHBOARD
  ACTION
  RELATION
  PERMISSION
  @@map("blueprint_kind")
}
```

Replace with:

```prisma
enum BlueprintKind {
  ENTITY
  FORM
  TABLE
  DASHBOARD
  ACTION
  RELATION
  PERMISSION
  HELP
  @@map("blueprint_kind")
}
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260926000000_blueprint_kind_add_help/migration.sql`:

```sql
-- Adds the HELP blueprint kind used by the module help system (per-module
-- and per-view markdown documentation synced through the existing
-- Blueprint table — see docs/superpowers/specs/2026-09-26-module-help-system-design.md).
-- Additive only: no existing row uses this value.

ALTER TYPE "blueprint_kind" ADD VALUE IF NOT EXISTS 'HELP';
```

- [ ] **Step 3: Apply and regenerate**

Run: `pnpm db:migrate`
Expected: migration applies cleanly, then `prisma generate` finishes with no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260926000000_blueprint_kind_add_help
git commit -m "feat(prisma): add HELP blueprint kind for module help system"
```

---

### Task 2: Shared help-blueprint loader (`@runly/module-engine`)

**Files:**
- Create: `packages/module-engine/src/load-help-blueprints.js`
- Modify: `packages/module-engine/src/index.js`
- Test: `packages/module-engine/src/__tests__/load-help-blueprints.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/module-engine/src/__tests__/load-help-blueprints.test.js`:

```js
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHelpBlueprints } from '../load-help-blueprints.js'

function makeTmpHelpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runly-help-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }
  return dir
}

describe('loadHelpBlueprints', () => {
  it('returns [] when the help directory does not exist', () => {
    const result = loadHelpBlueprints('custom.nothing', '/does/not/exist')
    assert.deepEqual(result, [])
  })

  it('loads overview.md into a scope:module blueprint', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\ntitle: Flotas\nsummary: Gestiona vehiculos y mantenimientos.\n---\nContenido completo.\n',
    })
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.equal(result.length, 1)
    assert.equal(result[0].key, 'custom.fleet.help.overview')
    assert.equal(result[0].kind, 'HELP')
    assert.equal(result[0].schema.scope, 'module')
    assert.equal(result[0].schema.title, 'Flotas')
    assert.equal(result[0].schema.summary, 'Gestiona vehiculos y mantenimientos.')
    assert.equal(result[0].schema.content, 'Contenido completo.')
  })

  it('loads views/*.md into scope:view blueprints keyed by viewKey', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\ntitle: Flotas\nsummary: resumen\n---\ncuerpo\n',
      'views/vehiculos.md': '---\nviewKey: /fleet/vehicles\ntitle: Vehiculos\nsummary: Lista de vehiculos.\n---\nDetalle de vehiculos.\n',
    })
    const result = loadHelpBlueprints('custom.fleet', dir)
    const view = result.find((bp) => bp.schema.scope === 'view')
    assert.ok(view, 'expected a view-scoped blueprint')
    assert.equal(view.key, 'custom.fleet.help.view.vehiculos')
    assert.equal(view.schema.viewKey, '/fleet/vehicles')
    assert.equal(view.schema.title, 'Vehiculos')
    assert.equal(view.schema.content, 'Detalle de vehiculos.')
  })

  it('skips a view file missing viewKey and warns instead of throwing', () => {
    const dir = makeTmpHelpDir({
      'views/broken.md': '---\ntitle: Roto\n---\ncuerpo\n',
    })
    const warn = mock.method(console, 'warn', () => {})
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.deepEqual(result, [])
    assert.equal(warn.mock.calls.length, 1)
    warn.mock.restore()
  })

  it('falls back to moduleKey/empty summary when overview frontmatter is incomplete, and warns', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\n---\ncuerpo sin metadata\n',
    })
    const warn = mock.method(console, 'warn', () => {})
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.equal(result[0].schema.title, 'custom.fleet')
    assert.equal(result[0].schema.summary, '')
    assert.equal(warn.mock.calls.length, 1)
    warn.mock.restore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/module-engine/src/__tests__/load-help-blueprints.test.js`
Expected: FAIL — `Cannot find module '../load-help-blueprints.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/module-engine/src/load-help-blueprints.js`:

```js
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
```

- [ ] **Step 4: Export it**

In `packages/module-engine/src/index.js`, after the `definePage` export line, add:

```js
export { loadHelpBlueprints }             from './load-help-blueprints.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/module-engine/src/__tests__/load-help-blueprints.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/module-engine/src/load-help-blueprints.js packages/module-engine/src/index.js packages/module-engine/src/__tests__/load-help-blueprints.test.js
git commit -m "feat(module-engine): add loadHelpBlueprints markdown loader"
```

---

### Task 3: Validators for the help query params

**Files:**
- Modify: `packages/validators/src/index.js`
- Test: `packages/validators/src/__tests__/help-schemas.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/validators/src/__tests__/help-schemas.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { helpSearchQuerySchema, helpResolvePathQuerySchema } from '../index.js'

describe('help query schemas', () => {
  it('helpSearchQuerySchema accepts a 2-200 char query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: 'vehiculos' })
    assert.equal(result.success, true)
  })

  it('helpSearchQuerySchema rejects a 1-char query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: 'a' })
    assert.equal(result.success, false)
  })

  it('helpSearchQuerySchema rejects a missing query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: undefined })
    assert.equal(result.success, false)
  })

  it('helpResolvePathQuerySchema accepts a route path', () => {
    const result = helpResolvePathQuerySchema.safeParse({ path: '/fleet/vehicles' })
    assert.equal(result.success, true)
  })

  it('helpResolvePathQuerySchema rejects an empty path', () => {
    const result = helpResolvePathQuerySchema.safeParse({ path: '' })
    assert.equal(result.success, false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/validators/src/__tests__/help-schemas.test.js`
Expected: FAIL — `helpSearchQuerySchema is not a function` / undefined export

- [ ] **Step 3: Add the schemas**

At the end of `packages/validators/src/index.js`, add:

```js
// Module help system (docs/superpowers/specs/2026-09-26-module-help-system-design.md)
export const helpSearchQuerySchema = z.object({
  q: z.string().min(2).max(200),
});

export const helpResolvePathQuerySchema = z.object({
  path: z.string().min(1).max(500),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/validators/src/__tests__/help-schemas.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/index.js packages/validators/src/__tests__/help-schemas.test.js
git commit -m "feat(validators): add help search/resolve query schemas"
```

---

### Task 4: `help-service.js`

**Files:**
- Create: `apps/api/src/services/help-service.js`
- Test: `apps/api/src/services/__tests__/help-service.test.js`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/help-service.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHelpService } from '../help-service.js'

const FLEET_MODULE = {
  id: 'mod-fleet',
  key: 'custom.fleet',
  name: 'Flotas',
  status: 'INSTALLED',
  enabled: true,
  manifest: { icon: 'Truck', navigation: [{ path: '/fleet/vehicles', label: 'Vehiculos' }] },
}

const CORE_MODULE = {
  id: 'mod-core',
  key: 'runly.core',
  name: 'Runly Core',
  status: 'INSTALLED',
  enabled: true,
  manifest: { icon: 'Layers', navigation: [{ path: '/modules', label: 'Modulos' }] },
}

const HELP_ROWS = [
  {
    moduleId: 'mod-fleet',
    kind: 'HELP',
    enabled: true,
    module: FLEET_MODULE,
    schema: { scope: 'module', viewKey: null, title: 'Flotas', summary: 'Gestiona vehiculos.', content: 'Modulo de flotas completo.' },
  },
  {
    moduleId: 'mod-fleet',
    kind: 'HELP',
    enabled: true,
    module: FLEET_MODULE,
    schema: { scope: 'view', viewKey: '/fleet/vehicles', title: 'Vehiculos', summary: 'Lista de vehiculos.', content: 'Aqui puedes dar de alta un vehiculo nuevo.' },
  },
];

function makePrisma({ modules = [CORE_MODULE, FLEET_MODULE], helpRows = HELP_ROWS } = {}) {
  return {
    runlyModule: {
      findMany: async ({ where }) => modules.filter((m) => {
        if (where?.status && m.status !== where.status) return false
        if (where?.enabled !== undefined && m.enabled !== where.enabled) return false
        if (where?.key && m.key !== where.key) return false
        return true
      }),
      findFirst: async ({ where }) => modules.find((m) =>
        m.key === where.key && m.status === where.status && m.enabled === where.enabled
      ) ?? null,
    },
    blueprint: {
      findMany: async ({ where }) => helpRows.filter((row) => {
        if (where?.kind && row.kind !== where.kind) return false
        if (where?.enabled !== undefined && row.enabled !== where.enabled) return false
        if (where?.moduleId && row.moduleId !== where.moduleId) return false
        if (where?.module?.key && row.module.key !== where.module.key) return false
        return true
      }),
    },
  }
}

describe('help-service', () => {
  it('listModulesWithHelp returns one entry per module with a module-scope article', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.listModulesWithHelp()
    assert.equal(result.length, 1)
    assert.equal(result[0].moduleKey, 'custom.fleet')
    assert.equal(result[0].summary, 'Gestiona vehiculos.')
  })

  it('getModuleHelp returns overview + views for an installed module', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.getModuleHelp('custom.fleet')
    assert.equal(result.overview.title, 'Flotas')
    assert.equal(result.views.length, 1)
    assert.equal(result.views[0].viewKey, '/fleet/vehicles')
  })

  it('getModuleHelp returns null for a module that is not installed', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.getModuleHelp('custom.unknown')
    assert.equal(result, null)
  })

  it('resolveHelp matches the view by exact path and returns both view + overview', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/fleet/vehicles')
    assert.equal(result.moduleKey, 'custom.fleet')
    assert.equal(result.view.title, 'Vehiculos')
    assert.equal(result.overview.title, 'Flotas')
  })

  it('resolveHelp falls back to overview-only when no view matches', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/modules')
    assert.equal(result.moduleKey, 'runly.core')
    assert.equal(result.view, null)
  })

  it('resolveHelp returns nulls when the path belongs to no known module', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/unknown/path')
    assert.equal(result.moduleKey, null)
  })

  it('searchHelp finds matches across module and view content, accent-insensitive', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.searchHelp('vehiculo')
    assert.ok(result.length >= 1)
    assert.ok(result.some((r) => r.viewKey === '/fleet/vehicles'))
  })

  it('searchHelp returns [] when nothing matches', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.searchHelp('xyzxyz')
    assert.deepEqual(result, [])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/services/__tests__/help-service.test.js`
Expected: FAIL — `Cannot find module '../help-service.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/services/help-service.js`:

```js
// Read-only service backing GET /help/*. No AI, no Postgres FTS — the help
// bank is small (tens/low hundreds of short articles), so in-memory scoring
// is instant and keeps this feature working on any instance regardless of
// whether GROQ_API_KEY is configured. See
// docs/superpowers/specs/2026-09-26-module-help-system-design.md.

function pickArticle(schema) {
  return { title: schema.title, summary: schema.summary, content: schema.content }
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
      (module_.manifest?.navigation ?? []).map((nav) => ({ module: module_, navPath: nav.path })),
    )
    const owner = candidates
      .filter((c) => currentPath === c.navPath || currentPath.startsWith(`${c.navPath}/`))
      .sort((a, b) => b.navPath.length - a.navPath.length)[0]

    if (!owner) {
      return { moduleKey: null, moduleName: null, overview: null, view: null }
    }

    const rows = await prisma.blueprint.findMany({
      where: { kind: 'HELP', enabled: true, moduleId: owner.module.id },
    })
    const overviewRow = rows.find((r) => r.schema?.scope === 'module')
    const viewRow = rows
      .filter((r) => r.schema?.scope === 'view')
      .filter((r) => currentPath === r.schema.viewKey || currentPath.startsWith(`${r.schema.viewKey}/`))
      .sort((a, b) => b.schema.viewKey.length - a.schema.viewKey.length)[0]

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/services/__tests__/help-service.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/help-service.js apps/api/src/services/__tests__/help-service.test.js
git commit -m "feat(api): add help-service (in-memory help resolve/search)"
```

---

### Task 5: `help-routes.js` router

**Files:**
- Create: `apps/api/src/routes/help/help-routes.js`
- Test: `apps/api/src/routes/help/__tests__/help-routes.test.js`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/help/__tests__/help-routes.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHelpRouter } from '../help-routes.js'

function createRequirePermission() {
  return (permissionKey) => async (c, next) => {
    const permissions = new Set(
      (c.req.header('X-Test-Permissions') ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    if (!permissions.has(permissionKey)) {
      return c.json({ error: `missing:${permissionKey}` }, 403)
    }
    await next()
  }
}

const PRISMA_STUB = {
  runlyModule: {
    findMany: async () => [],
    findFirst: async () => null,
  },
  blueprint: {
    findMany: async () => [],
  },
}

function makeApp() {
  return createHelpRouter({ prisma: PRISMA_STUB, requirePermission: createRequirePermission() })
}

async function get(app, path, headers = {}) {
  const res = await app.request(`http://localhost${path}`, { headers })
  return { status: res.status, body: await res.json() }
}

describe('help-routes', () => {
  it('GET /help/modules without permission -> 403', async () => {
    const { status } = await get(makeApp(), '/help/modules')
    assert.equal(status, 403)
  })

  it('GET /help/modules with permission -> 200 with data []', async () => {
    const { status, body } = await get(makeApp(), '/help/modules', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.deepEqual(body.data, [])
  })

  it('GET /help/modules/:moduleKey for an unknown module -> 404', async () => {
    const { status } = await get(makeApp(), '/help/modules/custom.unknown', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 404)
  })

  it('GET /help/search with a 1-char q -> 400', async () => {
    const { status } = await get(makeApp(), '/help/search?q=a', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 400)
  })

  it('GET /help/search with a valid q -> 200 with data []', async () => {
    const { status, body } = await get(makeApp(), '/help/search?q=vehiculos', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.deepEqual(body.data, [])
  })

  it('GET /help/resolve without path -> 400', async () => {
    const { status } = await get(makeApp(), '/help/resolve', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 400)
  })

  it('GET /help/resolve with path -> 200', async () => {
    const { status, body } = await get(makeApp(), '/help/resolve?path=%2Ffleet%2Fvehicles', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.equal(body.data.moduleKey, null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/help/__tests__/help-routes.test.js`
Expected: FAIL — `Cannot find module '../help-routes.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/routes/help/help-routes.js`:

```js
// GET /help/* — read-only module help/documentation endpoints. Every route
// is guarded by the single "runly.help.read" permission (granted to every
// user via BASE_PERMISSION_KEYS in index.js — help content is not sensitive
// business data, see docs/superpowers/specs/2026-09-26-module-help-system-design.md §18).
import { Hono } from 'hono'
import { helpSearchQuerySchema, helpResolvePathQuerySchema } from '@runly/validators'
import { createHelpService } from '../../services/help-service.js'

export function createHelpRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const helpService = createHelpService({ prisma })
  const guard = requirePermission('runly.help.read')

  app.get('/help/modules', guard, async (c) => {
    const data = await helpService.listModulesWithHelp()
    return c.json({ data })
  })

  app.get('/help/modules/:moduleKey', guard, async (c) => {
    const data = await helpService.getModuleHelp(c.req.param('moduleKey'))
    if (!data) return c.json({ error: 'Modulo no encontrado.' }, 404)
    return c.json({ data })
  })

  app.get('/help/resolve', guard, async (c) => {
    const parsed = helpResolvePathQuerySchema.safeParse({ path: c.req.query('path') })
    if (!parsed.success) return c.json({ error: 'path invalido.' }, 400)
    const data = await helpService.resolveHelp(parsed.data.path)
    return c.json({ data })
  })

  app.get('/help/search', guard, async (c) => {
    const parsed = helpSearchQuerySchema.safeParse({ q: c.req.query('q') })
    if (!parsed.success) return c.json({ error: 'q invalido (2-200 caracteres).' }, 400)
    const data = await helpService.searchHelp(parsed.data.q)
    return c.json({ data })
  })

  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/help/__tests__/help-routes.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/help/help-routes.js apps/api/src/routes/help/__tests__/help-routes.test.js
git commit -m "feat(api): add /help/* router"
```

---

### Task 6: Mount the router + wire the permission

**Files:**
- Modify: `apps/api/src/index.js`
- Modify: `apps/api/src/permission-catalog.js`

- [ ] **Step 1: Import and mount the router**

In `apps/api/src/index.js`, near the other thin-router imports (after line 43, `import { createHrRouter } from "./routes/hr-routes.js";`), add:

```js
import { createHelpRouter } from "./routes/help/help-routes.js";
```

Near the other `mountWithAuth` calls (after line 2192, `mountWithAuth(app, createHrRouter({ prisma, supabaseAdmin, requirePermission }));`), add:

```js
mountWithAuth(app, createHelpRouter({ prisma, requirePermission }));
```

- [ ] **Step 2: Grant `runly.help.read` to every authenticated user**

In `apps/api/src/index.js`, find:

```js
const BASE_PERMISSION_KEYS = new Set(["profile.self.read"]);
```

Replace with:

```js
const BASE_PERMISSION_KEYS = new Set(["profile.self.read", "runly.help.read"]);
```

- [ ] **Step 3: Add the permission to the catalog**

In `apps/api/src/permission-catalog.js`, inside `PERMISSION_CATALOG`, add an entry near the other `core.*` keys:

```js
"runly.help.read": {
  displayNameEs: "Ver ayuda del sistema",
  descriptionEs: "Permite consultar la ayuda y documentacion de los modulos instalados.",
  groupKey: "core",
  order: 15,
},
```

- [ ] **Step 4: Verify the API still boots**

Run: `node --check apps/api/src/index.js`
Expected: no syntax errors.

Run (from repo root, requires configured `.env`): `node apps/api/src/index.js` for a few seconds, then stop it (Ctrl+C).
Expected: boots without throwing, logs its usual startup lines.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.js apps/api/src/permission-catalog.js
git commit -m "feat(api): mount /help router and grant runly.help.read to every user"
```

---

### Task 7: `runly.core` manifest — permission, navigation, blueprints, real content

**Files:**
- Modify: `apps/api/src/manifests/official/core-modules.js`
- Create: `apps/api/src/manifests/official/help/runly.core/overview.md`
- Create: `apps/api/src/manifests/official/help/runly.core/views/modulos.md`
- Create: `apps/api/src/manifests/official/help/runly.core/views/configuracion.md`

- [ ] **Step 1: Write the help content files**

Create `apps/api/src/manifests/official/help/runly.core/overview.md`:

```md
---
title: Runly Core
summary: El nucleo del sistema: administra los modulos instalados, la configuracion general de la instancia y la bitacora de auditoria.
---
Runly Core es el modulo base de todo el ERP. Siempre esta instalado y no se puede desinstalar.

Desde aqui se administra:

- **Modulos**: instalar, habilitar, deshabilitar o desinstalar los demas modulos del sistema.
- **Configuracion**: ajustes generales de la instancia (nombre de la empresa, zona horaria, preferencias).
- **Bitacora de auditoria**: quien hizo que y cuando, sobre cualquier entidad del sistema.

### Alcances y limites

- Runly Core no gestiona datos de negocio (eso lo hacen los demas modulos) — solo administra el sistema en si.
- Instalar o desinstalar un modulo requiere permiso; pidele a un administrador que te lo asigne si no ves la opcion.
```

Create `apps/api/src/manifests/official/help/runly.core/views/modulos.md`:

```md
---
viewKey: /modules
title: Modulos
summary: Instala, habilita, deshabilita o desinstala los modulos disponibles en esta instancia.
---
En esta pantalla ves el catalogo completo de modulos disponibles para tu instancia de Runly.

- Los modulos **core** (como este) siempre estan instalados y no se pueden desinstalar.
- Los modulos **opcionales** se pueden instalar, deshabilitar temporalmente o desinstalar.
- Al desinstalar puedes elegir conservar los datos o purgarlos por completo (con confirmacion explicita).
- Deshabilitar un modulo no borra sus datos: solo lo oculta de la navegacion y bloquea su API hasta que lo vuelvas a habilitar.
```

Create `apps/api/src/manifests/official/help/runly.core/views/configuracion.md`:

```md
---
viewKey: /settings
title: Configuracion
summary: Ajustes generales de la instancia: datos de la empresa, preferencias y parametros de la plataforma.
---
Aqui se configuran los ajustes generales que aplican a toda la instancia de Runly, no a un modulo en particular.

- Cambios aqui afectan a todas las companias de esta instancia.
- Solo usuarios con el permiso de administracion de la plataforma pueden modificar estos valores.
```

- [ ] **Step 2: Wire the loader into the manifest**

In `apps/api/src/manifests/official/core-modules.js`, add near the top imports:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHelpBlueprints } from "@runly/module-engine";

const HELP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "help");
```

- [ ] **Step 3: Add the permission**

In the `runlyCoreMap` manifest's `permissions:` array (right after `{ key: "audit.read", name: "Read Audit Logs" },`), add:

```js
{ key: "runly.help.read", name: "Read Module Help" },
```

- [ ] **Step 4: Add the navigation entry**

In the `runlyCoreMap` manifest's `navigation:` array, after the `"Configuracion"` entry, add:

```js
{
  label: "Ayuda",
  path: "/help",
  icon: "BookOpen",
  layout: "main",
  permissionKey: "runly.help.read",
},
```

(`BookOpen` is already in `packages/ui/src/components/AppShell.jsx`'s icon map, so it renders even if that shell is used; the desktop app's own sidebar icon set is verified in Task 10.)

- [ ] **Step 5: Spread the help blueprints and bump the version**

In the `runlyCoreMap` manifest, change:

```js
version: "0.1.0",
```

to:

```js
version: "0.2.0",
```

Then in the `blueprints:` array, after the existing `atlas.module.entity` object, add:

```js
...loadHelpBlueprints("runly.core", path.join(HELP_DIR, "runly.core")),
```

(so the array is `blueprints: [ { key: "atlas.module.entity", ... }, ...loadHelpBlueprints(...) ]`).

- [ ] **Step 6: Verify the manifest file still loads**

Run: `node --check apps/api/src/manifests/official/core-modules.js`
Expected: no syntax errors.

Run: `node -e "import('./apps/api/src/manifests/official/core-modules.js').then(m => console.log(m.runlyCoreMap.blueprints.map(b => b.key)))"`
Expected: prints an array including `atlas.module.entity`, `runly.core.help.overview`, `runly.core.help.view.modulos`, `runly.core.help.view.configuracion`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/manifests/official/core-modules.js apps/api/src/manifests/official/help/runly.core
git commit -m "feat(runly.core): add help content (overview + modulos + configuracion), bump to 0.2.0"
```

---

### Task 8: Seed and live smoke-test the backend

**Files:** none (verification only)

- [ ] **Step 1: Run the seed**

Run: `pnpm db:seed`
Expected: completes without error; `runly.help.read` now exists as a `Permission` row (core modules are re-synced by the seed script).

- [ ] **Step 2: Sync runly.core so its new blueprints land**

With the API running (`pnpm dev:api` in another terminal, or boot it directly), call:

```bash
curl -s -X POST http://localhost:4010/modules/runly.core/sync \
  -H "Authorization: Bearer $RUNLY_TOKEN" | head -c 500
```

Expected: 200 response; no error.

- [ ] **Step 3: Smoke-test the endpoints**

```bash
curl -s http://localhost:4010/help/modules -H "Authorization: Bearer $RUNLY_TOKEN"
curl -s "http://localhost:4010/help/modules/runly.core" -H "Authorization: Bearer $RUNLY_TOKEN"
curl -s "http://localhost:4010/help/resolve?path=/modules" -H "Authorization: Bearer $RUNLY_TOKEN"
curl -s "http://localhost:4010/help/search?q=vehiculos" -H "Authorization: Bearer $RUNLY_TOKEN"
```

Expected: all 200; the first three include `runly.core` content (title "Runly Core", "Modulos", etc.); do not print the token itself in any output you keep.

- [ ] **Step 4: Run the full backend test suite**

Run: `node --test apps/api/src/services/__tests__/ apps/api/src/routes/help/__tests__/ packages/module-engine/src/__tests__/ packages/validators/src/__tests__/`
Expected: all green, no regressions in neighboring test files in those directories.

No commit for this task (verification only).

---

### Task 9: SDK `help` domain

**Files:**
- Modify: `packages/sdk/src/index.js`
- Test: `packages/sdk/src/__tests__/help-domain.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/__tests__/help-domain.test.js`:

```js
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

function makeFetch(status = 200, body = { data: [] }) {
  return mock.fn(async (url) => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
}

describe('runly SDK — help namespace', () => {
  it('listModules GETs /help/modules', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.listModules('tok')
    const [url, opts] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/modules')
    assert.equal(opts.headers.Authorization, 'Bearer tok')
    fetchMock.mock.restore()
  })

  it('getModuleHelp GETs /help/modules/:moduleKey', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.getModuleHelp('runly.core', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/modules/runly.core')
    fetchMock.mock.restore()
  })

  it('resolveHelp GETs /help/resolve with an encoded path query', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.resolveHelp('/fleet/vehicles', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/resolve?path=%2Ffleet%2Fvehicles')
    fetchMock.mock.restore()
  })

  it('searchHelp GETs /help/search with a q query', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.searchHelp('vehiculos', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/search?q=vehiculos')
    fetchMock.mock.restore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/sdk/src/__tests__/help-domain.test.js`
Expected: FAIL — `client.help is undefined`

- [ ] **Step 3: Add the domain**

In `packages/sdk/src/index.js`, inside the object returned by `createRunlyClient`, add a sibling key next to the other domains (e.g. near `contacts:`):

```js
help: {
  listModules: (token) =>
    request("/help/modules", { headers: withAuthHeaders(token) }),
  getModuleHelp: (moduleKey, token) =>
    request(`/help/modules/${encodeURIComponent(moduleKey)}`, { headers: withAuthHeaders(token) }),
  resolveHelp: (path, token) =>
    request(`/help/resolve?path=${encodeURIComponent(path)}`, { headers: withAuthHeaders(token) }),
  searchHelp: (query, token) =>
    request(`/help/search?q=${encodeURIComponent(query)}`, { headers: withAuthHeaders(token) }),
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/sdk/src/__tests__/help-domain.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/index.js packages/sdk/src/__tests__/help-domain.test.js
git commit -m "feat(sdk): add help domain (listModules/getModuleHelp/resolveHelp/searchHelp)"
```

---

### Task 10: Frontend — contextual help button + sheet

**Files:**
- Create: `apps/desktop/src/components/HelpButton.jsx`
- Modify: `apps/desktop/src/components/Topbar.jsx`

- [ ] **Step 1: Write the component**

Create `apps/desktop/src/components/HelpButton.jsx`:

```jsx
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  EmptyState,
  MarkdownViewer,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";

// Strips the "/app" prefix the desktop router always adds so the path
// matches the navigation.path values stored in each module's manifest
// (e.g. "/app/help" -> "/help").
function toApiPath(pathname) {
  return pathname.startsWith("/app") ? pathname.slice(4) || "/" : pathname;
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const { session } = useAuth();
  const token = session?.access_token;
  const location = useLocation();
  const navigate = useNavigate();
  const apiPath = toApiPath(location.pathname);

  const { data, isLoading } = useQuery({
    queryKey: ["help", "resolve", apiPath],
    queryFn: () => runly.help.resolveHelp(apiPath, token).then((r) => r.data),
    enabled: Boolean(token) && open,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ayuda"
        title="Ayuda"
        className="h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
      >
        <CircleHelp size={16} />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ayuda</SheetTitle>
            <SheetDescription>
              {data?.moduleName ? `Ayuda de ${data.moduleName}` : "Ayuda del sistema"}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-6">
            {isLoading && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>
            )}
            {!isLoading && !data?.view && !data?.overview && (
              <EmptyState
                title="Aun no hay ayuda para este modulo"
                description="Estamos escribiendo la documentacion de esta seccion."
              />
            )}
            {data?.view && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.view.title}</h3>
                <MarkdownViewer value={data.view.content} />
              </div>
            )}
            {data?.overview && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.overview.title}</h3>
                <MarkdownViewer value={data.overview.content} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/app/help");
            }}
            className="mt-6 text-xs text-[hsl(var(--primary))] hover:underline"
          >
            Ver toda la documentacion
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 2: Wire it into the Topbar**

In `apps/desktop/src/components/Topbar.jsx`, add the import near the other component imports (after `import { ChatBell } from "./ChatBell";`):

```js
import { HelpButton } from "./HelpButton";
```

Then in the "Right section" `div`, add it right before the `UserMenu` (after the `NotificationBell` block, i.e. right after the closing `)}` that follows the `<NotificationBell ... />` block):

```jsx
{token && <HelpButton />}
```

- [ ] **Step 3: Manual check**

Run: `pnpm dev:frontend`, log in, confirm the help (`?`) icon appears in the topbar next to the other bells, opens a right-side sheet, and shows a loading state then either content or the empty state without throwing.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/HelpButton.jsx apps/desktop/src/components/Topbar.jsx
git commit -m "feat(desktop): add contextual help button + sheet to the topbar"
```

---

### Task 11: Frontend — `/help` browsable + searchable page

**Files:**
- Create: `apps/desktop/src/app/HelpCenterScreen.jsx`
- Modify: `apps/desktop/src/app/AppEntry.jsx`

- [ ] **Step 1: Write the screen**

Create `apps/desktop/src/app/HelpCenterScreen.jsx`:

```jsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PageHeader,
  Input,
  EmptyState,
  ErrorState,
  MarkdownViewer,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";

export function HelpCenterScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [query, setQuery] = useState("");
  const [selectedModuleKey, setSelectedModuleKey] = useState(null);

  const modulesQuery = useQuery({
    queryKey: ["help", "modules"],
    queryFn: () => runly.help.listModules(token).then((r) => r.data),
    enabled: Boolean(token),
  });

  const moduleQuery = useQuery({
    queryKey: ["help", "module", selectedModuleKey],
    queryFn: () => runly.help.getModuleHelp(selectedModuleKey, token).then((r) => r.data),
    enabled: Boolean(token) && Boolean(selectedModuleKey),
  });

  const searchQuery = useQuery({
    queryKey: ["help", "search", query],
    queryFn: () => runly.help.searchHelp(query, token).then((r) => r.data),
    enabled: Boolean(token) && query.trim().length >= 2,
  });

  const isSearching = query.trim().length >= 2;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader title="Ayuda" description="Documentacion de los modulos instalados en esta instancia." />

      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedModuleKey(null);
        }}
        placeholder="Buscar en la ayuda..."
        className="mb-6"
      />

      {isSearching && (
        <div className="space-y-4">
          {searchQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Buscando...</p>}
          {searchQuery.isError && <ErrorState description="No se pudo completar la busqueda." />}
          {searchQuery.data?.length === 0 && (
            <EmptyState title="Sin resultados" description="Prueba con otras palabras." />
          )}
          {searchQuery.data?.map((r) => (
            <button
              key={`${r.moduleKey}-${r.viewKey ?? "overview"}`}
              type="button"
              onClick={() => {
                setSelectedModuleKey(r.moduleKey);
                setQuery("");
              }}
              className="block w-full text-left rounded-lg border border-[hsl(var(--border))] p-3 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{r.moduleName}</p>
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{r.snippet}</p>
            </button>
          ))}
        </div>
      )}

      {!isSearching && !selectedModuleKey && (
        <div className="grid gap-3 sm:grid-cols-2">
          {modulesQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>}
          {modulesQuery.data?.length === 0 && (
            <EmptyState title="Aun no hay ayuda disponible" description="Vuelve mas tarde." />
          )}
          {modulesQuery.data?.map((m) => (
            <button
              key={m.moduleKey}
              type="button"
              onClick={() => setSelectedModuleKey(m.moduleKey)}
              className="text-left rounded-lg border border-[hsl(var(--border))] p-4 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <p className="text-sm font-semibold">{m.name}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{m.summary}</p>
            </button>
          ))}
        </div>
      )}

      {!isSearching && selectedModuleKey && (
        <div>
          <button
            type="button"
            onClick={() => setSelectedModuleKey(null)}
            className="mb-4 text-xs text-[hsl(var(--primary))] hover:underline"
          >
            Volver a modulos
          </button>
          {moduleQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>}
          {moduleQuery.data?.overview && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">{moduleQuery.data.overview.title}</h2>
              <MarkdownViewer value={moduleQuery.data.overview.content} />
            </div>
          )}
          {moduleQuery.data?.views?.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Pestanas documentadas</h3>
              {moduleQuery.data.views.map((v) => (
                <div key={v.viewKey} className="rounded-lg border border-[hsl(var(--border))] p-3">
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{v.summary}</p>
                </div>
              ))}
            </div>
          )}
          {!moduleQuery.isLoading && !moduleQuery.data?.overview && (
            <EmptyState title="Aun no hay ayuda para este modulo" />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `apps/desktop/src/app/AppEntry.jsx`, add the import near `import { HomeScreen } from "./HomeScreen";`:

```js
import { HelpCenterScreen } from "./HelpCenterScreen";
```

Add the route right after `<Route path="profile" element={<ProfileScreen />} />`:

```jsx
<Route path="help" element={<HelpCenterScreen />} />
```

- [ ] **Step 3: Manual check**

Run: `pnpm dev:frontend`, navigate to `/app/help`, confirm the module list renders, clicking `runly.core` shows its overview + the two documented views, and typing 2+ characters in the search box shows results/empty state without errors. Also click "Ver toda la documentacion" from the `HelpButton` sheet (Task 10) and confirm it lands here.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app/HelpCenterScreen.jsx apps/desktop/src/app/AppEntry.jsx
git commit -m "feat(desktop): add /help browsable + searchable help center screen"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `node --test apps/api/src/`
Expected: all green, no regressions anywhere in the API test suite (not just the new files).

- [ ] **Step 2: Full shared-package test suites**

Run: `node --test packages/module-engine/src/__tests__/ packages/validators/src/__tests__/ packages/sdk/src/__tests__/`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors introduced by this feature's files.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: clean build across all packages/apps (`packages/module-engine`, `packages/validators`, `packages/sdk`, `packages/ui`, `apps/api`, `apps/desktop`).

- [ ] **Step 5: Update the acceptance criteria evidence**

Open `docs/superpowers/specs/2026-09-26-module-help-system-design.md`, and under Section 25 ("Acceptance criteria"), append a short "Verified" note for each of the 8 criteria with today's date and which command/manual check confirmed it (per this repo's convention of only marking checklists `[x]` with explicit verification evidence).

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-09-26-module-help-system-design.md
git commit -m "docs: record phase 1 verification evidence for module help system"
```
