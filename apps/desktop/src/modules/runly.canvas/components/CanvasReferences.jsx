import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@runly/ui'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
import { templateIcon } from '../lib/boardMeta.js'

const unwrap = (response) => response?.data ?? response

// Boards where an ERP record appears, through an entity link or a data
// binding (see GET /canvas/references). Meant to sit right under a record's
// RunlyDetail; renders nothing while loading, on error (e.g. the viewer lacks
// canvas.view) or when the record is not on any Board.
export function CanvasReferences({ moduleKey, entityType, entityId }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token
  const templates = useCanvasTemplates()
  const boards = useQuery({
    queryKey: ['canvas', 'references', moduleKey, entityType, entityId],
    queryFn: async () => unwrap(await runly.canvas.listReferences({ moduleKey, entityType, entityId }, token)) ?? [],
    enabled: Boolean(token && moduleKey && entityType && entityId),
    retry: false,
  })

  if (boards.isLoading || boards.isError || !boards.data?.length) return null

  return (
    <section className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">En Canvas</h2>
      <ul className="space-y-1.5">
        {boards.data.map((board) => {
          const template = templates.data?.find((item) => item.key === board.templateType)
          const Icon = templateIcon(template?.icon)
          return (
            <li key={board.boardId} className="flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2">
              <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{board.name}</span>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/app/m/runly.canvas/${board.boardId}`)}>
                <ExternalLink className="h-3.5 w-3.5" />Abrir
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
