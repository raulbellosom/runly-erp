// apps/api/src/routes/canvas/canvas-templates.js
//
// Single catalog of Board templates. createBoard/createPage apply it,
// GET /canvas/templates serves it to the "Nuevo Board" dialog and MirAI
// derives its board types from it, so the three never drift apart.

export const BOARD_TOOLS = ['select', 'rectangle', 'ellipse', 'triangle', 'diamond', 'line', 'arrow', 'text', 'hotspot']
export const GRID_SIZE_MIN = 4
export const GRID_SIZE_MAX = 200

const settings = (enabled, size, snapping, defaultTool = 'select') => ({ version: 2, grid: { enabled, size }, snapping, defaultTool })
// Inserted images/PDF pages go to the first layer flagged mediaTarget.
const MEDIA = { mediaTarget: true }

export const CANVAS_TEMPLATES = [
  {
    key: 'blank', label: 'En blanco', icon: 'square', preview: 'blank',
    description: 'Lienzo libre',
    useWhen: 'Quieres bocetar ideas o tu caso no encaja en otro tipo.',
    includes: ['Sin cuadrícula', 'Capas: Dibujo, Hotspots y Datos Runly', 'Todas las herramientas disponibles'],
    namePlaceholder: 'Ej. Ideas de lanzamiento',
    settings: settings(false, 24, false),
    layers: [{ name: 'Dibujo', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Esta página está vacía', description: 'Dibuja formas, escribe textos, coloca hotspots o inserta una imagen o PDF desde la barra inferior.', action: null },
  },
  {
    key: 'plan', label: 'Plano', icon: 'frame', preview: 'plan',
    description: 'Planta o croquis',
    useWhen: 'Tienes la planta de un local, oficina, bodega o casa y quieres marcar áreas y puntos.',
    includes: ['Cuadrícula de 20 con ajuste', 'Capas: Plano base, Mobiliario y Hotspots', 'El plano que insertes queda en la capa Plano base', 'Capa Datos Runly para conectar registros'],
    namePlaceholder: 'Ej. Planta baja — bodega',
    settings: settings(true, 20, true),
    layers: [{ name: 'Plano base', type: 'vector', metadata: MEDIA }, { name: 'Mobiliario', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Sube el plano de tu espacio', description: 'Inserta una imagen o un PDF del plano; queda en la capa Plano base para dibujar encima.', action: { label: 'Insertar plano', kind: 'insert-media' } },
  },
  {
    key: 'technical-map', label: 'Mapa técnico', icon: 'map', preview: 'technical-map',
    description: 'Instalaciones y puntos',
    useWhen: 'Documentas instalaciones (electricidad, agua, datos, maquinaria) y quieres un punto por equipo.',
    includes: ['Cuadrícula suave de 40', 'Capas: Instalaciones y Puntos', 'Empieza con la herramienta de hotspot', 'Capa Datos Runly para conectar registros'],
    namePlaceholder: 'Ej. Red eléctrica — nave 2',
    settings: settings(true, 40, false, 'hotspot'),
    layers: [{ name: 'Instalaciones', type: 'vector', metadata: MEDIA }, { name: 'Puntos', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Marca los puntos de tu instalación', description: 'Coloca hotspots sobre equipos, tomas o tableros y vincúlalos con inventario o vehículos. También puedes insertar un esquema de fondo.', action: { label: 'Insertar esquema', kind: 'insert-media' } },
  },
  {
    key: 'diagram', label: 'Diagrama', icon: 'workflow', preview: 'diagram',
    description: 'Procesos y flujos',
    useWhen: 'Vas a dibujar un proceso, un flujo de aprobación o un organigrama.',
    includes: ['Cuadrícula de 10 con ajuste', 'Capas: Formas y Notas', 'Empieza con la herramienta de rectángulo'],
    namePlaceholder: 'Ej. Flujo de compras',
    settings: settings(true, 10, true, 'rectangle'),
    layers: [{ name: 'Formas', type: 'vector' }, { name: 'Notas', type: 'vector' }],
    emptyState: { title: 'Dibuja tu primer paso', description: 'Usa rectángulos para los pasos, rombos para las decisiones y flechas para el flujo.', action: { label: 'Dibujar rectángulo', kind: 'tool:rectangle' } },
  },
  {
    key: 'layout', label: 'Distribución', icon: 'layout-grid', preview: 'layout',
    description: 'Espacios y mobiliario',
    useWhen: 'Acomodas mesas, estantes o puestos de trabajo, para un evento o una reubicación.',
    includes: ['Cuadrícula de 20 con ajuste', 'Capas: Espacios, Elementos y Hotspots', 'El plano que insertes queda en la capa Espacios', 'Capa Datos Runly para conectar registros'],
    namePlaceholder: 'Ej. Acomodo evento aniversario',
    settings: settings(true, 20, true),
    layers: [{ name: 'Espacios', type: 'vector', metadata: MEDIA }, { name: 'Elementos', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Acomoda tu espacio', description: 'Inserta el plano del lugar o dibuja directamente los espacios, mesas o estantes.', action: { label: 'Insertar plano', kind: 'insert-media' } },
  },
  {
    key: 'pdf-review', label: 'Revisión de PDF', icon: 'file-search', preview: 'pdf-review',
    description: 'Marcas sobre documentos',
    useWhen: 'Necesitas revisar un PDF y dejar observaciones encima de sus páginas.',
    includes: ['Sin cuadrícula', 'Capas: Documento, Anotaciones y Hotspots', 'El PDF queda bloqueado en la capa Documento'],
    namePlaceholder: 'Ej. Revisión contrato proveedor',
    settings: settings(false, 24, false),
    layers: [{ name: 'Documento', type: 'vector', metadata: { ...MEDIA, lockAfterInsert: true } }, { name: 'Anotaciones', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }],
    emptyState: { title: 'Inserta el PDF a revisar', description: 'Las páginas quedan en la capa Documento, bloqueada para que no se muevan mientras anotas.', action: { label: 'Insertar PDF', kind: 'insert-media' } },
  },
  {
    key: 'site-map', label: 'Mapa de sitio', icon: 'globe', preview: 'site-map',
    description: 'Sobre un mapa real',
    useWhen: 'Quieres marcar sucursales, terrenos, obras o rutas sobre un mapa con medidas en metros.',
    includes: ['Fondo de mapa de OpenStreetMap', 'Medidas en metros sin calibrar', 'Capas: Zonas, Puntos y Datos Runly'],
    namePlaceholder: 'Ej. Sucursales zona norte',
    settings: settings(false, 24, false),
    layers: [{ name: 'Zonas', type: 'vector' }, { name: 'Puntos', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Ubica tu sitio en el mapa', description: 'Busca una dirección o lugar para usar el mapa como fondo de esta página.', action: { label: 'Ubicar en el mapa', kind: 'map' } },
  },
]

export function templateFor(key) {
  return CANVAS_TEMPLATES.find((template) => template.key === key) ?? CANVAS_TEMPLATES[0]
}

function invalid(message) { return Object.assign(new Error(message), { status: 400 }) }
const copySettings = (value) => ({ ...value, grid: { ...value.grid } })

// Validates `input` merged over `base` and returns a clean version-2 object.
export function normalizeBoardSettings(input, base = CANVAS_TEMPLATES[0].settings) {
  const source = input && typeof input === 'object' ? input : {}
  const grid = { ...base.grid, ...(source.grid && typeof source.grid === 'object' ? source.grid : {}) }
  if (typeof grid.enabled !== 'boolean') throw invalid('La cuadrícula debe estar activada o desactivada.')
  if (!Number.isInteger(grid.size) || grid.size < GRID_SIZE_MIN || grid.size > GRID_SIZE_MAX) {
    throw invalid(`El tamaño de cuadrícula debe ser un entero entre ${GRID_SIZE_MIN} y ${GRID_SIZE_MAX}.`)
  }
  const snapping = source.snapping ?? base.snapping
  if (typeof snapping !== 'boolean') throw invalid('El ajuste a la cuadrícula debe estar activado o desactivado.')
  const defaultTool = source.defaultTool ?? base.defaultTool
  if (!BOARD_TOOLS.includes(defaultTool)) throw invalid('Herramienta inicial no válida.')
  return { version: 2, grid: { enabled: grid.enabled, size: grid.size }, snapping, defaultTool }
}

// Boards saved before templates had behaviour carry an old settings shape
// (no `version`); they get their template defaults instead, so an old blank
// Board does not suddenly start snapping.
export function effectiveBoardSettings(board) {
  const base = templateFor(board?.templateType).settings
  if (board?.settings?.version !== 2) return copySettings(base)
  try { return normalizeBoardSettings(board.settings, base) } catch { return copySettings(base) }
}

export function templateLayerRows(template, pageId) {
  return template.layers.map((layer, position) => ({ pageId, name: layer.name, type: layer.type, position, metadata: layer.metadata ?? {} }))
}
