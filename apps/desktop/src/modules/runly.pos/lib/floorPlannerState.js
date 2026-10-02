// Pure state for the POS floor planner (PosFloorPlannerScreen): default
// element sizes, the floor -> planner-elements mapping, the history-aware
// reducer and the planner-elements -> save-payload mapping. No React/DOM
// here except the small useHistoryReducer hook, which only wraps useState.
import { useCallback, useState } from 'react'

export const DEFAULT_SIZES = {
  TABLE_SQUARE: { width: 80,  height: 80  },
  TABLE_ROUND:  { width: 80,  height: 80  },
  BAR:          { width: 200, height: 60  },
  WALL:         { width: 150, height: 20  },
  PLANT:        { width: 44,  height: 44  },
  DOOR:         { width: 64,  height: 20  },
  FLOOR_ZONE:   { width: 220, height: 160 },
  PILLAR:       { width: 40,  height: 40  },
  SOFA:         { width: 160, height: 55  },
  WINDOW:       { width: 80,  height: 14  },
  STAIRS:       { width: 80,  height: 100 },
  POLYGON:      { width: 120, height: 100 },
}

const round2 = (n) => Math.round(n * 100) / 100

export function elementsFromFloor(floor) {
  if (!floor?.elements) return []
  return floor.elements.map((el) => {
    const table = floor.tables?.find((t) => t.id === el.tableId)
    const elStyle = el.style ?? {}
    const isTable = el.kind?.startsWith('TABLE_')
    return {
      id: el.id,
      kind: el.kind,
      x: parseFloat(el.x),
      y: parseFloat(el.y),
      width: parseFloat(el.width),
      height: parseFloat(el.height),
      rotation: parseFloat(el.rotation ?? 0) || 0,
      label: el.label ?? null,
      tableId: el.tableId ?? null,
      tableName: table?.name ?? '',
      capacity: isTable ? (table?.capacity ?? 2) : (elStyle.capacity ?? 0),
      chairStyle: elStyle.chairStyle ?? 'auto',
      color: elStyle.color ?? 'neutral',
      points: el.kind === 'POLYGON' ? (elStyle.points ?? []) : undefined,
    }
  })
}

export function canvasReducer(state, action) {
  switch (action.type) {
    case 'LOAD':
      return { elements: action.elements, dirty: false }
    case 'ADD': {
      // FLOOR_ZONE and POLYGON go to beginning (render behind everything)
      const els = (action.element.kind === 'FLOOR_ZONE' || action.element.kind === 'POLYGON')
        ? [action.element, ...state.elements]
        : [...state.elements, action.element]
      return { elements: els, dirty: true }
    }
    case 'MOVE': {
      return {
        elements: state.elements.map((el) => {
          if (el.id !== action.id) return el
          const newX = Math.max(0, action.x)
          const newY = Math.max(0, action.y)
          if (el.kind === 'POLYGON' && el.points?.length) {
            const ddx = newX - el.x
            const ddy = newY - el.y
            return { ...el, x: newX, y: newY, points: el.points.map((p) => ({ x: p.x + ddx, y: p.y + ddy })) }
          }
          return { ...el, x: newX, y: newY }
        }),
        dirty: true,
      }
    }
    case 'RESIZE':
      return {
        elements: state.elements.map((el) =>
          el.id === action.id
            ? { ...el, width: Math.max(20, action.width), height: Math.max(20, action.height) }
            : el,
        ),
        dirty: true,
      }
    case 'UPDATE':
      return {
        elements: state.elements.map((el) =>
          el.id === action.id ? { ...el, ...action.patch } : el,
        ),
        dirty: true,
      }
    case 'APPLY': {
      const patches = new Map(action.patches.map((patch) => [patch.id, patch]))
      return {
        elements: state.elements.map((el) => {
          const patch = patches.get(el.id)
          if (!patch) return el
          const next = { ...el, ...patch }
          if (patch.x !== undefined) next.x = round2(Math.max(0, patch.x))
          if (patch.y !== undefined) next.y = round2(Math.max(0, patch.y))
          if (patch.width !== undefined) next.width = round2(Math.max(20, patch.width))
          if (patch.height !== undefined) next.height = round2(Math.max(20, patch.height))
          return next
        }),
        dirty: true,
      }
    }
    case 'REMOVE':
      return { elements: state.elements.filter((el) => el.id !== action.id), dirty: true }
    case 'BRING_FORWARD': {
      const idx = state.elements.findIndex((e) => e.id === action.id)
      if (idx < 0 || idx === state.elements.length - 1) return state
      const els = [...state.elements]
      ;[els[idx], els[idx + 1]] = [els[idx + 1], els[idx]]
      return { elements: els, dirty: true }
    }
    case 'SEND_BACKWARD': {
      const idx = state.elements.findIndex((e) => e.id === action.id)
      if (idx <= 0) return state
      const els = [...state.elements]
      ;[els[idx - 1], els[idx]] = [els[idx], els[idx - 1]]
      return { elements: els, dirty: true }
    }
    default:
      return state
  }
}

// History-aware reducer wrapper for undo/redo (up to 50 steps)
export function useHistoryReducer(reducer, initialState) {
  const [hist, setHist] = useState({ past: [], present: initialState, future: [] })
  const dispatch = useCallback((action) => {
    if (action.type === 'UNDO') {
      setHist((h) => h.past.length === 0 ? h : {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
      })
      return
    }
    if (action.type === 'REDO') {
      setHist((h) => h.future.length === 0 ? h : {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      })
      return
    }
    setHist((h) => ({
      past: action.type === 'LOAD' ? [] : [...h.past.slice(-49), h.present],
      present: reducer(h.present, action),
      future: [],
    }))
  }, [reducer])
  return [hist.present, dispatch, hist.past.length > 0, hist.future.length > 0]
}

// Maps planner elements to the save payload for PUT /pos/floors/:id/layout.
export function layoutPayload(elements) {
  return elements.map((el) => {
    const item = {
      ...(String(el.id).startsWith('temp_') ? {} : { id: el.id }),
      kind: el.kind,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation ?? 0,
      label: el.label || null,
      tableName: el.tableName || null,
      capacity: typeof el.capacity === 'number' ? el.capacity : undefined,
      chairStyle: el.chairStyle ?? undefined,
      color: el.color ?? undefined,
    }
    if (el.kind === 'POLYGON' && el.points?.length) {
      item.style = { points: el.points }
    }
    return item
  })
}
