import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'
import { INVENTORY_ITEM_FORM } from '../blueprints/inventory-item-form.blueprint.js'
import { ITEM_TYPES } from '../lib/inventory-constants.js'

export function useInventoryFormBlueprint() {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const { data } = useQuery({ queryKey: ['inventory', 'types', activeCompanyId], enabled: Boolean(session?.access_token && activeCompanyId),
    queryFn: () => intakeRequest({ apiBaseUrl: getApiUrl(), token: session.access_token, companyId: activeCompanyId, path: '/inventory/types' }) })
  return useMemo(() => ({ ...INVENTORY_ITEM_FORM, schema: { ...INVENTORY_ITEM_FORM.schema,
    sections: INVENTORY_ITEM_FORM.schema.sections.map(section => ({ ...section, fields: section.fields?.map(field => field.field === 'itemType' ? { ...field,
      options: [...ITEM_TYPES, ...(data ?? []).filter(row => !ITEM_TYPES.some(type => type.value === row.value)).map(row => ({ value: row.value, label: row.name }))] } : field) })),
  } }), [data])
}
