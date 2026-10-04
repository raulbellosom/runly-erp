// Permanent deletion of a deactivated record with its dependents resolved
// (spec 2026-10-04-trash-retention-conflicts §4.2): blocking references stop
// it, unlinkable ones are cleared only when the caller allows it (`unlink`),
// in the same transaction as the delete when the provider supports it.
import { TrashError } from './trash-errors.js'
import { describeBlocking, findDependents, unlinkDependents } from './trash-dependents.js'

const describe = (items) => items.map((dep) => `${dep.count} en ${dep.label}`).join(', ')

export async function purgeWithDependents(ctx, provider, id, { unlink = false } = {}) {
  const dependents = provider.table ? await findDependents(ctx.prisma, { table: provider.table, id }) : { cascade: [], setNull: [], unlinkable: [], blocking: [] }
  if (dependents.blocking.length) {
    throw new TrashError(`No se puede eliminar definitivamente: lo usan ${describeBlocking(dependents)}.`, 409, 'in_use', { dependents })
  }
  if (dependents.unlinkable.length && !unlink) {
    throw new TrashError(`Lo usan ${describe(dependents.unlinkable)}. Puedes desvincularlos (quedan sin ese dato) y eliminarlo.`, 409, 'needs_unlink', { dependents })
  }
  if (provider.transactional) {
    const record = await ctx.prisma.$transaction(async (tx) => {
      const unlinked = await unlinkDependents(tx, { dependents, id })
      const purged = await provider.purge({ ...ctx, prisma: tx }, id)
      return { ...purged, unlinked }
    }, { maxWait: 10_000, timeout: 60_000 })
    return { record, dependents }
  }
  const unlinked = unlink ? await unlinkDependents(ctx.prisma, { dependents, id }) : 0
  const record = await provider.purge(ctx, id)
  return { record: { ...record, unlinked }, dependents }
}
