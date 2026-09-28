// Module Builder backend service (No-Code Module Builder MVP). This is the
// single domain layer behind builder-routes.js: it owns ModuleBuilderProject
// persistence and is the only place that calls @runly/module-compiler and
// the ModulePackageService wiring for Builder-managed modules. A project's
// `definition` column is the draft ModuleDefinition JSON; it is never
// itself installed. Publishing compiles it, archives the exact same package
// format the CLI/ZIP-upload path produces, and installs it through the
// existing RME3 lifecycle — no parallel compiler, packaging or install
// pipeline. See
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md §21.
import { createHash, randomUUID } from 'node:crypto'
import {
  compileModule,
  archiveModule,
  normalizeModuleDefinition,
  validateModuleDefinition,
} from '@runly/module-compiler'
import { validateManifest, RESERVED_NAMESPACES } from '@runly/module-engine'
import { resolveModulesDir } from './module-upload-service.js'
import { createModulePackageWiring } from './module-package-wiring-service.js'
import { invalidateModuleCaches } from './module-cache-service.js'
import { buildDefinitionFromTemplate, BUILDER_TEMPLATE_KEYS } from './module-builder-templates.js'
import { buildPreview } from './module-builder-preview-service.js'

export class ModuleBuilderError extends Error {
  constructor(message, { code, statusCode = 400, details = null } = {}) {
    super(message)
    this.name = 'ModuleBuilderError'
    this.code = code ?? 'MODULE_BUILDER_ERROR'
    this.statusCode = statusCode
    this.details = details
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Builder-managed modules are always under the `custom.` namespace, but the
// slug itself must accept exactly what @runly/module-compiler's own
// MODULE_KEY pattern accepts (packages/module-compiler/src/definition.js) —
// including underscores (e.g. `custom.vehicle_control`). A stricter regex
// here would let the Builder reject a key the compiler would happily
// accept, which is the "Builder says invalid, compiler would say fine"
// inconsistency this project explicitly guards against.
const MODULE_KEY_RE = /^custom\.[a-z][a-z0-9_]*$/

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function definitionHash(definition) {
  return createHash('sha256').update(canonicalJson(definition)).digest('hex')
}

function assertModuleKey(moduleKey) {
  if (!MODULE_KEY_RE.test(moduleKey ?? '')) {
    throw new ModuleBuilderError('El module key debe usar el formato custom.<slug>.', { code: 'INVALID_BUILDER_MODULE_KEY', statusCode: 422 })
  }
  if (RESERVED_NAMESPACES.some((prefix) => moduleKey.startsWith(prefix))) {
    throw new ModuleBuilderError('El namespace del módulo está reservado.', { code: 'RESERVED_MODULE_NAMESPACE', statusCode: 422 })
  }
}

function suggestModuleKey(name) {
  const slug = (name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'modulo'
  return `custom.${/^[a-z]/.test(slug) ? slug : `m${slug}`}`
}

// publishedDefinition is always a fully compiled/normalized snapshot (it's
// literally compileModule()'s `.definition`), but the draft column is
// whatever raw shape the client last PATCHed — missing entity ids, missing
// generated permissions/views/navigation, etc. Hashing them as-is made
// hasUnpublishedChanges report `true` right after every successful publish,
// even with zero real edits, since normalization alone changes the byte
// shape. Normalizing the draft first (the spec's own "comparar por
// definición/hash normalizado") fixes that; normalizeModuleDefinition()
// doesn't validate, so a draft that's incomplete enough to throw (e.g. an
// entity added but not yet labeled) falls back to the safe answer: assume
// unpublished changes, since an invalid draft can't be meaningfully diffed
// against the last published one anyway.
function hasUnpublishedChanges(project) {
  if (!project.publishedDefinition) return true
  try {
    return definitionHash(normalizeModuleDefinition(project.definition)) !== definitionHash(project.publishedDefinition)
  } catch {
    return true
  }
}

function serializeProject(project) {
  return {
    id: project.id,
    companyId: project.companyId,
    moduleKey: project.moduleKey,
    name: project.name,
    description: project.description,
    status: project.status,
    schemaVersion: project.schemaVersion,
    definition: project.definition,
    publishedDefinition: project.publishedDefinition,
    publishedPackageHash: project.publishedPackageHash,
    publishedVersion: project.publishedVersion,
    detachedAt: project.detachedAt,
    hasUnpublishedChanges: hasUnpublishedChanges(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    publishedAt: project.publishedAt,
  }
}

export function createModuleBuilderService({ prisma, bundlerSvc = null, routeLoader = null, cacheDel = () => {} }) {
  const wiring = createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel })

  async function requireProject({ companyId, projectId }) {
    // A malformed :id path param (not a UUID) used to reach Prisma's
    // findUnique and throw a raw validation error, surfacing as a bare 500
    // instead of the same 404 a well-formed-but-nonexistent id gets. Found
    // during golden-path QA error-state testing.
    if (!UUID_RE.test(projectId ?? '')) {
      throw new ModuleBuilderError('Proyecto de Builder no encontrado.', { code: 'BUILDER_PROJECT_NOT_FOUND', statusCode: 404 })
    }
    const project = await prisma.moduleBuilderProject.findUnique({ where: { id: projectId } })
    if (!project || project.companyId !== companyId) {
      throw new ModuleBuilderError('Proyecto de Builder no encontrado.', { code: 'BUILDER_PROJECT_NOT_FOUND', statusCode: 404 })
    }
    return project
  }

  async function listProjects({ companyId }) {
    const projects = await prisma.moduleBuilderProject.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
    })
    return projects.map(serializeProject)
  }

