import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { createModuleBuilderService, ModuleBuilderError } from '../module-builder-service.js'
import { normalizeModuleDefinition } from '@runly/module-compiler'

// In-memory fake covering exactly the Prisma calls module-builder-service.js
// makes (moduleBuilderProject/Revision CRUD + a runlyModule existence check),
// following the mocked-prisma pattern already used by
// module-package-service.test.js — no real database needed for these
// business-rule tests (tenant isolation, publish blocking, ...).
function fakePrisma({ existingRunlyModuleKeys = [] } = {}) {
  const projects = new Map()
  const revisions = []
  return {
    moduleBuilderProject: {
      create: async ({ data }) => {
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), publishedAt: null, publishedDefinition: null, publishedPackageHash: null, publishedVersion: null, detachedAt: null, schemaVersion: 1, ...data }
        projects.set(row.id, row)
        return row
      },
      findUnique: async ({ where }) => {
        if (where.id) return projects.get(where.id) ?? null
        if (where.moduleKey) return [...projects.values()].find((p) => p.moduleKey === where.moduleKey) ?? null
        return null
      },
      findMany: async ({ where }) => [...projects.values()].filter((p) => p.companyId === where.companyId),
      update: async ({ where, data }) => {
        const row = projects.get(where.id)
        const next = { ...row, ...data, updatedAt: new Date() }
        projects.set(where.id, next)
        return next
      },
      delete: async ({ where }) => {
        const row = projects.get(where.id)
        projects.delete(where.id)
        return row
      },
    },
    moduleBuilderRevision: {
      create: async ({ data }) => {
        const row = { id: randomUUID(), createdAt: new Date(), ...data }
        revisions.push(row)
        return row
      },
      findFirst: async ({ where }) => revisions.filter((r) => r.projectId === where.projectId).sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null,
      findMany: async ({ where }) => revisions.filter((r) => r.projectId === where.projectId).sort((a, b) => b.revisionNumber - a.revisionNumber),
    },
    runlyModule: {
      findUnique: async ({ where }) => existingRunlyModuleKeys.includes(where.key) ? { key: where.key, status: 'INSTALLED', version: '1.0.0', manifest: { key: where.key } } : null,
    },
    _projects: projects,
  }
}

test('createProject: blank template needs no entities and suggests a module key from the name', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'Control de Vehículos', template: 'blank' })
  assert.equal(project.moduleKey, 'custom.controldevehiculos')
  assert.equal(project.status, 'DRAFT')
  assert.deepEqual(project.definition.entities, [])
})

test('createProject: inventory-lite template ships entities, a Kanban and a dashboard', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'Inventario', moduleKey: 'custom.inventoryfleet', template: 'inventory-lite' })
  assert.equal(project.definition.entities.length, 1)
  const kinds = project.definition.views.map((v) => v.kind)
  assert.ok(kinds.includes('KANBAN'))
  assert.ok(kinds.includes('DASHBOARD'))
})

test('createProject: rejects a module key outside the custom. namespace', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  await assert.rejects(
    () => svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'runly.forbidden' }),
    (error) => error instanceof ModuleBuilderError && error.code === 'INVALID_BUILDER_MODULE_KEY',
  )
})

// Regression: the Builder's own key format check must never be stricter
// than @runly/module-compiler's MODULE_KEY pattern (definition.js), which
// allows underscores in the slug — found during golden-path QA using the
// exact `custom.vehicle_control` key from the spec's worked example.
test('createProject: accepts an underscored slug, matching the compiler MODULE_KEY pattern', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'Control de Vehículos', moduleKey: 'custom.vehicle_control', template: 'blank' })
  assert.equal(project.moduleKey, 'custom.vehicle_control')
})

test('createProject: rejects a module key already installed as a RunlyModule', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma({ existingRunlyModuleKeys: ['custom.taken'] }) })
  await assert.rejects(
    () => svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.taken' }),
    (error) => error instanceof ModuleBuilderError && error.code === 'MODULE_KEY_ALREADY_INSTALLED',
  )
})

