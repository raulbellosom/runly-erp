import { useEffect, useMemo, useRef, useState } from 'react'
import { createGeoFrame, mapCamera } from '../lib/geo.js'

const MIN_ZOOM = 0, MAX_ZOOM = 22
const clampZoom = (zoom) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

// Non-interactive MapLibre map rendered behind the transparent canvas; it
// follows the canvas viewport (pan/zoom) via `jumpTo` and is only mounted
// for pages with a map background, loading `maplibre-gl` lazily so it never
// enters the main bundle.
export function MapBackdrop({ background, viewport, size, config }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [failed, setFailed] = useState(false)
  const origin = background?.type === 'map' ? background.origin : null
  const styleUrl = config?.enabled ? config.styleUrl : null
  // Keyed by value (not object identity) so the map is only rebuilt when the
  // place or the style actually changes.
  const frame = useMemo(() => (origin ? createGeoFrame(origin) : null), [origin?.lat, origin?.lng])

  useEffect(() => {
    if (!containerRef.current || !frame || !styleUrl) return undefined
    let cancelled = false
    setFailed(false)
    const container = containerRef.current
    const load = async () => {
      const [maplibregl] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      if (cancelled) return
      const camera = mapCamera(viewport, size, frame)
      const map = new maplibregl.Map({
        container,
        style: styleUrl,
        interactive: false,
        attributionControl: { compact: true },
        center: [camera.center.lng, camera.center.lat],
        zoom: clampZoom(camera.zoom),
        fadeDuration: 0,
      })
      map.on('error', () => setFailed(true))
      mapRef.current = map
    }
    load()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // viewport/size changes are applied imperatively below via jumpTo; only
    // the place (frame) or the style should recreate the map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, styleUrl])

  useEffect(() => {
    if (!mapRef.current || !frame || !size.width || !size.height) return
    const camera = mapCamera(viewport, size, frame)
    mapRef.current.jumpTo({ center: [camera.center.lng, camera.center.lat], zoom: clampZoom(camera.zoom) })
  }, [frame, viewport, size])

  if (background?.type !== 'map' || !config?.enabled) return null
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div ref={containerRef} className="absolute inset-0" />
      {failed ? (
        <p className="glass pointer-events-none absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-xs font-medium shadow-md">
          No se pudo cargar el mapa
        </p>
      ) : null}
    </div>
  )
}
