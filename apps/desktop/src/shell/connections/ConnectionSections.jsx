import { useQuery } from '@tanstack/react-query'
import { ConnectionSectionsPresentation } from '@runly/ui/integrations'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'
import { useRegisterConnectionSlot } from './recordConnectionTarget.js'

export function ConnectionSections({ targetType, targetId, asSlot = true }) {
  useRegisterConnectionSlot(asSlot)
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const { data: sections = [] } = useQuery({
    queryKey: ['connections', 'records', targetType, targetId, 'detail', activeCompanyId],
    queryFn: async () => (await runly.connections.records(targetType, targetId, 'detail', token))?.data ?? [],
    enabled: Boolean(token && targetType && targetId),
    // Connected data changes from other modules, which cannot invalidate
    // this cache: always refetch when the screen opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  return <ConnectionSectionsPresentation sections={sections} />
}
