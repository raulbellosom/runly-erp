// Shared plumbing for the runly.purchases routers: actor ids, permission
// checks inside handlers, JSON parsing and the error envelope { error, code }.
import { PurchasesServiceError } from '../../services/purchases-shared.js'
import { readCheckerFor } from '../../services/purchase-relation-hydration.js'

// Internal profile id — never the Supabase auth uuid (audit actor rule).
export const actorId = c => c.get('userContext')?.profile?.id ?? c.get('userId') ?? null
export const authUserId = c => c.get('authUserId') ?? c.get('userContext')?.profile?.authUserId ?? null
export const companyOf = c => c.get('companyId')
export const canReadOf = c => readCheckerFor(c.get('userContext'))

export function hasPermission(c, key) {
  const context = c.get('userContext')
  if (!context) return false
  return Boolean(context.isAdmin || context.permissionSet?.has?.(key))
}

export function assertPermission(c, key) {
  if (!hasPermission(c, key)) throw new PurchasesServiceError('No tienes permiso para realizar esta acción.', 403, 'FORBIDDEN')
}

export async function body(c) {
  try {
    const value = await c.req.json()
    return value && typeof value === 'object' ? value : {}
  } catch {
    throw new PurchasesServiceError('El cuerpo de la solicitud no es JSON válido.', 400, 'VALIDATION')
  }
}

export function createHandler(tag = '[purchases]') {
  return async function handle(c, callback, successStatus = 200) {
    try {
      return c.json(await callback(), successStatus)
    } catch (error) {
      if (error instanceof PurchasesServiceError) {
        const payload = { error: error.message, code: error.code }
        if (error.reasons) payload.reasons = error.reasons
        return c.json(payload, error.status)
      }
      if (error?.name === 'InventoryServiceError' && error.status) {
        return c.json({ error: error.message, code: error.status === 404 ? 'NOT_FOUND' : 'VALIDATION' }, error.status)
      }
      if (error?.code === 'P2002') {
        return c.json({ error: 'Ya existe un documento con ese número.', code: 'VALIDATION' }, 400)
      }
      console.error(tag, error)
      return c.json({ error: 'No se pudo completar la operación de compras.', code: 'INTERNAL' }, 500)
    }
  }
}
