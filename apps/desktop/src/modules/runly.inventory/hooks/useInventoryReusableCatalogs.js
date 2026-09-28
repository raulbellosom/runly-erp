import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'

// Reusable model/type catalogs (inventory_reusable_catalog). The query keys
// ['inventory', 'models' | 'types', companyId] are shared by the item form,
// the model dialog and the Catalogs screen, so a create in any of them shows
// up everywhere at once.
function useCatalogRequest(kind) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  return {
    companyId: activeCompanyId,
    enabled: Boolean(token && activeCompanyId),
    request: (body) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path: `/inventory/${kind}`, body }),
  }
}

function useReusableCatalog(kind) {
  const { companyId, enabled, request } = useCatalogRequest(kind)
  return useQuery({ queryKey: ['inventory', kind, companyId], queryFn: () => request(), enabled, staleTime: 60 * 1000 })
}

function useCreateReusable(kind) {
  const { request } = useCatalogRequest(kind)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => request(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', kind] }),
  })
}

export const useInventoryTypes = () => useReusableCatalog('types')
export const useInventoryModels = () => useReusableCatalog('models')
export const useCreateInventoryType = () => useCreateReusable('types')
export const useCreateInventoryModel = () => useCreateReusable('models')

// "XPS 15 · Dell · 2023 · Hardware"
export function modelLabel(row) {
  const details = row?.details ?? {}
  return [row?.name, details.brandName, details.year, details.typeLabel ?? details.itemType].filter(Boolean).join(' · ')
}
