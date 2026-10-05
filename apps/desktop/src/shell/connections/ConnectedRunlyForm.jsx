import { useQueryClient } from '@tanstack/react-query'
import { buildApiHeaders } from '@runly/ui'
import { ConnectedFormPresentation } from '@runly/ui/integrations'
import { useConnectionForm } from './useConnectionForm.js'

// Drop-in replacement for RunlyForm on a connectable core record (spec
// 2026-10-03-rme3-module-platform-v2 §8.2, D3): adds the "Módulos conectados"
// section when the company has active connections with form fields, and
// sends their values in the same create/update request, so the server saves
// the record and its sections in one transaction. A caller's own
// submitRequest (e.g. inventory bulk capture) still wins when given.
export function ConnectedRunlyForm({ targetType, targetId = null, blueprint, componentRegistry = null, submitRequest = null, apiBaseUrl, token, companyId, ...props }) {
  const queryClient = useQueryClient()
  const connectionForm = useConnectionForm({ targetType, targetId })
  const hasConnections = connectionForm.sections.length > 0

  async function submitWithConnections({ payload, recordId, mode }) {
    const apiPath = String(blueprint?.schema?.apiPath ?? '').replace(/\/+$/, '')
    const editing = mode === 'edit' && recordId
    const response = await fetch(`${apiBaseUrl}${apiPath}${editing ? `/${encodeURIComponent(recordId)}` : ''}`, {
      method: editing ? 'PATCH' : 'POST',
      headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...payload, connections: connectionForm.payload() ?? undefined }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      connectionForm.applyErrorResponse(body)
      throw new Error(body?.error ?? 'No se pudo guardar la información.')
    }
    void queryClient.invalidateQueries({ queryKey: ['connections'] })
    void connectionForm.reset()
    return body
  }

  return (
    <ConnectedFormPresentation
        connectionForm={connectionForm}
        {...props}
        blueprint={blueprint}
        componentRegistry={componentRegistry}
        submitRequest={submitRequest ?? (hasConnections ? submitWithConnections : null)}
        apiBaseUrl={apiBaseUrl}
        token={token}
        companyId={companyId}
      />
  )
}
