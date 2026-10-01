import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState, PageHeader, SearchInput } from '@runly/ui'
import { PanelsTopLeft, Plus, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { BoardCard, BoardCardSkeleton } from '../components/BoardCard.jsx'
import { CreateBoardDialog } from '../components/CreateBoardDialog.jsx'
import { useBoards, useCreateBoard } from '../hooks/useCanvasData.js'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'

export default function CanvasHome() {
  const navigate = useNavigate(), boards = useBoards(), create = useCreateBoard()
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const list = useMemo(() => boards.data ?? [], [boards.data])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? list.filter((board) => `${board.name} ${board.description ?? ''}`.toLowerCase().includes(term)) : list
  }, [list, query])
  const openBoard = (id) => navigate(`/app/m/runly.canvas/${id}`)

  async function submit(data) {
    try {
      const board = await create.mutateAsync(data)
      setOpen(false)
      openBoard(board.id)
      return true
    } catch (error) { toast.error(error.message); return false }
  }

  const ready = !boards.isLoading && !boards.isError
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        eyebrow="Runly Canvas"
        title="Boards"
        description="Planos, mapas técnicos y diagramas conectados con tus datos de Runly."
        actions={<Button onClick={() => setOpen(true)} className="w-full sm:w-auto"><Plus />Nuevo Board</Button>}
      />

      {ready && list.length > 0 ? (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} placeholder="Buscar Boards…" className="w-full sm:max-w-xs" />
          <p className="text-sm tabular-nums text-[hsl(var(--muted-foreground))]" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? 'Board' : 'Boards'}
          </p>
        </div>
      ) : null}

      {boards.isLoading ? <div className={GRID} aria-busy="true" aria-label="Cargando Boards">{[1, 2, 3].map((key) => <BoardCardSkeleton key={key} />)}</div> : null}
      {boards.isError ? <ErrorState title="No se pudieron cargar los Boards" description={boards.error?.message} onRetry={() => boards.refetch()} /> : null}

      {ready && !list.length ? (
        <EmptyState
          icon={PanelsTopLeft}
          title="Aún no hay Boards"
          description="Crea tu primer Board para dibujar planos, marcar hotspots y vincularlos con registros de Runly."
          action={<Button onClick={() => setOpen(true)}><Plus />Crear Board</Button>}
        />
      ) : null}
      {ready && list.length > 0 && !filtered.length ? (
        <EmptyState icon={SearchX} title="Sin resultados" description={`Ningún Board coincide con «${query.trim()}».`} action={<Button variant="outline" onClick={() => setQuery('')}>Limpiar búsqueda</Button>} />
      ) : null}

      {ready && filtered.length > 0 ? (
        <ul className={GRID}>
          {filtered.map((board) => <li key={board.id} className="flex"><BoardCard board={board} onOpen={() => openBoard(board.id)} /></li>)}
        </ul>
      ) : null}

      <CreateBoardDialog open={open} onOpenChange={setOpen} onSubmit={submit} pending={create.isPending} />
    </div>
  )
}
