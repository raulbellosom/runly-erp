import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { renderThumbnail } from '../lib/thumbnail.js'

const unwrap = (response) => response?.data ?? response
const IDLE_MS = 8_000
const MIN_INTERVAL_MS = 60_000

// Uploads a fresh 640x360 PNG preview of the Board a few seconds after the
// user stops editing, at most once a minute, so the Boards list card shows
// up-to-date content without generating on every keystroke/drag.
export function useBoardThumbnail({ boardId, enabled, rows, saving }) {
  const token = useAuth().session?.access_token
  const client = useQueryClient()
  const dirtyRef = useRef(false)
  const lastRef = useRef(0)
  const timerRef = useRef(null)
  const rowsRef = useRef(rows)
  const tokenRef = useRef(token)
  const boardIdRef = useRef(boardId)
  rowsRef.current = rows; tokenRef.current = token; boardIdRef.current = boardId

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
      await runly.canvas.updateBoard(currentBoardId, { thumbnailFileId: asset.id }, currentToken)
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

  useEffect(() => () => {
    if (dirtyRef.current) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
