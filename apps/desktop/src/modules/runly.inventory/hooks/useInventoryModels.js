import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'

// InvModel catalog. Keys live under ['inventory', ...] so a create anywhere
// (item form, model dialog, Catalogs, import) refreshes every screen.
function useInventoryApi() {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  return {
    companyId: activeCompanyId,
    enabled: Boolean(token && activeCompanyId),
    call: (path, { body, method } = {}) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path, body, method }),
  }
}

function useInvalidateCatalogs() {
  const qc = useQueryClient()
  return () => Promise.all(['models', 'categories', 'brands'].map((key) => qc.invalidateQueries({ queryKey: ['inventory', key] })))
}

export function useInventoryModels() {
  const { companyId, enabled, call } = useInventoryApi()
  return useQuery({ queryKey: ['inventory', 'models', companyId], queryFn: () => call('/inventory/models'), enabled, staleTime: 60 * 1000 })
}

export function useSaveInventoryModel() {
  const { call } = useInventoryApi()
  const invalidate = useInvalidateCatalogs()
  return useMutation({
    mutationFn: ({ id, ...data }) => (id ? call(`/inventory/models/${id}`, { body: data, method: 'PUT' }) : call('/inventory/models', { body: data })),
    onSuccess: invalidate,
  })
}

export function useDeleteInventoryModel() {
  const { call } = useInventoryApi()
  const invalidate = useInvalidateCatalogs()
  return useMutation({ mutationFn: (id) => call(`/inventory/models/${id}`, { method: 'DELETE' }), onSuccess: invalidate })
}

// "XPS 15 · Dell · 2023 · Laptop"
export function modelLabel(row) {
  return [row?.name, row?.brandName, row?.year, row?.typeName].filter(Boolean).join(' · ')
}
