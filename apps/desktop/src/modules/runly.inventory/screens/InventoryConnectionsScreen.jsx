import { ConnectionsScreen } from '../../../shell/connections/ConnectionsScreen.jsx'

// Inventario > Conexiones (spec 2026-10-03-rme3-module-platform-v2 §8.2).
export default function InventoryConnectionsScreen() {
  return (
    <ConnectionsScreen
      targetType="inventory_item"
      description="Módulos que agregan datos a los artículos de inventario. Elige cuáles se usan y qué campos se muestran, editan y buscan."
    />
  )
}
