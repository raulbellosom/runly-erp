import { useCallback, useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'

// Every call goes through runly.purchases.* (packages/sdk). Single-resource
// responses come as { data }; lists keep { data, total, page, pageSize }.
const one = (res) => (res && typeof res === 'object' && 'data' in res && !Array.isArray(res) ? res.data : res)
const errorText = (error, fallback) => error?.details?.error ?? error?.message ?? fallback
// 409 POLICY_BLOCKED carries { reasons: [{ stage, reason }] } in error.details.
const policyReasons = (error) => (error?.details?.code === 'POLICY_BLOCKED' ? error.details.reasons ?? [] : [])

function useToken() {
  return useAuth().session?.access_token
}

// (permissionKey) => boolean for the signed-in user; admins can do everything.
export function usePurchasesCan() {
  const { userProfile } = useAuth()
  const permissions = userProfile?.permissions
  return useCallback(
    (key) => Boolean(userProfile?.isAdmin || (permissions ?? []).includes(key)),
    [userProfile?.isAdmin, permissions],
  )
}

// { capabilities, stages, preset, policies } plus helpers. While loading,
// `has` answers false so nothing capability-gated flashes in.
export function useCapabilities() {
  const token = useToken()
  const query = useQuery({
    queryKey: ['purchases', 'capabilities'],
    queryFn: () => runly.purchases.getCapabilities(token).then(one),
    enabled: Boolean(token),
    staleTime: 60 * 1000,
  })
  const capabilities = query.data?.capabilities ?? {}
  const stages = useMemo(() => (query.data?.stages ?? []).filter((s) => s.mode !== 'DISABLED'), [query.data?.stages])
  const has = useCallback((key) => (key ? Boolean(capabilities[key]) : true), [capabilities])
  return { ...query, capabilities, stages, has }
}

export function usePurchasesDashboard() {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'dashboard'],
    queryFn: () => runly.purchases.dashboard(token).then(one),
    enabled: Boolean(token),
    staleTime: 30 * 1000,
  })
}

export function usePurchasesSettings() {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'settings'],
    queryFn: () => runly.purchases.getSettings(token).then(one),
    enabled: Boolean(token),
  })
}

export function useUpdatePurchasesSettings() {
  const token = useToken()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.purchases.updateSettings(data, token).then(one),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['purchases'] })
      client.invalidateQueries({ queryKey: ['runtime-modules'] })
      toast.success('Configuración guardada')
    },
    onError: (error) => toast.error(errorText(error, 'No se pudo guardar la configuración')),
  })
}

export function useDocumentList(kind, params = {}, { enabled = true } = {}) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', kind, 'list', params],
    queryFn: () => runly.purchases.list(kind, params, token),
    enabled: Boolean(token && kind && enabled),
    placeholderData: keepPreviousData,
  })
}

export function useDocument(kind, id) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', kind, 'detail', id],
    queryFn: () => runly.purchases.get(kind, id, token).then(one),
    enabled: Boolean(token && kind && id),
  })
}

function useInvalidateAll() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['purchases'] })
}

// Create when no id, update otherwise.
export function useSaveDocument(kind) {
  const token = useToken()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, data }) => (id
      ? runly.purchases.update(kind, id, data, token)
      : runly.purchases.create(kind, data, token)).then(one),
    onSuccess: invalidate,
  })
}

export function useTransition(kind, id) {
  const token = useToken()
  const invalidate = useInvalidateAll()
  return useMutation({
    // `targetId` lets a screen transition a document it just created.
    mutationFn: ({ action, targetId, ...payload }) => runly.purchases.transition(kind, targetId ?? id, action, payload, token).then(one),
    onSuccess: invalidate,
  })
}

export function useApprovals(params) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'approvals', params],
    queryFn: () => runly.purchases.listApprovals(params, token),
    enabled: Boolean(token),
  })
}

export function useDecideApproval() {
  const token = useToken()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...data }) => runly.purchases.decideApproval(id, data, token).then(one),
    onSuccess: (_, vars) => {
      invalidate()
      toast.success(vars.decision === 'APPROVED' ? 'Aprobación registrada' : 'Rechazo registrado')
    },
    onError: (error) => toast.error(errorText(error, 'No se pudo registrar la decisión')),
  })
}

export function useRelations(params, { enabled = true } = {}) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'relations', params],
    queryFn: () => runly.purchases.listRelations(params, token).then(one),
    enabled: Boolean(token && params?.entityId && enabled),
  })
}

export function useRelationMutations() {
  const token = useToken()
  const invalidate = useInvalidateAll()
  const onError = (error) => toast.error(errorText(error, 'No se pudo actualizar la relación'))
  const bulk = useMutation({
    mutationFn: (data) => runly.purchases.bulkRelate(data, token).then(one),
    onSuccess: invalidate,
    onError,
  })
  const create = useMutation({
    mutationFn: (data) => runly.purchases.createRelation(data, token).then(one),
    onSuccess: invalidate,
    onError,
  })
  const remove = useMutation({
    mutationFn: (id) => runly.purchases.deleteRelation(id, token),
    onSuccess: () => { invalidate(); toast.success('Relación eliminada') },
    onError,
  })
  return { bulk, create, remove }
}

export function usePropagationPreview(params, enabled) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'propagation', params],
    queryFn: () => runly.purchases.propagationPreview(params, token).then(one),
    enabled: Boolean(token && enabled),
  })
}

export function useInventoryCandidates(params, enabled = true) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'inventory-candidates', params],
    queryFn: () => runly.purchases.inventoryCandidates(params, token),
    enabled: Boolean(token && enabled),
    placeholderData: keepPreviousData,
  })
}

export function useCreateInventoryFromLine() {
  const token = useToken()
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, items }) => runly.purchases.createInventoryFromLine(lineId, { items }, token).then(one),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['purchases'] })
      client.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useSearchDocuments(params, enabled = true) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'documents-search', params],
    queryFn: () => runly.purchases.searchDocuments(params, token),
    enabled: Boolean(token && enabled),
    placeholderData: keepPreviousData,
  })
}

export function useSuppliers(params = {}) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'suppliers', params],
    queryFn: () => runly.purchases.listSuppliers(params, token),
    enabled: Boolean(token),
    placeholderData: keepPreviousData,
  })
}

export function useSupplier(contactId) {
  const token = useToken()
  return useQuery({
    queryKey: ['purchases', 'suppliers', 'detail', contactId],
    queryFn: () => runly.purchases.getSupplier(contactId, token).then(one),
    enabled: Boolean(token && contactId),
  })
}

export function useUpdateSupplierProfile(contactId) {
  const token = useToken()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (data) => runly.purchases.updateSupplierProfile(contactId, data, token).then(one),
    onSuccess: () => { invalidate(); toast.success('Perfil de proveedor guardado') },
    onError: (error) => toast.error(errorText(error, 'No se pudo guardar el perfil')),
  })
}

// Raw search used by SupplierField (Combobox remote search).
export function useSupplierSearch() {
  const token = useToken()
  return useCallback(
    (search) => runly.purchases.listSuppliers({ search, pageSize: 20 }, token).then((res) => res?.data ?? []),
    [token],
  )
}

export { errorText, policyReasons }

