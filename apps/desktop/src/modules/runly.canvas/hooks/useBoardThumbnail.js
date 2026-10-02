import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { renderThumbnail } from '../lib/thumbnail.js'

const unwrap = (response) => response?.data ?? response
const IDLE_MS = 8_000
const MIN_INTERVAL_MS = 60_000
const AUTO_COVER_DELAY_MS = 3_000
const AUTO_COVER_MAX_AGE_MS = 7 * 86_400_000

// A cover is due for an automatic refresh when there is none yet, or when
// metadata never recorded one (treated the same as missing), or when the
// Board changed after the last cover AND that cover is older than 7 days.
function coverIsStale(board) {
  if (!board?.thumbnailFileId) return true
  const thumbnailAt = board.metadata?.thumbnailAt ? new Date(board.metadata.thumbnailAt) : null
  if (!thumbnailAt || Number.isNaN(thumbnailAt.getTime())) return true
  const updatedAt = board.updatedAt ? new Date(board.updatedAt) : null
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return false
  return updatedAt.getTime() > thumbnailAt.getTime() && Date.now() - thumbnailAt.getTime() > AUTO_COVER_MAX_AGE_MS
}

// Uploads a fresh 640x360 PNG preview of the Board a few seconds after the
// user stops editing, at most once a minute, so the Boards list card shows
// up-to-date content without generating on every keystroke/drag. Also runs
// once per Board automatically a few seconds after it loads with no (or
// stale) cover, so a Board nobody has edited since Phase 1 still gets one.
export function useBoardThumbnail({ boardId, enabled, rows, saving, board = null, loaded = false }) {
  const token = useAuth().session?.access_token
  const client = useQueryClient()
  const dirtyRef = useRef(false)
  const lastRef = useRef(0)
  const timerRef = useRef(null)
  const rowsRef = useRef(rows)
  const tokenRef = useRef(token)
  const boardIdRef = useRef(boardId)
  const boardRef = useRef(board)
  const autoCoverRef = useRef(null)
  rowsRef.current = rows; tokenRef.current = token; boardIdRef.current = boardId; boardRef.current = board

  async function generate() {
    const currentRows = rowsRef.current.filter((row) => !row.pending)
    if (!currentRows.length) return
    const currentToken = tokenRef.current, currentBoardId = boardIdRef.current
    try {
      const fileIds = [...new Set(currentRows.filter((row) => row.type === 'image' && row.properties?.fileId).map((row) => row.properties.fileId))]
      const imageUrls = fileIds.length ? unwrap(await runly.files.batchSignedUrls(fileIds, currentToken)) ?? {} : {}
      const blob = await renderThumbnail(currentRows, { imageUrls })
      if (!blob) return
      const form = new FormData()
      form.append('file', new File([blob], 'miniatura.png', { type: 'image/png' }))
      form.append('moduleKey', 'runly.canvas')
      form.append('entityType', 'CanvasBoard')
      form.append('entityId', currentBoardId)
      const asset = unwrap(await runly.files.upload(form, currentToken))
      const metadata = { ...(boardRef.current?.metadata ?? {}), thumbnailAt: new Date().toISOString() }
      await runly.canvas.updateBoard(currentBoardId, { thumbnailFileId: asset.id, metadata }, currentToken)
      dirtyRef.current = false
      lastRef.current = Date.now()
      client.invalidateQueries({ queryKey: ['canvas', 'boards'], exact: true })
    } catch (error) {
      // Thumbnails are best effort: never surface a toast for this.
      if (import.meta.env.DEV) console.warn('[runly.canvas] thumbnail generation failed', error)
    }
  }

  // Only this session's own saves make the thumbnail stale: opening a Board
  // (rows arriving) or receiving a collaborator's delta must not upload one.
  useEffect(() => { if (saving) dirtyRef.current = true }, [saving])

  useEffect(() => {
    if (!enabled || !dirtyRef.current || saving) return undefined
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (Date.now() - lastRef.current >= MIN_INTERVAL_MS) generate()
      // dirtyRef stays true (not yet generated), and the next rows/saving
      // change will restart the idle timer until the minimum interval has passed.
    }, IDLE_MS)
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
    // generate reads its inputs from refs, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, saving, enabled])

  // Automatic cover for a Board that opened with none (or a stale one): once
  // per Board id, scheduled a few seconds after the objects are loaded.
  useEffect(() => {
    if (!enabled || !loaded || !board?.id) return undefined
    if (autoCoverRef.current === board.id) return undefined
    if (!rows.some((row) => !row.pending)) return undefined
    if (!coverIsStale(board)) return undefined
    autoCoverRef.current = board.id
    const timer = setTimeout(() => generate(), AUTO_COVER_DELAY_MS)
    return () => clearTimeout(timer)
    // generate reads its inputs from refs, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, enabled, loaded, rows])

  useEffect(() => () => {
    if (dirtyRef.current) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
