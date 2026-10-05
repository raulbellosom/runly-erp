import { useMemo } from 'react'
import { RunlyForm } from '../runly-renderer/RunlyForm.jsx'
import { CONNECTIONS_FORM_COMPONENT, ConnectionFormProvider, ConnectionFormSlot } from './ConnectionFormContext.jsx'

export function withConnectionsSection(blueprint) {
  const sections = [...(blueprint?.schema?.sections ?? [])]
  sections.push({ id: 'connections', type: 'component', component: CONNECTIONS_FORM_COMPONENT, label: 'Módulos conectados', icon: 'Plug', collapsible: true, fields: [] })
  return { ...blueprint, schema: { ...blueprint.schema, sections } }
}

// Presentation only. The owning host supplies state, transport and submission.
export function ConnectedFormPresentation({ connectionForm, blueprint, componentRegistry = null, ...props }) {
  const hasConnections = connectionForm.sections.length > 0
  const formBlueprint = useMemo(() => hasConnections ? withConnectionsSection(blueprint) : blueprint, [blueprint, hasConnections])
  const registry = useMemo(() => ({ resolve: key => key === CONNECTIONS_FORM_COMPONENT ? ConnectionFormSlot : componentRegistry?.resolve?.(key) ?? null }), [componentRegistry])
  return <ConnectionFormProvider form={connectionForm}>
    <RunlyForm {...props} blueprint={formBlueprint} componentRegistry={registry} extraDirty={connectionForm.dirty} />
  </ConnectionFormProvider>
}
