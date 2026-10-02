import { Database, Image, MapPin, Shapes } from 'lucide-react'

// Layer names depend on the Board template ("Espacios", "Documento"…); the
// kind is what decides behaviour, so the panel always shows it. Shared by
// the Layers panel and its collapsible "¿Qué es cada capa?" help section.
export const LAYER_KINDS = {
  background: { icon: Image, label: 'Fondo', help: 'aquí quedan los planos, imágenes y PDF que insertas; bloquéala para que no se muevan.' },
  vector: { icon: Shapes, label: 'Dibujo', help: 'formas, textos, flechas e imágenes.' },
  hotspot: { icon: MapPin, label: 'Puntos', help: 'hotspots con información, archivos y registros vinculados (doble clic para abrir).' },
  data: { icon: Database, label: 'Datos', help: 'formas conectadas a registros de Runly (inventario, vehículos…) que muestran su estado. Usa "Conectar a datos" en el inspector.' },
}
export const KIND_ORDER = ['background', 'vector', 'hotspot', 'data']
export const layerKind = (layer) => (layer.type === 'vector' && layer.metadata?.mediaTarget ? 'background' : LAYER_KINDS[layer.type] ? layer.type : 'vector')

// A hotspot can only live in a hotspot layer, and a hotspot layer can only
// hold hotspots — used by "Mover a capa" (menu) and element drag-and-drop
// (Layers panel) to filter valid destinations.
export const canHostType = (layer, type) => (type === 'hotspot' ? layer.type === 'hotspot' : layer.type !== 'hotspot')
