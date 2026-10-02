export { CHAIR_PAD, squareChairPositions, roundChairPositions } from '../lib/chairs.js'
import { CHAIR_PAD, squareChairPositions, roundChairPositions } from '../lib/chairs.js'

export function TableSvg({ width, height, isRound, capacity, tableName, chairStyle, isSelected }) {
  const svgW = width + CHAIR_PAD * 2
  const svgH = height + CHAIR_PAD * 2
  const ox = CHAIR_PAD
  const oy = CHAIR_PAD
  const tableR = Math.min(width, height) / 2
  const chairs = isRound
    ? roundChairPositions(width, height, capacity, chairStyle)
    : squareChairPositions(width, height, capacity, chairStyle)
  const selFill = isSelected ? 'var(--primary)' : undefined
  const displayName = tableName ? (tableName.length > 9 ? tableName.slice(0, 8) + '…' : tableName) : ''

  return (
    <svg
      width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ position: 'absolute', left: -CHAIR_PAD, top: -CHAIR_PAD, overflow: 'visible', pointerEvents: 'none' }}
    >
      {chairs.map((c, i) =>
        c.r ? (
          <circle key={i} cx={c.cx} cy={c.cy} r={c.r}
            className="fill-amber-200 stroke-amber-400 dark:fill-amber-800 dark:stroke-amber-600"
            fill={isSelected ? selFill : undefined} stroke={isSelected ? selFill : undefined}
            opacity={isSelected ? 0.55 : 1} strokeWidth={1.5} />
        ) : (
          <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx={c.rx ?? 3}
            className="fill-amber-200 stroke-amber-400 dark:fill-amber-800 dark:stroke-amber-600"
            fill={isSelected ? selFill : undefined} stroke={isSelected ? selFill : undefined}
            opacity={isSelected ? 0.55 : 1} strokeWidth={1.5} />
        ),
      )}

      {isRound ? (
        <circle cx={ox + width/2} cy={oy + height/2} r={tableR - 2}
          className="fill-amber-50 stroke-amber-400 dark:fill-amber-950/70 dark:stroke-amber-500"
          stroke={isSelected ? 'var(--primary)' : undefined} strokeWidth={isSelected ? 2.5 : 2} />
      ) : (
        <rect x={ox+1} y={oy+1} width={width-2} height={height-2} rx={8}
          className="fill-amber-50 stroke-amber-400 dark:fill-amber-950/70 dark:stroke-amber-500"
          stroke={isSelected ? 'var(--primary)' : undefined} strokeWidth={isSelected ? 2.5 : 2} />
      )}

      {!isRound && width > 50 && height > 40 && (
        <line x1={ox+10} y1={oy+height/2} x2={ox+width-10} y2={oy+height/2}
          className="stroke-amber-200 dark:stroke-amber-800" strokeWidth={1} strokeLinecap="round" />
      )}

      {displayName && (
        <text x={ox+width/2} y={oy+height/2+(capacity?-5:1)} textAnchor="middle" dominantBaseline="middle"
          fontSize={Math.min(12, width/6)} fontWeight="700" fontFamily="inherit"
          className="fill-amber-900 dark:fill-amber-100">{displayName}</text>
      )}
      {capacity > 0 && (
        <text x={ox+width/2} y={oy+height/2+(displayName?10:1)} textAnchor="middle" dominantBaseline="middle"
          fontSize={9} fontFamily="inherit" className="fill-amber-700 dark:fill-amber-400">{capacity} pax</text>
      )}

      {isSelected && (
        isRound
          ? <circle cx={ox+width/2} cy={oy+height/2} r={tableR+5} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="5 3" />
          : <rect x={ox-5} y={oy-5} width={width+10} height={height+10} rx={11} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="5 3" />
      )}
    </svg>
  )
}