// Regression: a malformed :id (not a UUID) used to reach Prisma's
// findUnique and surface as a raw 500 instead of the same 404 a
// well-formed-but-nonexistent id gets. Found during error-state QA.
test('getProject: a malformed (non-UUID) id is a clean 404, not a raw 500', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  await assert.rejects(
    () => svc.getProject({ companyId: 'company-1', projectId: 'not-a-uuid' }),
    (error) => error instanceof ModuleBuilderError && error.code === 'BUILDER_PROJECT_NOT_FOUND' && error.statusCode === 404,
  )
})

test('getProject: a project from another company is not found (no cross-tenant leak)', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo' })
  await assert.rejects(
    () => svc.getProject({ companyId: 'company-2', projectId: project.id }),
    (error) => error instanceof ModuleBuilderError && error.code === 'BUILDER_PROJECT_NOT_FOUND',
  )
})

test('updateDefinition: saving a draft always re-pins the immutable moduleKey and resets status to DRAFT', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  await svc.validateProject({ companyId: 'company-1', projectId: project.id })
  const tampered = { ...project.definition, key: 'custom.someone-elses-key' }
  const updated = await svc.updateDefinition({ companyId: 'company-1', actorId: 'user-1', projectId: project.id, definition: tampered })
  assert.equal(updated.definition.key, 'custom.xfoo')
  assert.equal(updated.status, 'DRAFT')
})

test('validateProject: reports diagnostics for duplicate select option values and flips status back to DRAFT', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  const badDefinition = {
    ...project.definition,
    entities: [{
      key: 'item', label: 'Elemento', pluralLabel: 'Elementos',
      fields: [{ key: 'status', label: 'Estado', type: 'select', options: [{ value: 'ACTIVE', label: 'Activo' }, { value: 'ACTIVE', label: 'Duplicado' }] }],
    }],
  }
  await svc.updateDefinition({ companyId: 'company-1', actorId: 'user-1', projectId: project.id, definition: badDefinition })
  const result = await svc.validateProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(result.valid, false)
  const after = await svc.getProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(after.status, 'DRAFT')
})

test('compileProject: counts entities, fields, views and permissions from the compiled definition', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'inventory-lite' })
  const compiled = await svc.compileProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(compiled.entityCount, 1)
  assert.equal(compiled.fieldCount, 6)
  assert.equal(compiled.permissionCount, 4)
  assert.ok(compiled.files.length > 5)
})

test('compileProject: an invalid draft raises a 422 ModuleBuilderError carrying compiler diagnostics', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'blank' })
  await assert.rejects(
    () => svc.compileProject({ companyId: 'company-1', projectId: project.id }),
    (error) => error instanceof ModuleBuilderError && error.code === 'INVALID_MODULE_DEFINITION' && error.statusCode === 422 && error.details.errors.length > 0,
  )
})

test('previewProject: generates sample rows matching each field type, including a valid select option', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'inventory-lite' })
  const preview = await svc.previewProject({ companyId: 'company-1', projectId: project.id, viewKey: null })
  assert.equal(preview.entity.key, 'item')
  assert.equal(preview.rows.length, 5)
  const optionValues = new Set(['GENERAL', 'ELECTRONICS', 'SUPPLIES'])
  for (const row of preview.rows) assert.ok(optionValues.has(row.category))
})

test('exportPackage: produces a ZIP whose module.manifest.js matches the compiled package', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  const { buffer, filename, packageHash } = await svc.exportPackage({ companyId: 'company-1', projectId: project.id })
  assert.ok(filename.startsWith('custom.xfoo-'))
  const zip = await JSZip.loadAsync(buffer)
  assert.ok(zip.file('module.manifest.js'))
  const compiled = await svc.compileProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(packageHash, compiled.packageHash)
})

test('publishProject: refuses to publish once a project has been detached to Advanced mode', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  prisma._projects.set(project.id, { ...prisma._projects.get(project.id), status: 'PUBLISHED', detachedAt: new Date() })
  await assert.rejects(
    () => svc.publishProject({ companyId: 'company-1', actorId: 'user-1', projectId: project.id }),
    (error) => error instanceof ModuleBuilderError && error.code === 'BUILDER_PROJECT_DETACHED',
  )
})

test('publishProject: fails loudly when no package publish backend is wired (never silently no-ops)', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma(), bundlerSvc: null })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  await assert.rejects(
    () => svc.publishProject({ companyId: 'company-1', actorId: 'user-1', projectId: project.id }),
    (error) => error instanceof ModuleBuilderError && error.code === 'MODULE_PACKAGE_PUBLISH_UNAVAILABLE',
  )
})

