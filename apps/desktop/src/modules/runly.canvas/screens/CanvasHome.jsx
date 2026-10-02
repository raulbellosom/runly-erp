import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, ErrorState, PageHeader, SearchInput } from '@runly/ui'
import { PanelsTopLeft, Plus, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { BoardActionsDialogs } from '../components/BoardActionsDialogs.jsx'
import { BoardCard } from '../components/BoardCard.jsx'
import { BoardCardSkeleton, HomeToolbarSkeleton } from '../components/skeletons.jsx'
import { BoardFilters } from '../components/BoardFilters.jsx'
import { CreateBoardDialog } from '../components/CreateBoardDialog.jsx'
import { useBoardSearch, useBoards, useCreateBoard } from '../hooks/useCanvasData.js'
import { DEFAULT_FILTERS, activeFilterCount, applyBoardFilters, orderBySearch } from '../lib/boardFilters.js'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
const STORAGE_KEY = 'runly.canvas.home.filters'
const SEARCH_DEBOUNCE_MS = 250
const unwrap = (response) => response?.data ?? response

function loadStoredFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_FILTERS, ...parsed } : DEFAULT_FILTERS
  } catch { return DEFAULT_FILTERS }
}

function storeFilters(filters) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) } catch { /* best effort — e.g. private mode */ }
}

// Debounces the search box so the server query only fires once typing pauses.
function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// Signed URLs for every Board that already has a thumbnail, batched in one
// call and cached for 30 minutes (same pattern as useCanvasImages).
function useThumbnailUrls(fileIds) {
  const token = useAuth().session?.access_token
  return useQuery({
    queryKey: ['canvas', 'thumbnail-urls', fileIds],
    queryFn: async () => unwrap(await runly.files.batchSignedUrls(fileIds, token)) ?? {},
    enabled: Boolean(token && fileIds.length),
    staleTime: 30 * 60_000,
  })
}

export default function CanvasHome() {
  const navigate = useNavigate(), boards = useBoards(), create = useCreateBoard()
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const [boardDialog, setBoardDialog] = useState({ board: null, mode: null })
  const [filters, setFilters] = useState(loadStoredFilters)
  useEffect(() => storeFilters(filters), [filters])

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const searching = debouncedQuery.trim().length >= 2
  const search = useBoardSearch(debouncedQuery)

  const list = useMemo(() => boards.data ?? [], [boards.data])
  const thumbnailIds = useMemo(() => [...new Set(list.filter((board) => board.thumbnailFileId).map((board) => board.thumbnailFileId))].sort(), [list])
  const thumbnailUrls = useThumbnailUrls(thumbnailIds)

  // Search order wins over the "Orden" filter (sort: null keeps it); template/
  // access/updated still apply so the two ways to narrow the list compose.
  const filtered = useMemo(() => (
    searching
      ? applyBoardFilters(orderBySearch(list, search.data ?? []), { ...filters, sort: null })
      : applyBoardFilters(list, filters)
  ), [list, filters, searching, search.data])

  const openBoard = (id) => navigate(`/app/m/runly.canvas/${id}`)
  const filtersActive = activeFilterCount(filters) > 0
  const clearFilters = () => setFilters(DEFAULT_FILTERS)

  async function submit(data) {
    try {
      const board = await create.mutateAsync(data)
      setOpen(false)
      openBoard(board.id)
      return true
    } catch (error) { toast.error(error.message); return false }
  }

  const ready = !boards.isLoading && !boards.isError
  // Only the FIRST search fetch shows a skeleton — keepPreviousData keeps the
  // prior results (and isLoading false) while a refined query is in flight.
  const searchLoading = searching && search.isLoading
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        eyebrow="Runly Canvas"
        title="Boards"
        description="Planos, mapas técnicos y diagramas conectados con tus datos de Runly."
        actions={<Button onClick={() => setOpen(true)} className="w-full sm:w-auto"><Plus />Nuevo Board</Button>}
      />

      {ready && list.length > 0 ? (
        <div className="mb-5 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')}
              placeholder="Buscar en nombres, hotspots, textos y registros…" className="w-full sm:max-w-sm"
            />
            <p className="text-sm tabular-nums text-[hsl(var(--muted-foreground))]" aria-live="polite">
              {filtered.length} {filtered.length === 1 ? 'Board' : 'Boards'}
            </p>
          </div>
          <BoardFilters filters={filters} onChange={setFilters} onClear={clearFilters} />
        </div>
      ) : null}

      {boards.isLoading ? <HomeToolbarSkeleton /> : null}
      {boards.isLoading ? <div className={GRID} aria-busy="true" aria-label="Cargando Boards">{[1, 2, 3, 4, 5, 6].map((key) => <BoardCardSkeleton key={key} />)}</div> : null}
      {boards.isError ? <ErrorState title="No se pudieron cargar los Boards" description={boards.error?.message} onRetry={() => boards.refetch()} /> : null}

      {ready && !list.length ? (
        <EmptyState
          icon={PanelsTopLeft}
          title="Aún no hay Boards"
          description="Crea tu primer Board para dibujar planos, marcar hotspots y vincularlos con registros de Runly."
          action={<Button onClick={() => setOpen(true)}><Plus />Crear Board</Button>}
        />
      ) : null}

      {ready && list.length > 0 && searchLoading ? (
        <div className={GRID} aria-busy="true" aria-label="Buscando Boards">{[1, 2, 3, 4, 5, 6].map((key) => <BoardCardSkeleton key={key} />)}</div>
      ) : null}

      {ready && list.length > 0 && !searchLoading && !filtered.length ? (
        <EmptyState
          icon={SearchX}
          title="Sin resultados"
          description={searching ? `Ningún Board coincide con «${debouncedQuery.trim()}».` : 'Ningún Board coincide con los filtros seleccionados.'}
          action={(
            <div className="flex flex-wrap items-center justify-center gap-2">
              {searching ? <Button variant="outline" onClick={() => setQuery('')}>Limpiar búsqueda</Button> : null}
              {filtersActive ? <Button variant="outline" onClick={clearFilters}>Limpiar filtros</Button> : null}
            </div>
          )}
        />
      ) : null}

      {ready && !searchLoading && filtered.length > 0 ? (
        <ul className={GRID}>
          {filtered.map((board) => (
            <li key={board.id} className="flex">
              <BoardCard
                board={board} onOpen={() => openBoard(board.id)}
                thumbnailUrl={board.thumbnailFileId ? thumbnailUrls.data?.[board.thumbnailFileId] : null} matches={board.matches}
                onRename={() => setBoardDialog({ board, mode: 'rename' })}
                onDelete={() => setBoardDialog({ board, mode: 'delete' })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <CreateBoardDialog open={open} onOpenChange={setOpen} onSubmit={submit} pending={create.isPending} />
      <BoardActionsDialogs
        board={boardDialog.board}
        mode={boardDialog.mode}
        onClose={() => setBoardDialog({ board: null, mode: null })}
      />
    </div>
  )
}
