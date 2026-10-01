// Resolves design-system tokens into concrete colors the Canvas2D context can
// use. Canvas cannot read CSS variables, so the renderer receives a plain
// object and is re-themed whenever the app toggles `.dark` on <html>.
const FALLBACK = Object.freeze({
  primary: '#fd6016',
  foreground: 'hsl(222 47% 11%)',
  muted: 'hsl(215 18% 36%)',
  grid: 'hsl(214 13% 80%)',
  surface: 'hsl(0 0% 100%)',
  hotspot: '#dc2626',
  font: 'system-ui, sans-serif',
})

function hslToken(styles, name, alpha) {
  const raw = styles.getPropertyValue(name).trim()
  if (!raw) return null
  return alpha == null ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`
}

export function readCanvasTheme(element) {
  if (typeof window === 'undefined' || !element) return FALLBACK
  const styles = window.getComputedStyle(element)
  return {
    primary: styles.getPropertyValue('--color-primary').trim() || FALLBACK.primary,
    foreground: hslToken(styles, '--foreground') ?? FALLBACK.foreground,
    muted: hslToken(styles, '--muted-foreground') ?? FALLBACK.muted,
    grid: hslToken(styles, '--muted-foreground', 0.28) ?? FALLBACK.grid,
    surface: hslToken(styles, '--card') ?? FALLBACK.surface,
    hotspot: FALLBACK.hotspot,
    font: styles.fontFamily || FALLBACK.font,
  }
}

export function observeThemeChanges(callback) {
  if (typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
  return () => observer.disconnect()
}