test('deleteDraft: blocks deleting a published project, but allows deleting a plain draft', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'blank' })
  // Published and then edited: every save sets status DRAFT, the module is still installed.
  prisma._projects.set(project.id, { ...prisma._projects.get(project.id), status: 'DRAFT', publishedAt: new Date() })
  await assert.rejects(
    () => svc.deleteDraft({ companyId: 'company-1', projectId: project.id }),
    (error) => error instanceof ModuleBuilderError && error.code === 'BUILDER_PROJECT_PUBLISHED',
  )
  prisma._projects.set(project.id, { ...prisma._projects.get(project.id), status: 'DRAFT', publishedAt: null })
  const result = await svc.deleteDraft({ companyId: 'company-1', projectId: project.id })
  assert.equal(result.deleted, true)
})

test('detachProject: any project can switch to developer mode, and doing it twice is harmless', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xdetach', template: 'blank' })
  const detached = await svc.detachProject({ companyId: 'company-1', actorId: 'user-1', projectId: project.id })
  assert.ok(detached.detachedAt)
  const again = await svc.detachProject({ companyId: 'company-1', actorId: 'user-1', projectId: project.id })
  assert.equal(String(again.detachedAt), String(detached.detachedAt))
})

// Regression: right after a real publish, publishedDefinition is
// compileModule()'s fully-normalized snapshot while the draft column stays
// whatever raw shape was last saved — comparing them as-is made
// hasUnpublishedChanges report true immediately after every publish, with
// zero real edits, since normalization alone adds entity ids/permissions/
// generated views. Found during golden-path QA against the live API.
test('hasUnpublishedChanges: false right after publish (comparing normalized shapes), true again after a real edit', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'simple-crud' })
  // Simulate what publishProject() stores, without needing full package-service wiring.
  prisma._projects.set(project.id, {
    ...prisma._projects.get(project.id),
    status: 'PUBLISHED',
    publishedDefinition: normalizeModuleDefinition(project.definition),
  })
  const justPublished = await svc.getProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(justPublished.hasUnpublishedChanges, false)

  await svc.updateDefinition({
    companyId: 'company-1', actorId: 'user-1', projectId: project.id,
    definition: { ...justPublished.definition, entities: [{ ...justPublished.definition.entities[0], label: 'Elemento renombrado' }] },
  })
  const afterEdit = await svc.getProject({ companyId: 'company-1', projectId: project.id })
  assert.equal(afterEdit.hasUnpublishedChanges, true)
})

test('getPublishImpact: a never-installed project reports a PUBLISH action with real compiled counts', async () => {
  const svc = createModuleBuilderService({ prisma: fakePrisma() })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xfoo', template: 'inventory-lite' })
  const impact = await svc.getPublishImpact({ companyId: 'company-1', projectId: project.id })
  assert.equal(impact.action, 'PUBLISH')
  assert.equal(impact.installed, false)
  assert.equal(impact.entityCount, 1)
  assert.equal(impact.nextVersion, '0.1.0')
})

test('updateDefinition keeps captured React screens when an autosave omits them', async () => {
  const prisma = fakePrisma()
  const svc = createModuleBuilderService({ prisma })
  const project = await svc.createProject({ companyId: 'company-1', actorId: 'user-1', name: 'X', moduleKey: 'custom.xext', template: 'blank' })
  const extensions = { files: [{ path: 'components/index.js', content: 'x' }], views: [], navigation: [] }
  prisma._projects.set(project.id, { ...prisma._projects.get(project.id), definition: { ...project.definition, extensions } })
  const stale = await svc.updateDefinition({ companyId: 'company-1', actorId: 'user-1', projectId: project.id, definition: { ...project.definition, name: 'Nuevo' } })
  assert.deepEqual(stale.definition.extensions, extensions)
  const cleared = await svc.updateDefinition({ companyId: 'company-1', actorId: 'user-1', projectId: project.id, definition: { ...project.definition, extensions: { files: [], views: [], navigation: [] } } })
  assert.deepEqual(cleared.definition.extensions.files, [])
})
