import { useLedgerPendingInvitesCount } from '../modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js'

// Returns { [fullNavPath]: count } for ModuleSidebar's nav-item badges.
// Every branch's hook must be called unconditionally (Rules of Hooks) — each
// hook internally gates its own query on `enabled` so only the active
// module's badge query actually fires a network request.
export function useModuleNavBadges(moduleKey) {
  const ledgerPendingCount = useLedgerPendingInvitesCount({ enabled: moduleKey === 'runly.ledger' })

  if (moduleKey === 'runly.ledger' && ledgerPendingCount > 0) {
    return { '/app/m/runly.ledger/memberships': ledgerPendingCount }
  }
  return {}
}
