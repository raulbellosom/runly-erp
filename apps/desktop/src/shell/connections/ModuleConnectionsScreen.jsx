import { useParams } from 'react-router-dom'
import { EmptyState } from '@runly/ui'
import { Plug } from 'lucide-react'
import { ConnectionsScreen } from './ConnectionsScreen.jsx'

// "Conexiones" route of any connectable core module (spec
// 2026-10-03-rme3-module-platform-v2 §16): the module key in the URL picks the
// target type. Adding a module = one entry here + its nav item/permission.
export const CONNECTABLE_MODULES = Object.freeze({
  'runly.inventory': { targetType: 'inventory_item', description: 'Módulos que agregan datos a los artículos de inventario.' },
  'runly.contacts': { targetType: 'contact', description: 'Módulos que agregan datos a los contactos.' },
  'runly.hr': { targetType: 'hr_employee', description: 'Módulos que agregan datos a los colaboradores.' },
  'runly.projects': { targetType: 'project', description: 'Módulos que agregan datos a los proyectos.' },
})

export default function ModuleConnectionsScreen() {
  const { moduleKey } = useParams()
  const config = CONNECTABLE_MODULES[moduleKey]
  if (!config) {
    return <div className="p-6"><EmptyState icon={Plug} title="Sin conexiones" description="Este módulo no acepta conexiones." /></div>
  }
  return (
    <ConnectionsScreen
      targetType={config.targetType}
      description={`${config.description} Elige cuáles se usan y qué campos se muestran, editan y buscan.`}
    />
  )
}
