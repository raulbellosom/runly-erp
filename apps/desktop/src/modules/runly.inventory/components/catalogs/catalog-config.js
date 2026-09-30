import { Activity, Boxes, MapPin, Shapes, SlidersHorizontal, Tag } from 'lucide-react'

export const CATALOGS = [
  { key: 'types', label: 'Tipos', icon: Shapes, description: 'Qué es cada activo. Define su ícono, color y los campos personalizados que pide.' },
  { key: 'brands', label: 'Marcas', icon: Tag, description: 'Fabricantes de tus activos y modelos.' },
  { key: 'models', label: 'Modelos', icon: Boxes, description: 'Tipo, marca, nombre y año. Al elegir un modelo en un activo se completan tipo y marca.' },
  { key: 'locations', label: 'Ubicaciones', icon: MapPin, description: 'Dónde se encuentran tus activos.' },
  { key: 'conditions', label: 'Condiciones', icon: Activity, description: 'Estado físico de cada activo (nuevo, en uso, descompuesto...). Es descriptivo; las altas y bajas se manejan aparte.' },
  { key: 'custom-fields', label: 'Campos personalizados', icon: SlidersHorizontal, description: 'Datos extra que pide cada tipo de activo (por ejemplo RAM o placas).' },
]

// Old links (?tab=categories) keep working.
const LEGACY = { categories: 'types' }

export function resolveCatalogKey(requested) {
  const key = LEGACY[requested] ?? requested
  return CATALOGS.some((catalog) => catalog.key === key) ? key : 'types'
}

export const catalogByKey = (key) => CATALOGS.find((catalog) => catalog.key === key)
