// Lucide icon registry by kebab-case name. The app already ships every lucide
// icon in its ui-vendor chunk (several @runly/ui renderers import the full
// namespace), so reusing that namespace costs nothing extra. Each icon's raw
// SVG node list is read from the component once; IconGlyph renders it as SVG
// and runly.canvas draws it onto its Canvas2D context. Names are lucide's
// kebab-case ids (CanvasHotspot.icon, note.icon, ...).
import * as LucideIcons from 'lucide-react'

let registry = null
let canonical = null
const toKebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()

// kebab name -> node list, built on first use from the components' icon data.
// Aliases (older names lucide renamed, e.g. trash-2) resolve too, so stored
// names keep working across lucide upgrades; `canonical` lists each icon once.
function buildRegistry() {
  const map = new Map()
  canonical = new Set()
  for (const [exportName, component] of Object.entries(LucideIcons)) {
    if (!/^[A-Z]/.test(exportName) || exportName.endsWith('Icon') || exportName.startsWith('Lucide') || typeof component?.render !== 'function') continue
    try {
      const data = component.render({}, null)?.props?.icon
      if (!data?.name || !Array.isArray(data.node)) continue
      if (!map.has(data.name)) { map.set(data.name, data.node); canonical.add(data.name) }
      const alias = toKebab(exportName)
      if (!map.has(alias)) map.set(alias, data.node)
    } catch {
      // Not an icon component (e.g. Icon, createLucideIcon); skip.
    }
  }
  return map
}
function icons() { return (registry ??= buildRegistry()) }

export function allIconNames() { icons(); return [...canonical].sort() }
export function isKnownIcon(name) { return Boolean(name && icons().has(name)) }
export function getIconNode(name) { return name ? icons().get(name) ?? null : null }
