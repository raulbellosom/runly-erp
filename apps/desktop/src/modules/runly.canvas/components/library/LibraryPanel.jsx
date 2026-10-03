import { useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, ConfirmDialog, cn,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  EmptyState, ErrorState, SearchInput, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton,
  Tooltip, TooltipContent, TooltipTrigger,
} from '@runly/ui'
import { Building2, ChevronDown, CircleHelp, FolderUp, Library as LibraryIcon, Loader2, MoreVertical, Pencil, Plus, SearchX, Trash2, User, X } from 'lucide-react'
import { useAuth } from '../../../../auth/AuthProvider.jsx'
import { LibraryTileSkeleton } from '../skeletons.jsx'
import { runly } from '../../../../lib/runly.js'
import { libraryItemsKey, useLibraries, useLibraryImport, useLibraryItemMutations, useLibraryMutations } from '../../hooks/useLibraries.js'
import { LIBRARY_IMPORT_ACCEPT } from '../../lib/libraryImport/formats.js'
import { LibraryItemTile } from './LibraryItemTile.jsx'
import { LibraryFormDialog, RenameItemDialog } from './LibraryFormDialog.jsx'
import { FormatChip, LibraryHelpHeader, LibraryHelpView } from './LibraryHelp.jsx'

const GRID = 'grid grid-cols-4 gap-1 @sm:grid-cols-5'
const IMPORT_CHIPS = ['excalidrawlib', 'svg', 'zip']
const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
const itemsLabel = (count) => `${count} ${count === 1 ? 'elemento' : 'elementos'}`

function LibraryItemsGrid({ library, items, imageUrls, loading, error, locked, onInsert, onItemAction }) {
  if (loading) return <div className={GRID}>{[1, 2, 3, 4].map((key) => <LibraryTileSkeleton key={key} />)}</div>
  if (error) return <p className="py-2 text-sm text-destructive">No se pudieron cargar los elementos.</p>
  if (!items.length) {
    return <p className="py-2 text-xs leading-snug text-[hsl(var(--muted-foreground))]">Vacía. Importa archivos desde el menú de la biblioteca o guarda elementos del Board con clic derecho o manteniéndolos presionados.</p>
  }
  return (
    <div className={GRID}>
      {items.map((item) => (
        <LibraryItemTile
          key={item.id} item={item} libraryId={library.id} imageUrl={item.fileAssetId ? imageUrls[item.fileAssetId] : null}
          canEdit={library.canEdit && !locked} onInsert={onInsert}
          onRename={() => onItemAction('rename', library.id, item)} onDelete={() => onItemAction('delete', library.id, item)}
        />
      ))}
    </div>
  )
}

