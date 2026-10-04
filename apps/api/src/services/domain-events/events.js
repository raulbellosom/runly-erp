// Domain events core modules publish to subscribed modules (spec
// 2026-10-03-rme3-module-platform-v2 §5 goal 10, plan Task 6.2). Written to
// domain_event_outbox right after the change; the worker delivers them to the
// `api/events.js` handlers of modules whose manifest lists them in
// `events.subscribes`. Delivery is at-least-once: handlers must be idempotent.

import { DOMAIN_EVENTS } from '@runly/module-engine/contracts'
export { DOMAIN_EVENTS } from '@runly/module-engine/contracts'

// Best effort for callers outside a transaction: a failed publish is logged and
// never breaks the user's change. `db` may be a Prisma transaction client.
export async function publishDomainEvent(db, { companyId, event, payload }) {
  if (!DOMAIN_EVENTS[event]) throw new Error(`Evento de dominio desconocido: ${event}`)
  if (!companyId || !db?.domainEventOutbox?.create) return null
  try {
    return await db.domainEventOutbox.create({ data: { companyId, event, payload: payload ?? {} } })
  } catch (error) {
    console.error(`[domain-events] no se pudo publicar ${event}:`, error?.message ?? error)
    return null
  }
}