  async function getProject({ companyId, projectId }) {
    return serializeProject(await requireProject({ companyId, projectId }))
  }

  async function createProject({ companyId, actorId, name, moduleKey, description, icon, color, template = 'blank', definition }) {
    const trimmedName = (name ?? '').trim()
    if (!trimmedName) throw new ModuleBuilderError('El nombre del módulo es obligatorio.', { code: 'REQUIRED', statusCode: 422 })
    const resolvedKey = (moduleKey ?? '').trim() || suggestModuleKey(trimmedName)
    assertModuleKey(resolvedKey)

    const existingByKey = await prisma.moduleBuilderProject.findUnique({ where: { moduleKey: resolvedKey } })
    if (existingByKey) throw new ModuleBuilderError('Ya existe un proyecto con ese module key.', { code: 'BUILDER_MODULE_KEY_TAKEN', statusCode: 409 })
    const existingModule = await prisma.runlyModule.findUnique({ where: { key: resolvedKey } })
    if (existingModule) throw new ModuleBuilderError('Ya existe un módulo instalado con ese key.', { code: 'MODULE_KEY_ALREADY_INSTALLED', statusCode: 409 })

    if (!BUILDER_TEMPLATE_KEYS.includes(template) && !definition) {
      throw new ModuleBuilderError('Plantilla desconocida.', { code: 'UNKNOWN_BUILDER_TEMPLATE', statusCode: 422 })
    }
    const draft = definition ?? buildDefinitionFromTemplate(template, { moduleKey: resolvedKey, name: trimmedName, description, icon, color })
    draft.key = resolvedKey

    const project = await prisma.moduleBuilderProject.create({
      data: {
        companyId,
        moduleKey: resolvedKey,
        name: trimmedName,
        description: description ?? null,
        status: 'DRAFT',
        definition: draft,
        createdById: actorId,
        updatedById: actorId,
      },
    })
    return serializeProject(project)
  }