function LibraryRow({ library, itemsQuery, items, imageUrls, canManage, locked, onInsert, onImportHere, onRename, onChangeScope, onDelete, onItemAction }) {
  const company = library.scope === 'COMPANY'
  const ScopeIcon = company ? Building2 : User
  return (
    <AccordionItem value={library.id} className="bg-[hsl(var(--card))]">
      {/* The actions menu sits beside the trigger (not inside it) so it
          works without expanding the library and is not a nested button. */}
      <div className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">
          <AccordionTrigger className="min-w-0 py-2 pl-3 pr-2">
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium" title={library.name}>{library.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                <ScopeIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{company ? 'Empresa' : 'Personal'}, {itemsLabel(library.itemCount ?? 0)}</span>
              </span>
            </span>
          </AccordionTrigger>
        </div>
        {library.canEdit ? (
          <div className="shrink-0 pr-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={locked} aria-label={`Acciones de ${library.name}`}><MoreVertical /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={onImportHere}><FolderUp />Importar archivos aquí</DropdownMenuItem>
                <DropdownMenuItem onSelect={onRename}><Pencil />Renombrar</DropdownMenuItem>
                {!company && canManage ? <DropdownMenuItem onSelect={() => onChangeScope('COMPANY')}><Building2 />Compartir con la empresa</DropdownMenuItem> : null}
                {company ? <DropdownMenuItem onSelect={() => onChangeScope('PERSONAL')}><User />Hacer personal</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 />Eliminar biblioteca</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <AccordionContent>
        <div className="px-2 pb-2">
          <LibraryItemsGrid
            library={library} items={items} imageUrls={imageUrls} loading={itemsQuery?.isLoading} error={itemsQuery?.isError}
            locked={locked} onInsert={onInsert} onItemAction={onItemAction}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

// Empty state doubles as a drop zone: click to pick files, or drop them.
function LibraryEmpty({ canCreate, importing, onPick, onCreate, onHelp }) {
  return (
    <EmptyState
      icon={LibraryIcon}
      title="Todavía no tienes bibliotecas"
      description="Importa iconos o bibliotecas de Excalidraw y luego insértalos en el Board con un clic."
    >
      {canCreate ? (
        <div className="mt-2 w-full space-y-2">
          <button
            type="button" onClick={onPick} disabled={importing}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-center transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
          >
            {importing ? <Loader2 className="size-5 animate-spin text-[hsl(var(--primary))] motion-reduce:animate-none" /> : <FolderUp className="size-5 text-[hsl(var(--primary))]" />}
            <span className="text-sm font-medium">{importing ? 'Importando…' : 'Suelta archivos o elige desde tu equipo'}</span>
            <span className="flex flex-wrap justify-center gap-1">{IMPORT_CHIPS.map((format) => <FormatChip key={format} format={format} />)}</span>
          </button>
          <div className="flex justify-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={onCreate}><Plus />Biblioteca vacía</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onHelp}><CircleHelp />Qué puedo importar</Button>
          </div>
        </div>
      ) : null}
    </EmptyState>
  )
}

// `docked` renders just the content for a column beside the board (desktop;
// BoardEditor's DesktopPanel supplies width and the slide animation) so the
// board stays usable; otherwise it is a Sheet (tablet/phone).
export function LibraryPanel({ open, onOpenChange, onInsert, docked = false }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const canManage = Boolean(userProfile?.isAdmin || userProfile?.permissions?.includes('canvas.manage'))
  const canCreate = Boolean(userProfile?.isAdmin || userProfile?.permissions?.includes('canvas.create'))

  const libraries = useLibraries()
  const rows = libraries.data ?? []
  const { create, update, remove } = useLibraryMutations()
  const { importFiles, importing } = useLibraryImport()
  const fileInputRef = useRef(null)
  const importTargetRef = useRef(null)

  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [openIds, setOpenIds] = useState([])
  const [fileDrag, setFileDrag] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formTarget, setFormTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [itemAction, setItemAction] = useState(null)

  const itemsQueries = useQueries({
    queries: rows.map((library) => ({
      queryKey: libraryItemsKey(library.id),
      queryFn: async () => (await runly.canvas.listLibraryItems(library.id, token))?.data ?? [],
      enabled: open && Boolean(token),
    })),
  })
  const itemsByLibrary = useMemo(() => {
    const map = new Map()
    rows.forEach((library, index) => map.set(library.id, itemsQueries[index]))
    return map
  }, [rows, itemsQueries])

  const imageUrlQueries = useQueries({
    queries: rows.map((library) => {
      const ids = [...new Set((itemsByLibrary.get(library.id)?.data ?? []).filter((item) => item.kind === 'image' && item.fileAssetId).map((item) => item.fileAssetId))].sort()
      return {
        queryKey: ['canvas', 'library-image-urls', library.id, ids],
        queryFn: async () => (await runly.files.batchSignedUrls(ids, token))?.data ?? {},
        enabled: open && Boolean(token) && ids.length > 0,
        staleTime: 30 * 60_000,
      }
    }),
  })
  const imageUrlsByLibrary = useMemo(() => {
    const map = new Map()
    rows.forEach((library, index) => map.set(library.id, imageUrlQueries[index]?.data ?? {}))
    return map
  }, [rows, imageUrlQueries])

  const query = search.trim().toLowerCase()
  const matchesQuery = (item) => !query || item.name.toLowerCase().includes(query)
  const searching = query.length > 0
  const matchingIds = searching ? rows.filter((library) => (itemsByLibrary.get(library.id)?.data ?? []).some(matchesQuery)).map((library) => library.id) : null
  const visibleRows = searching ? rows.filter((library) => matchingIds.includes(library.id)) : rows

  function openFilePicker(targetLibraryId) {
    if (!canCreate || importing) return
    importTargetRef.current = targetLibraryId
    fileInputRef.current?.click()
  }
  async function runImport(files, targetLibraryId) {
    if (!files.length) return
    setView('list')
    await importFiles(files, targetLibraryId)
  }
  const openCreate = () => { setFormTarget(null); setFormOpen(true) }

  function saveForm(data) {
    const options = (message) => ({ onSuccess: () => { toast.success(message); setFormOpen(false) }, onError: (error) => toast.error(error.message) })
    if (formTarget) update.mutate({ libraryId: formTarget.id, data: { name: data.name } }, options('Biblioteca renombrada'))
    else create.mutate(data, options('Biblioteca creada'))
  }
  function changeScope(library, scope) {
    update.mutate({ libraryId: library.id, data: { scope } }, {
      onSuccess: () => toast.success(scope === 'COMPANY' ? `«${library.name}» ahora la ve toda la empresa` : `«${library.name}» ahora es personal`),
      onError: (error) => toast.error(error.message),
    })
  }

  const { renameItem, removeItem } = useLibraryItemMutations(itemAction?.libraryId ?? null)
  const deleteItemTarget = itemAction?.kind === 'delete' ? itemAction : null

  // Files dragged from the desktop onto the panel import into a new library.
  // Library tiles use their own drag type, so they never trigger this.
  const dropHandlers = canCreate ? {
    onDragOver: (event) => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (!fileDrag) setFileDrag(true) },
    onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFileDrag(false) },
    onDrop: (event) => {
      if (!hasFiles(event)) return
      event.preventDefault(); setFileDrag(false)
      if (!importing) runImport(Array.from(event.dataTransfer.files ?? []), null)
    },
  } : {}

  const closeButton = docked ? (
    <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Cerrar biblioteca" onClick={() => onOpenChange(false)}><X /></Button>
  ) : null

  const listHeader = (
    <div className="space-y-3">
      <div className={cn('flex items-center gap-1', !docked && 'pr-8')}>
        <h2 className="flex-1 text-base font-semibold">Biblioteca</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Qué puedo importar" onClick={() => setView('help')}><CircleHelp /></Button>
          </TooltipTrigger>
          <TooltipContent>Qué puedo importar</TooltipContent>
        </Tooltip>
        {closeButton}
      </div>
      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar elemento…" className="min-w-0 flex-1" aria-label="Buscar elemento" />
        {canCreate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-10 shrink-0 gap-1.5 px-3 sm:h-9" disabled={importing}>
                {importing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
                {importing ? 'Importando' : 'Agregar'}
                {importing ? null : <ChevronDown className="size-3.5 opacity-60" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => openFilePicker(null)}><FolderUp />Importar archivos…</DropdownMenuItem>
              <DropdownMenuItem onSelect={openCreate}><Plus />Nueva biblioteca vacía</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
  const helpHeader = (
    <div className={cn('flex items-center gap-1', !docked && 'pr-8')}>
      <div className="min-w-0 flex-1"><LibraryHelpHeader onBack={() => setView('list')} /></div>
      {closeButton}
    </div>
  )

  const listBody = (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {libraries.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[1, 2, 3].map((key) => (
            <div key={key} className="space-y-1.5 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5">
              <Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : libraries.isError ? (
        <ErrorState title="No se pudieron cargar las bibliotecas" description={libraries.error?.message} onRetry={() => libraries.refetch()} />
      ) : !rows.length ? (
        <LibraryEmpty canCreate={canCreate} importing={importing} onPick={() => openFilePicker(null)} onCreate={openCreate} onHelp={() => setView('help')} />
      ) : searching && !visibleRows.length ? (
        <EmptyState icon={SearchX} title="Sin resultados" description={`Ningún elemento se llama «${search.trim()}».`} />
      ) : (
        <Accordion type="multiple" value={searching ? matchingIds : openIds} onValueChange={(value) => { if (!searching) setOpenIds(value) }} className="space-y-2">
          {visibleRows.map((library) => (
            <LibraryRow
              key={library.id} library={library} itemsQuery={itemsByLibrary.get(library.id)}
              items={(itemsByLibrary.get(library.id)?.data ?? []).filter(matchesQuery)} imageUrls={imageUrlsByLibrary.get(library.id) ?? {}}
              canManage={canManage} locked={importing} onInsert={onInsert}
              onImportHere={() => openFilePicker(library.id)}
              onRename={() => { setFormTarget(library); setFormOpen(true) }}
              onChangeScope={(scope) => changeScope(library, scope)}
              onDelete={() => setDeleteTarget(library)}
              onItemAction={(kind, libraryId, item) => setItemAction({ kind, libraryId, item })}
            />
          ))}
        </Accordion>
      )}
    </div>
  )

  const body = view === 'help'
    ? <LibraryHelpView canImport={canCreate} onImport={() => openFilePicker(null)} />
    : listBody

  // Indeterminate bar under the header while an import runs.
  const progress = importing ? (
    <div role="status" aria-label="Importando archivos" className="h-0.5 shrink-0 animate-pulse bg-[hsl(var(--primary))] motion-reduce:animate-none" />
  ) : <div className="h-0.5 shrink-0" aria-hidden />

  const dropOverlay = fileDrag ? (
    <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[hsl(var(--primary))] bg-[hsl(var(--card)/0.92)] p-4 text-center">
      <FolderUp className="size-6 text-[hsl(var(--primary))]" />
      <p className="text-sm font-semibold">Suelta para importar</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Se creará una biblioteca nueva con el nombre del archivo.</p>
      <span className="flex flex-wrap justify-center gap-1">{IMPORT_CHIPS.map((format) => <FormatChip key={format} format={format} />)}</span>
    </div>
  ) : null

  const fileInput = (
    <input
      ref={fileInputRef} type="file" accept={LIBRARY_IMPORT_ACCEPT} multiple className="hidden"
      onChange={(event) => {
        // Copy before resetting value: the FileList is live and clearing
        // the input empties it.
        const files = Array.from(event.target.files ?? [])
        const targetLibraryId = importTargetRef.current
        event.target.value = ''
        runImport(files, targetLibraryId)
      }}
    />
  )

  return (
    <>
      {docked ? (
        <div className="@container relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" {...dropHandlers}>
          <div className="shrink-0 px-4 pb-3 pt-3">{view === 'help' ? helpHeader : listHeader}</div>
          {progress}
          <div className="h-px shrink-0 bg-[hsl(var(--border))]" />
          {body}
          {dropOverlay}
          {fileInput}
        </div>
      ) : (
        <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setView('list') }}>
          <SheetContent side="right" className="@container relative gap-0 p-0" {...dropHandlers}>
            <SheetHeader className="shrink-0 space-y-0 px-4 pb-3 pt-3">
              <SheetTitle className="sr-only">Biblioteca</SheetTitle>
              <SheetDescription className="sr-only">Elementos reutilizables para insertar en el Board.</SheetDescription>
              {view === 'help' ? helpHeader : listHeader}
            </SheetHeader>
            {progress}
            <div className="h-px shrink-0 bg-[hsl(var(--border))]" />
            {body}
            {dropOverlay}
            {fileInput}
          </SheetContent>
        </Sheet>
      )}

      <LibraryFormDialog
        open={formOpen} onOpenChange={setFormOpen} library={formTarget} canManage={canManage}
        onSubmit={saveForm} pending={formTarget ? update.isPending : create.isPending}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(null) }}
        title={`Eliminar «${deleteTarget?.name ?? ''}»`}
        description={`Se eliminarán sus ${itemsLabel(deleteTarget?.itemCount ?? 0)}. Lo que ya insertaste en tus Boards se queda. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar biblioteca" loading={remove.isPending}
        onConfirm={async () => {
          try { await remove.mutateAsync(deleteTarget.id); toast.success('Biblioteca eliminada'); setDeleteTarget(null) }
          catch (error) { toast.error(error.message) }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteItemTarget)} onOpenChange={(next) => { if (!next) setItemAction(null) }}
        title={`Eliminar «${deleteItemTarget?.item?.name ?? ''}»`}
        description="Se quita de la biblioteca. Lo que ya insertaste en tus Boards se queda."
        confirmLabel="Eliminar elemento" loading={removeItem.isPending}
        onConfirm={async () => {
          try { await removeItem.mutateAsync(deleteItemTarget.item.id); toast.success('Elemento eliminado'); setItemAction(null) }
          catch (error) { toast.error(error.message) }
        }}
      />
      <RenameItemDialog
        item={itemAction?.kind === 'rename' ? itemAction.item : null} pending={renameItem.isPending}
        onOpenChange={(next) => { if (!next) setItemAction(null) }}
        onSubmit={(name) => renameItem.mutate({ itemId: itemAction.item.id, name }, {
          onSuccess: () => { toast.success('Elemento renombrado'); setItemAction(null) },
          onError: (error) => toast.error(error.message),
        })}
      />
    </>
  )
}
