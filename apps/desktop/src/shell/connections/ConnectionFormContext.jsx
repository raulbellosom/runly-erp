import { createContext, useContext } from 'react'
import { ConnectionFormSections } from './ConnectionFormSections.jsx'

// Lets a blueprint `component` section of a core RunlyForm render the
// connection sections held by the screen's useConnectionForm (stable
// component identity; the state comes through context, not props).
const ConnectionFormContext = createContext(null)

export function ConnectionFormProvider({ form, children }) {
  return <ConnectionFormContext.Provider value={form}>{children}</ConnectionFormContext.Provider>
}

export function ConnectionFormSlot() {
  const form = useContext(ConnectionFormContext)
  return <ConnectionFormSections form={form} variant="plain" />
}

export const CONNECTIONS_FORM_COMPONENT = 'runly.connections-form'
