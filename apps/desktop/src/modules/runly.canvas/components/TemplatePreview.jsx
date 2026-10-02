import { previewFor } from '../lib/templatePreviews.js'

const TONES = {
  line: { fill: 'none', stroke: 'hsl(var(--foreground) / 0.55)' },
  accent: { fill: 'hsl(var(--primary) / 0.18)', stroke: 'hsl(var(--primary))' },
  soft: { fill: 'hsl(var(--muted-foreground) / 0.18)', stroke: 'hsl(var(--muted-foreground) / 0.4)' },
}

function PreviewShape({ shape }) {
  const tone = TONES[shape.tone] ?? TONES.line
  const props = {
    fill: shape.kind === 'line' || (shape.kind === 'path' && shape.tone === 'line') ? 'none' : tone.fill,
    stroke: tone.stroke, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    strokeDasharray: shape.dash ? '4 3' : undefined,
  }
  if (shape.kind === 'rect') return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r ?? 0} {...props} />
  if (shape.kind === 'circle') return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />
  if (shape.kind === 'line') return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...props} />
  return <path d={shape.d} {...props} />
}

// Decorative: the card label already names the template.
export function TemplatePreview({ preview, grid = false, className }) {
  const patternId = `canvas-template-grid-${preview}`
  return (
    <svg viewBox="0 0 120 68" className={className} aria-hidden="true" focusable="false">
      {grid ? (
        <>
          <defs>
            <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill="hsl(var(--muted-foreground) / 0.4)" />
            </pattern>
          </defs>
          <rect width="120" height="68" fill={`url(#${patternId})`} />
        </>
      ) : null}
      {previewFor(preview).map((shape, index) => <PreviewShape key={index} shape={shape} />)}
    </svg>
  )
}
