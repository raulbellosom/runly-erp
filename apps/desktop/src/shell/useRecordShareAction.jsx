import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, PublicLinksPanel, buildApiHeaders } from '@runly/ui'

// "Compartir" action for generated record details: lists the module's public
// resources for this entity that the user can manage (GET
// /modules/:key/public-resources) and opens PublicLinksPanel for the record.
export function useRecordShareAction({ moduleKey, entity, token, companyId, apiBaseUrl }) {
  const [record, setRecord] = useState(null)
  const enabled = Boolean(moduleKey && entity && token && /^(custom|community)\./.test(moduleKey))

  const resourcesQuery = useQuery({
    queryKey: ['module-public-resources', moduleKey, entity, companyId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const qs = new URLSearchParams({ entity })
      const res = await fetch(`${apiBaseUrl}/modules/${encodeURIComponent(moduleKey)}/public-resources?${qs}`, {
        headers: buildApiHeaders(token, companyId),
      })
      if (!res.ok) return []
      return (await res.json()).data ?? []
    },
  })

  const resources = enabled ? resourcesQuery.data ?? [] : []
  const extraDetailActions = resources.length
    ? [{ key: 'share', label: 'Compartir', icon: <Share2 className="h-4 w-4" />, onClick: (row) => setRecord(row) }]
    : []

  const shareDialog = (
    <Dialog open={Boolean(record)} onOpenChange={(open) => !open && setRecord(null)}>
      <DialogContent className="flex max-h-[90dvh] flex-col md:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Compartir por enlace</DialogTitle>
          <DialogDescription>Crea enlaces para que otras personas vean o respondan sin cuenta.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-1">
          {record ? resources.map((resource) => (
            <PublicLinksPanel
              key={resource.key}
              title={resource.title}
              apiBaseUrl={apiBaseUrl}
              token={token}
              companyId={companyId}
              moduleKey={moduleKey}
              resource={resource.key}
              recordId={record.id}
            />
          )) : null}
        </div>
      </DialogContent>
    </Dialog>
  )

  return { extraDetailActions, shareDialog }
}
