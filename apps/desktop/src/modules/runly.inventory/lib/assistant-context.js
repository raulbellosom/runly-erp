import { createContext, useContext } from 'react'
export const InventoryAssistantContext = createContext(null)
export function useInventoryAssistant() { return useContext(InventoryAssistantContext) }
export const ALL_INVENTORY = { mode: 'all', ids: [], filters: {}, allowCompanySearch: false }
export function inventoryScopeLabel(context = ALL_INVENTORY) {
  const labels = { all: 'Todo el inventario', filtered: 'Resultados filtrados', selected: `${context.ids?.length ?? 0} equipos seleccionados`, item: 'Un equipo' }
  return `${labels[context.mode]}${context.allowCompanySearch && context.mode !== 'all' ? ' · permite ampliar la búsqueda' : ''}`
}
