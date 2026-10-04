// Desactivados registry (spec 2026-10-03-records-trash-design §9): core
// providers plus one generic provider per soft-delete model of every
// installed RME3 module, filtered by the user's permissions and the module
// being installed/enabled for the company.
import { CORE_TRASH_PROVIDERS } from './core-trash-providers.js'
import { createRme3TrashProvider } from './rme3-trash-provider.js'
import { MORE_TRASH_PROVIDERS, createFilesTrashProvider } from './more-trash-providers.js'
import { createCanvasTrashProvider } from './canvas-trash-provider.js'
import { TrashError } from './trash-errors.js'

export const PURGE_PERMISSION = 'core.records.purge'

export function can(user, permission) {
  return Boolean(user?.isAdmin || user?.permissionSet?.has?.(permission))
}

export function createTrashRegistry({ prisma, filesService = null, supabaseAdmin = null }) {
  const builtIn = [...CORE_TRASH_PROVIDERS, ...MORE_TRASH_PROVIDERS, createFilesTrashProvider({ filesService }), createCanvasTrashProvider({ prisma, supabaseAdmin })].filter(Boolean)
  async function allProviders(companyId) {
    const modules = await prisma.runlyModule.findMany({
      where: { status: 'INSTALLED', enabled: true },
      select: { id: true, key: true, name: true, manifest: true },
    })
    const disabled = new Set((await prisma.companyModule.findMany({ where: { companyId, enabled: false }, select: { moduleId: true } })).map((row) => row.moduleId))
    const active = modules.filter((mod) => !disabled.has(mod.id))
    const activeKeys = new Set(active.map((mod) => mod.key))
    const providers = builtIn.filter((provider) => activeKeys.has(provider.moduleKey))
    const custom = active.filter((mod) => /^(custom|community)\./.test(mod.key))
    if (custom.length) {
      const models = await prisma.runlyModel.findMany({ where: { moduleKey: { in: custom.map((mod) => mod.key) } }, select: { moduleKey: true, schema: true, label: true, pluralLabel: true } })
      for (const row of models) {
        const mod = custom.find((item) => item.key === row.moduleKey)
        const provider = createRme3TrashProvider({ moduleKey: mod.key, moduleName: mod.name, manifest: mod.manifest, model: { ...(row.schema ?? {}), label: row.label ?? row.schema?.label, pluralLabel: row.pluralLabel ?? row.schema?.pluralLabel } })
        if (provider) providers.push(provider)
      }
    }
    return providers
  }

  // Providers this user can open (restore permission), optionally for one module.
  async function providersFor({ companyId, user, moduleKey = null }) {
    return (await allProviders(companyId)).filter((provider) => (!moduleKey || provider.moduleKey === moduleKey) && can(user, provider.permissions.restore))
  }

  async function providerFor({ companyId, user, providerId }) {
    const provider = (await providersFor({ companyId, user })).find((item) => item.id === providerId)
    if (!provider) throw new TrashError('No tienes acceso a estos registros.', 403)
    return provider
  }

  return { providersFor, providerFor, allProviders }
}
