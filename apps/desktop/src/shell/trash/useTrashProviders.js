// Desactivados providers of one module for the active company (spec
// 2026-10-03-records-trash-design §10). Shared by the sidebar entry and the
// screen; an empty list hides the entry.
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'

export const TRASH_SUBPATH = '/desactivados'

export function useTrashProviders(moduleKey) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  return useQuery({
    queryKey: ['trash', 'providers', moduleKey, activeCompanyId],
    queryFn: async () => {
      const result = await runly.trash.providers(moduleKey, token)
      return result?.error ? [] : result?.data ?? []
    },
    enabled: Boolean(token && moduleKey),
    staleTime: 60 * 1000,
    retry: false,
  })
}

// Module navigation plus the shell's "Desactivados" entry when it applies.
export function withTrashNavigation(module, providers) {
  if (!module || !providers?.length) return module
  if ((module.navigation ?? []).some((item) => item.path === TRASH_SUBPATH)) return module
  return { ...module, navigation: [...(module.navigation ?? []), { label: 'Desactivados', path: TRASH_SUBPATH, icon: 'Archive' }] }
}