  async function updateDefinition({ companyId, actorId, projectId, definition, name, description }) {
    const project = await requireProject({ companyId, projectId })
    if (project.status === 'PUBLISHED' && project.detachedAt) {
      throw new ModuleBuilderError('Este proyecto fue desconectado del Builder (modo avanzado) y ya no admite edición visual.', { code: 'BUILDER_PROJECT_DETACHED', statusCode: 409 })
    }
    const nextDefinition = { ...(definition ?? project.definition), key: project.moduleKey }
    const updated = await prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: {
        definition: nextDefinition,
        name: name ?? project.name,
        description: description !== undefined ? description : project.description,
        status: 'DRAFT',
        updatedById: actorId,
      },
    })
    return serializeProject(updated)
  }

  function normalizeAndValidate(rawDefinition) {
    const normalized = normalizeModuleDefinition(rawDefinition)
    const result = validateModuleDefinition(normalized)
    return { normalized, ...result }
  }

  async function validateProject({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    const { normalized, valid, errors, warnings } = normalizeAndValidate(project.definition)
    await prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: { status: valid ? 'VALIDATED' : 'DRAFT' },
    })
    return { valid, errors, warnings, definition: normalized }
  }

  function compileDefinition(rawDefinition) {
    const { normalized, valid, errors, warnings } = normalizeAndValidate(rawDefinition)
    if (!valid) throw new ModuleBuilderError('ModuleDefinition inválida.', { code: 'INVALID_MODULE_DEFINITION', statusCode: 422, details: { errors, warnings } })
    return compileModule(normalized)
  }

  async function compileProject({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    const compiled = compileDefinition(project.definition)
    return {
      moduleKey: compiled.moduleKey,
      packageHash: compiled.packageHash,
      files: compiled.files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })),
      entityCount: compiled.definition.entities.length,
      fieldCount: compiled.definition.entities.reduce((sum, entity) => sum + entity.fields.length, 0),
      viewCount: compiled.definition.views.length,
      permissionCount: compiled.definition.permissions.length,
      diagnostics: compiled.diagnostics,
    }
  }

  async function previewProject({ companyId, projectId, viewKey }) {
    const project = await requireProject({ companyId, projectId })
    const normalized = normalizeModuleDefinition(project.definition)
    return buildPreview(normalized, viewKey)
  }

  async function exportPackage({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    const compiled = compileDefinition(project.definition)
    const buffer = await archiveModule(compiled)
    return { buffer, filename: `${project.moduleKey}-${compiled.definition.version}.zip`, packageHash: compiled.packageHash }
  }

  async function getPublishImpact({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    const compiled = compileDefinition(project.definition)
    const existingModule = await prisma.runlyModule.findUnique({ where: { key: project.moduleKey } })
    return {
      moduleKey: project.moduleKey,
      action: existingModule ? 'UPDATE' : 'PUBLISH',
      currentVersion: existingModule?.version ?? null,
      nextVersion: compiled.definition.version,
      entityCount: compiled.definition.entities.length,
      fieldCount: compiled.definition.entities.reduce((sum, entity) => sum + entity.fields.length, 0),
      viewCount: compiled.definition.views.length,
      permissionCount: compiled.definition.permissions.length,
      packageHash: compiled.packageHash,
      installed: existingModule?.status === 'INSTALLED',
      schemaNote: existingModule
        ? 'El análisis definitivo de esquema (aditivo vs. destructivo) se confirma al publicar; los cambios destructivos bloquean la publicación.'
        : 'Se creará un módulo nuevo; no hay esquema previo que comparar.',
    }
  }

  async function publishProject({ companyId, actorId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    if (project.detachedAt) {
      throw new ModuleBuilderError('Este proyecto fue desconectado del Builder y ya no puede publicarse desde aquí.', { code: 'BUILDER_PROJECT_DETACHED', statusCode: 409 })
    }
    const compiled = compileDefinition(project.definition)
    const modulesDir = await resolveModulesDir()
    if (!modulesDir) throw new ModuleBuilderError('No hay un directorio de módulos configurado en esta instancia.', { code: 'MODULES_DIR_NOT_CONFIGURED', statusCode: 503 })
    if (!wiring.packageSvc) throw new ModuleBuilderError('El servicio de paquetes de módulos no está disponible.', { code: 'MODULE_PACKAGE_PUBLISH_UNAVAILABLE', statusCode: 503 })

    const buffer = await archiveModule(compiled)
    let publishResult
    try {
      publishResult = await wiring.packageSvc.publishZip({ key: project.moduleKey, fileBuffer: buffer, modulesDir, actorId })
    } catch (error) {
      throw new ModuleBuilderError(error.message ?? 'No se pudo publicar el módulo.', {
        code: error.code ?? 'MODULE_PACKAGE_PUBLISH_FAILED',
        statusCode: error.statusCode ?? 500,
        details: error.details ?? null,
      })
    }

    let installResult = null
    if (publishResult.outcome !== 'NO_CHANGES') {
      const moduleRow = await prisma.runlyModule.findUnique({ where: { key: project.moduleKey } })
      if (moduleRow && moduleRow.status !== 'INSTALLED') {
        const manifestValidation = validateManifest(moduleRow.manifest)
        if (!manifestValidation.valid) {
          throw new ModuleBuilderError('El manifiesto generado no es instalable.', { code: 'INVALID_GENERATED_MANIFEST', statusCode: 500, details: manifestValidation.errors })
        }
        installResult = await wiring.lifecycleSvc.installModule({ manifest: moduleRow.manifest, actorId, requestId: randomUUID() })
        if (routeLoader) await routeLoader.reloadModule(project.moduleKey).catch(() => null)
        if (bundlerSvc) await bundlerSvc.buildModuleBundle(project.moduleKey).catch(() => null)
        // publishZip() already busted the module caches, but BEFORE this
        // install flipped the module to INSTALLED — any /blueprints or
        // /runtime/modules request in between re-cached the pre-install
        // state for the cache TTL, so the new module/menu stayed hidden
        // until a later reload. Bust again now that install is done.
        await invalidateModuleCaches(cacheDel).catch(() => null)
      }
    }

    const previousRevision = await prisma.moduleBuilderRevision.findFirst({
      where: { projectId: project.id },
      orderBy: { revisionNumber: 'desc' },
      select: { revisionNumber: true },
    })
    await prisma.moduleBuilderRevision.create({
      data: {
        projectId: project.id,
        revisionNumber: (previousRevision?.revisionNumber ?? 0) + 1,
        definition: compiled.definition,
        definitionHash: definitionHash(compiled.definition),
        published: true,
        packageHash: compiled.packageHash,
        createdById: actorId,
      },
    })
    const updated = await prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: {
        status: 'PUBLISHED',
        publishedDefinition: compiled.definition,
        publishedPackageHash: compiled.packageHash,
        publishedVersion: compiled.definition.version,
        publishedAt: new Date(),
        updatedById: actorId,
      },
    })
    return {
      project: serializeProject(updated),
      outcome: publishResult.outcome,
      publicationPlan: publishResult.publicationPlan,
      schemaMigration: publishResult.schemaMigration,
      installed: Boolean(installResult),
    }
  }

  async function listRevisions({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    return prisma.moduleBuilderRevision.findMany({
      where: { projectId: project.id },
      orderBy: { revisionNumber: 'desc' },
      select: { id: true, revisionNumber: true, definitionHash: true, published: true, packageHash: true, createdAt: true, createdById: true },
    })
  }

  async function detachProject({ companyId, actorId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    if (project.status !== 'PUBLISHED') {
      throw new ModuleBuilderError('Solo un proyecto publicado puede convertirse a modo avanzado.', { code: 'BUILDER_PROJECT_NOT_PUBLISHED', statusCode: 409 })
    }
    const updated = await prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: { detachedAt: new Date(), updatedById: actorId },
    })
    return serializeProject(updated)
  }

  async function deleteDraft({ companyId, projectId }) {
    const project = await requireProject({ companyId, projectId })
    if (project.status === 'PUBLISHED') {
      throw new ModuleBuilderError('Un proyecto publicado no puede eliminarse; desinstala el módulo primero desde el catálogo.', { code: 'BUILDER_PROJECT_PUBLISHED', statusCode: 409 })
    }
    await prisma.moduleBuilderProject.delete({ where: { id: project.id } })
    return { deleted: true }
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateDefinition,
    validateProject,
    compileProject,
    previewProject,
    exportPackage,
    getPublishImpact,
    publishProject,
    listRevisions,
    detachProject,
    deleteDraft,
    templates: BUILDER_TEMPLATE_KEYS,
  }
}
