import { companyFetch } from '../../../lib/companyFetch.js'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

// Shares the same queryKey as MembershipsScreen.jsx's own `GET /ledger/memberships`
// query, so the two dedupe/cache together instead of firing two separate requests.
export function useLedgerPendingInvitesCount({ enabled = true } = {}) {
  const { session } = useAuth()
  const token = session?.access_token ?? null

  const { data } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/memberships`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudieron cargar las membresias.')
      return res.json()
    },
    enabled: enabled && !!token,
    staleTime: 30 * 1000,
  })

  const groups   = data?.data?.groups   ?? []
  const accounts = data?.data?.accounts ?? []
  return groups.filter((g) => g.status === 'pending').length
    + accounts.filter((a) => a.status === 'pending').length
}
