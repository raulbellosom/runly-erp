import { useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  Badge, Button, ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  EmptyState, ErrorState, SearchInput, SelectField, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, TextField,
} from '@runly/ui'
import { Building2, FolderUp, Library as LibraryIcon, Loader2, MoreVertical, Pencil, Plus, Trash2, User } from 'lucide-react'
import { useAuth } from '../../../../auth/AuthProvider.jsx'
import { runly } from '../../../../lib/runly.js'
import { libraryItemsKey, useLibraries, useLibraryImport, useLibraryItemMutations, useLibraryMutations } from '../../hooks/useLibraries.js'
import { LIBRARY_IMPORT_ACCEPT } from '../../lib/libraryImport/formats.js'
import { LibraryItemTile } from './LibraryItemTile.jsx'

function LibraryFormDialog({ open, onOpenChange, library, canManage, onSubmit, pending }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState('PERSONAL')

  function handleOpenChange(next) {
    if (next) { setName(library?.name ?? ''); setScope(library?.scope ?? 'PERSONAL') }
    onOpenChange(next)
  }

  const valid = name.trim().length > 0
  function submit(event) {
    event.preventDefault()
    if (!valid) return
    onSubmit({ name: name.trim(), scope })
  }
  const scopeOptions = [{ value: 'PERSONAL', label: 'Personal' }, ...(canManage ? [{ value: 'COMPANY', label: 'Empresa' }] : [])]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader><DialogTitle>{library ? 'Renombrar biblioteca' : 'Nueva biblioteca'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <TextField label="Nombre" value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={200} placeholder="Ej. Redes y conectividad" />
            <SelectField label="Alcance" value={scope} onValueChange={setScope} options={scopeOptions} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || pending}>{pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LibraryItemsGrid({ library, items, imageUrls, loading, error, onInsert, onDeleteItem }) {
  if (loading) return <div className="grid grid-cols-3 gap-2 p-1 sm:grid-cols-4">{[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-28 rounded-xl" />)}</div>
  if (error) return <p className="px-1 py-2 text-sm text-destructive">No se pudieron cargar los elementos.</p>
  if (!items.length) return <p className="px-1 py-2 text-sm text-[hsl(var(--muted-foreground))]">Esta biblioteca no tiene elementos.</p>
  return (
    <div className="grid grid-cols-3 gap-2 p-1 sm:grid-cols-4">
      {items.map((item) => (
        <LibraryItemTile
          key={item.id} item={item} libraryId={library.id} imageUrl={item.fileAssetId ? imageUrls[item.fileAssetId] : null}
          canEdit={library.canEdit} onInsert={onInsert} onDelete={() => onDeleteItem(library.id, item)}
        />
      ))}
    </div>
  )
}

// Right-side panel (spec §8): "Nueva"/"Importar" in a fixed header, an
// accordion of personal + company libraries with a tile grid each. Items for
// every visible library are fetched up front (via useQueries, not gated by
// the accordion being open) so the header's search box can match across all
// of them at once.
export function LibraryPanel({ open, onOpenChange, onInsert }) {
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

  const [search, setSearch] = useState('')
  const [openIds, setOpenIds] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const [formTarget, setFormTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteItemTarget, setDeleteItemTarget] = useState(null)

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
  const accordionValue = searching
    ? rows.filter((library) => (itemsByLibrary.get(library.id)?.data ?? []).some(matchesQuery)).map((library) => library.id)
    : openIds

  function openFilePicker(targetLibraryId) {
    if (!canCreate) return
    importTargetRef.current = targetLibraryId
    fileInputRef.current?.click()
  }

  function saveForm(data) {
    if (formTarget) {
      update.mutate({ libraryId: formTarget.id, data }, {
        onSuccess: () => { toast.success('Biblioteca actualizada'); setFormOpen(false) },
        onError: (error) => toast.error(error.message),
      })
    } else {
      create.mutate(data, {
        onSuccess: () => { toast.success('Biblioteca creada'); setFormOpen(false) },
        onError: (error) => toast.error(error.message),
      })
    }
  }

  const { removeItem } = useLibraryItemMutations(deleteItemTarget?.libraryId ?? null)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="gap-0 p-0">
          <SheetHeader className="shrink-0 gap-2 border-b border-[hsl(var(--border))] px-4 py-3">
            <SheetTitle>Biblioteca</SheetTitle>
            <SheetDescription>Inserta elementos reutilizables en el Board, con clic o arrastrando.</SheetDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar elemento…" className="min-w-0 flex-1" />
              {canCreate ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setFormTarget(null); setFormOpen(true) }}><Plus />Nueva</Button>
                  <Button type="button" size="sm" variant="outline" disabled={importing} onClick={() => openFilePicker(null)}>
                    {importing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <FolderUp />}Importar
                  </Button>
                </>
              ) : null}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {libraries.isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((key) => <Skeleton key={key} className="h-12 rounded-xl" />)}</div>
            ) : libraries.isError ? (
              <ErrorState title="No se pudieron cargar las bibliotecas" description={libraries.error?.message} onRetry={() => libraries.refetch()} />
            ) : !rows.length ? (
              <EmptyState
                icon={LibraryIcon}
                title="Aún no tienes bibliotecas"
                description="Importa iconos o elementos para reutilizarlos en tus Boards."
                action={canCreate ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => openFilePicker(null)}>Importar</Button>
                    <Button size="sm" variant="outline" onClick={() => { setFormTarget(null); setFormOpen(true) }}>Nueva biblioteca</Button>
                  </div>
                ) : null}
              >
                <p className="max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                  Puedes descargar bibliotecas de libraries.excalidraw.com (revisa la licencia de cada una).
                </p>
              </EmptyState>
            ) : (
              <Accordion type="multiple" value={accordionValue} onValueChange={(value) => { if (!searching) setOpenIds(value) }} className="space-y-2">
                {rows.map((library) => {
                  const itemsQuery = itemsByLibrary.get(library.id)
                  const items = (itemsQuery?.data ?? []).filter(matchesQuery)
                  return (
                    <AccordionItem key={library.id} value={library.id}>
                      <AccordionTrigger>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <Badge variant={library.scope === 'COMPANY' ? 'secondary' : 'outline'} className="shrink-0">{library.scope === 'COMPANY' ? 'Empresa' : 'Personal'}</Badge>
                          <span className="min-w-0 flex-1 truncate text-left">{library.name}</span>
                          <span className="shrink-0 text-xs font-normal text-[hsl(var(--muted-foreground))]">{library.itemCount}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        {library.canEdit ? (
                          <div className="mb-2 flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="icon" variant="ghost" aria-label="Más acciones de la biblioteca"><MoreVertical /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => openFilePicker(library.id)}><FolderUp />Importar aquí</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => { setFormTarget(library); setFormOpen(true) }}><Pencil />Renombrar</DropdownMenuItem>
                                {library.scope === 'PERSONAL' && canManage ? (
                                  <DropdownMenuItem onSelect={() => update.mutate({ libraryId: library.id, data: { scope: 'COMPANY' } }, { onError: (error) => toast.error(error.message) })}>
                                    <Building2 />Cambiar a Empresa
                                  </DropdownMenuItem>
                                ) : null}
                                {library.scope === 'COMPANY' ? (
                                  <DropdownMenuItem onSelect={() => update.mutate({ libraryId: library.id, data: { scope: 'PERSONAL' } }, { onError: (error) => toast.error(error.message) })}>
                                    <User />Cambiar a Personal
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem onSelect={() => setDeleteTarget(library)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                                  <Trash2 />Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : null}
                        <LibraryItemsGrid
                          library={library} items={items} imageUrls={imageUrlsByLibrary.get(library.id) ?? {}}
                          loading={itemsQuery?.isLoading} error={itemsQuery?.isError}
                          onInsert={onInsert} onDeleteItem={(libraryId, item) => setDeleteItemTarget({ libraryId, item })}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
          </div>
          <input
            ref={fileInputRef} type="file" accept={LIBRARY_IMPORT_ACCEPT} multiple className="hidden"
            onChange={async (event) => {
              const files = event.target.files
              const targetLibraryId = importTargetRef.current
              event.target.value = ''
              if (files?.length) await importFiles(files, targetLibraryId)
            }}
          />
        </SheetContent>
      </Sheet>

      <LibraryFormDialog
        open={formOpen} onOpenChange={setFormOpen} library={formTarget} canManage={canManage}
        onSubmit={saveForm} pending={formTarget ? update.isPending : create.isPending}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(null) }}
        title={`Eliminar «${deleteTarget?.name ?? ''}»`}
        description="Se eliminarán todos sus elementos. Esta acción no se puede deshacer."
        confirmLabel="Eliminar" loading={remove.isPending}
        onConfirm={async () => {
          try { await remove.mutateAsync(deleteTarget.id); toast.success('Biblioteca eliminada'); setDeleteTarget(null) }
          catch (error) { toast.error(error.message) }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteItemTarget)} onOpenChange={(next) => { if (!next) setDeleteItemTarget(null) }}
        title={`Eliminar «${deleteItemTarget?.item?.name ?? ''}»`}
        confirmLabel="Eliminar" loading={removeItem.isPending}
        onConfirm={async () => {
          try { await removeItem.mutateAsync(deleteItemTarget.item.id); setDeleteItemTarget(null) }
          catch (error) { toast.error(error.message) }
        }}
      />
    </>
  )
}
