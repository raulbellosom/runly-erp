import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RunlyForm, buildApiHeaders } from '@runly/ui'
import { useConnectionForm } from './useConnectionForm.js'
import { CONNECTIONS_FORM_COMPONENT, ConnectionFormProvider, ConnectionFormSlot } from './ConnectionFormContext.jsx'

// Drop-in replacement for RunlyForm on a connectable core record (spec
// 2026-10-03-rme3-module-platform-v2 §8.2, D3): adds the "Módulos conectados"
// section when the company has active connections with form fields, and
// sends their values in the same create/update request, so the server saves
// the record and its sections in one transaction. A caller's own
// submitRequest (e.g. inventory bulk capture) still wins when given.
function withConnectionsSection(blueprint) {
  const sections = [...(blueprint?.schema?.sections ?? [])]
  sections.push({ id: 'connections', type: 'component', component: CONNECTIONS_FORM_COMPONENT, label: 'Módulos conectados', icon: 'Plug', collapsible: true, fields: [] })
  return { ...blueprint, schema: { ...blueprint.schema, sections } }
}

export function ConnectedRunlyForm({ targetType, targetId = null, blueprint, componentRegistry = null, submitRequest = null, apiBaseUrl, token, companyId, ...props }) {
  const queryClient = useQueryClient()
  const connectionForm = useConnectionForm({ targetType, targetId })
  const hasConnections = connectionForm.sections.length > 0

  const formBlueprint = useMemo(() => (hasConnections ? withConnectionsSection(blueprint) : blueprint), [blueprint, hasConnections])
  const registry = useMemo(() => ({
    resolve: (key) => (key === CONNECTIONS_FORM_COMPONENT ? ConnectionFormSlot : componentRegistry?.resolve?.(key) ?? null),
  }), [componentRegistry])

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
    <ConnectionFormProvider form={connectionForm}>
      <RunlyForm
        {...props}
        blueprint={formBlueprint}
        componentRegistry={registry}
        submitRequest={submitRequest ?? (hasConnections ? submitWithConnections : null)}
        extraDirty={connectionForm.dirty}
        apiBaseUrl={apiBaseUrl}
        token={token}
        companyId={companyId}
      />
    </ConnectionFormProvider>
  )
}
