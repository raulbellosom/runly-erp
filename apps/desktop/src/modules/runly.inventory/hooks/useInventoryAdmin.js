import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'

function useToken() {
  const { session } = useAuth()
  return session?.access_token
}

export function useInventorySummary() {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => runly.inventory.getSummary(token).then((res) => res?.data ?? res),
    enabled: Boolean(token),
    staleTime: 30 * 1000,
  })
}

export function useInventoryAdminEvents(itemId) {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'items', itemId, 'admin-events'],
    queryFn: () => runly.inventory.listAdminEvents(itemId, token).then((res) => res?.data ?? res ?? []),
    enabled: Boolean(token && itemId),
  })
}

// Single item ({ id, action, ...payload }) or bulk ({ ids, action, ...payload }).
export function useInventoryAdminTransition() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ids, ...body }) => (ids
      ? runly.inventory.bulkAdminTransition({ ids, ...body }, token)
      : runly.inventory.adminTransition(id, body, token)
    ).then((res) => res?.data ?? res),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

export function useInventoryConditions() {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'conditions'],
    queryFn: () => runly.inventory.listConditions(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

export function useSaveInventoryCondition() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => (id ? runly.inventory.updateCondition(id, data, token) : runly.inventory.createCondition(data, token)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'conditions'] }),
  })
}

export function useDeleteInventoryCondition() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.inventory.deleteCondition(id, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'conditions'] }),
  })
}

// (permissionKey) => boolean for the signed-in user; admins can do everything.
export function useInventoryCan() {
  const { userProfile } = useAuth()
  const permissions = userProfile?.permissions ?? []
  return (key) => Boolean(userProfile?.isAdmin || permissions.includes(key))
}

export function useInventoryDashboard(months = 12) {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'dashboard', months],
    queryFn: () => runly.inventory.getDashboard({ months }, token).then((res) => res?.data ?? res),
    enabled: Boolean(token),
    staleTime: 60 * 1000,
  })
}

// Trend buckets for the dashboard timeline; keeps the previous series on
// screen while a new granularity/range loads.
export function useInventoryDashboardTrend(granularity, periods) {
  const token = useToken()
  return useQuery({
    queryKey: ['inventory', 'dashboard', 'trend', granularity, periods],
    queryFn: () => runly.inventory.getDashboardTrend({ granularity, periods }, token).then((res) => res?.data ?? res),
    enabled: Boolean(token),
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  })
}
