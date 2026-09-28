import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Columns2, X } from 'lucide-react'
import {
  BulkActionBar,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  LoadingState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@runly/ui'
import { toast } from 'sonner'
import { GROUP_BY_OPTIONS, ITEM_STATUSES } from '../lib/inventory-constants.js'
import { buildGroups } from '../lib/inventory-grouping.js'
import { InventoryStatusBadge } from './InventoryStatusBadge.jsx'
import { useUpdateInventoryItem } from '../hooks/useInventoryItems.js'

const ALL = '__all__'

// ── Column config ─────────────────────────────────────────────────────────────

const TREE_COLUMNS = [
  { key: 'assetTag',       label: 'Tag',         defaultVisible: true },
  { key: 'brandName',      label: 'Marca',        defaultVisible: true },
  { key: 'status',         label: 'Estado',       defaultVisible: true },
  { key: 'locationName',   label: 'Ubicacion',    defaultVisible: false },
  { key: 'assignedToName', label: 'Responsable',  defaultVisible: true },
]

const DEFAULT_VISIBLE = new Set(
  TREE_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)
)

const BULK_COLUMNS = [
  { field: 'assetTag',       label: 'Tag' },
  { field: 'name',           label: 'Nombre' },
  { field: 'categoryName',   label: 'Tipo' },
  { field: 'brandName',      label: 'Marca' },
  { field: 'status',         label: 'Estado', type: 'select', options: ITEM_STATUSES.map(s => ({ value: s.value, label: s.label })) },
  { field: 'locationName',   label: 'Ubicacion' },
  { field: 'assignedToName', label: 'Responsable' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isWarrantyExpiringSoon(dateStr) {
  if (!dateStr) return false
  const expiry = new Date(dateStr)
  const now = new Date()
  const diffDays = (expiry - now) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 30
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GroupHeader({ group, isExpanded, onToggle, allGroupSelected, onToggleGroupSelect }) {
  return (
    <div className="flex items-center">
      <div className="flex items-center px-3 py-2.5" onClick={e => e.stopPropagation()}>
        <Checkbox checked={allGroupSelected} onCheckedChange={onToggleGroupSelect} />
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-3 py-2.5 pr-4 text-left hover:bg-[hsl(var(--muted)/0.5)] transition-colors"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.groupColor }} />
        <span className="flex-1 text-sm font-medium text-[hsl(var(--foreground))]">{group.groupLabel}</span>
        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
          {group.items.length}
        </span>
        {isExpanded
          ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          : <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        }
      </button>
    </div>
  )
}

function TreeView({ groups, collapsedGroups, onToggleGroup, onItemClick, visibleCols, selectedIds, onToggleSelect, onToggleGroupSelect }) {
  return (
    <div className="divide-y divide-[hsl(var(--border))] rounded-lg border border-[hsl(var(--border))]">
      {groups.map(group => {
        const isExpanded = !collapsedGroups.has(group.groupKey)
        const allGroupSelected = group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))
        return (
          <div key={group.groupKey}>
            <GroupHeader
              group={group}
              isExpanded={isExpanded}
              onToggle={() => onToggleGroup(group.groupKey)}
              allGroupSelected={allGroupSelected}
              onToggleGroupSelect={() => onToggleGroupSelect(group.items, !allGroupSelected)}
            />
            {isExpanded && (
              <div className="bg-[hsl(var(--muted)/0.2)]">
                {group.items.length === 0 ? (
                  <p className="px-6 py-3 text-sm text-[hsl(var(--muted-foreground))]">Sin items en este grupo</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
                        <th className="w-8 px-2 py-2" />
                        <th className="px-6 py-2 text-left font-medium">Nombre</th>
                        {visibleCols.has('assetTag') && (
                          <th className="px-4 py-2 text-left font-medium">Tag</th>
                        )}
                        {visibleCols.has('brandName') && (
                          <th className="px-4 py-2 text-left font-medium">Marca</th>
                        )}
                        {visibleCols.has('status') && (
                          <th className="px-4 py-2 text-left font-medium">Estado</th>
                        )}
                        {visibleCols.has('locationName') && (
                          <th className="px-4 py-2 text-left font-medium">Ubicacion</th>
                        )}
                        {visibleCols.has('assignedToName') && (
                          <th className="px-4 py-2 text-left font-medium">Responsable</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(item => {
                        const warrantySoon = isWarrantyExpiringSoon(item.warrantyExpiry)
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.5)] transition-colors"
                          >
                            <td className="w-8 px-2 py-2">
                              <Checkbox
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={() => onToggleSelect(item.id)}
                                onClick={e => e.stopPropagation()}
                              />
                            </td>
                            <td
                              className="px-6 py-2 font-medium cursor-pointer"
                              onClick={() => onItemClick(item)}
                            >
                              <span className="flex items-center gap-2">
                                {item.name}
                                {warrantySoon && (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" title="Garantia vence pronto" />
                                )}
                              </span>
                            </td>
                            {visibleCols.has('assetTag') && (
                              <td className="px-4 py-2 font-mono text-xs text-[hsl(var(--muted-foreground))] cursor-pointer" onClick={() => onItemClick(item)}>{item.assetTag ?? '—'}</td>
                            )}
                            {visibleCols.has('brandName') && (
                              <td className="px-4 py-2 text-[hsl(var(--muted-foreground))] cursor-pointer" onClick={() => onItemClick(item)}>{item.brandName ?? '—'}</td>
                            )}
                            {visibleCols.has('status') && (
                              <td className="px-4 py-2 cursor-pointer" onClick={() => onItemClick(item)}><InventoryStatusBadge status={item.status} /></td>
                            )}
                            {visibleCols.has('locationName') && (
                              <td className="px-4 py-2 text-[hsl(var(--muted-foreground))] cursor-pointer" onClick={() => onItemClick(item)}>{item.locationName ?? '—'}</td>
                            )}
                            {visibleCols.has('assignedToName') && (
                              <td className="px-4 py-2 text-[hsl(var(--muted-foreground))] cursor-pointer" onClick={() => onItemClick(item)}>{item.assignedToName ?? '—'}</td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CardsView({ items, onItemClick, selectedIds, onToggleSelect }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map(item => {
        const warrantySoon = isWarrantyExpiringSoon(item.warrantyExpiry)
        const isSelected = selectedIds.has(item.id)
        return (
          <div
            key={item.id}
            className={`relative flex flex-col gap-2 rounded-lg border bg-[hsl(var(--card))] p-4 transition-all ${
              isSelected
                ? 'border-[hsl(var(--ring))] ring-1 ring-[hsl(var(--ring))]'
                : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:shadow-sm'
            }`}
          >
            <div className="absolute top-2 right-2" onClick={e => e.stopPropagation()}>
              <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(item.id)} />
            </div>
            <button
              type="button"
              onClick={() => onItemClick(item)}
              className="flex flex-col gap-2 text-left"
            >
              <div className="flex items-start gap-2 pr-5">
                <span className="font-medium text-sm text-[hsl(var(--foreground))] leading-snug line-clamp-2 flex-1">{item.name}</span>
                <InventoryStatusBadge status={item.status} />
              </div>
              <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{item.assetTag ?? '—'}</span>
              {item.categoryName && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{item.categoryName}</span>
              )}
              {item.assignedToName && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{item.assignedToName}</span>
              )}
              {warrantySoon && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <AlertTriangle className="h-3 w-3" />
                  Garantia vence pronto
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Bulk status dialog ────────────────────────────────────────────────────────

function BulkStatusDialog({ open, onOpenChange, onConfirm, isPending }) {
  const [newStatus, setNewStatus] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar estado en masa</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Select value={newStatus || ALL} onValueChange={v => setNewStatus(v === ALL ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un estado..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Selecciona un estado...</SelectItem>
              {ITEM_STATUSES.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => { if (newStatus) onConfirm(newStatus) }}
            disabled={!newStatus || isPending}
          >
            {isPending ? 'Aplicando...' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function InventoryGroupedView({
  items = [],
  categories = [],
  brands = [],
  locations = [],
  groupBy = 'category',
  onGroupByChange,
  viewMode = 'tree',
  search = '',
  onSearchChange,
  onItemClick,
  onCreateItem,
  isLoading = false,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryIdFilter, setCategoryIdFilter] = useState('')
  const [brandIdFilter, setBrandIdFilter] = useState('')
  const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)

  const updateItem = useUpdateInventoryItem()

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleCol(key) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function clearFilters() {
    setStatusFilter('')
    setCategoryIdFilter('')
    setBrandIdFilter('')
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleGroupSelect(groupItems, select) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const item of groupItems) {
        select ? next.add(item.id) : next.delete(item.id)
      }
      return next
    })
  }

  async function handleBulkStatusChange(newStatus) {
    const targets = filteredItems.filter(i => selectedIds.has(i.id))
    try {
      await Promise.all(targets.map(item => updateItem.mutateAsync({ id: item.id, status: newStatus })))
      toast.success(`Estado actualizado para ${targets.length} items`)
      setSelectedIds(new Set())
      setBulkStatusOpen(false)
    } catch {
      toast.error('Error al actualizar algunos items')
    }
  }

  const activeFilterCount = [statusFilter, categoryIdFilter, brandIdFilter].filter(Boolean).length

  const filteredItems = items.filter(item => {
    if (statusFilter && item.status !== statusFilter) return false
    if (categoryIdFilter && item.categoryId !== categoryIdFilter) return false
    if (brandIdFilter && item.brandId !== brandIdFilter) return false
    return true
  })

  const selectedItems = filteredItems.filter(i => selectedIds.has(i.id))

  const groups = buildGroups(filteredItems, groupBy, categories, brands, locations)

  const categoryOptions = categories.filter(c => c.enabled !== false)
  const brandOptions = brands.filter(b => b.enabled !== false)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Buscar item..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="h-9"
          />
        </div>

        {/* Status filter */}
        <Select
          value={statusFilter || ALL}
          onValueChange={v => setStatusFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {ITEM_STATUSES.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category filter */}
        {categoryOptions.length > 0 && (
          <Select
            value={categoryIdFilter || ALL}
            onValueChange={v => setCategoryIdFilter(v === ALL ? '' : v)}
          >
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las categorias</SelectItem>
              {categoryOptions.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Brand filter */}
        {brandOptions.length > 0 && (
          <Select
            value={brandIdFilter || ALL}
            onValueChange={v => setBrandIdFilter(v === ALL ? '' : v)}
          >
            <SelectTrigger className="w-32 h-9">
              <SelectValue placeholder="Marca" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las marcas</SelectItem>
              {brandOptions.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Group-by */}
        <Select value={groupBy} onValueChange={onGroupByChange}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Agrupar por..." />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Column visibility — tree mode only */}
        {viewMode === 'tree' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Columns2 className="h-3.5 w-3.5" />
                Columnas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-xs">Columnas visibles</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {TREE_COLUMNS.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleCols.has(col.key)}
                  onCheckedChange={() => toggleCol(col.key)}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-[hsl(var(--muted-foreground))]"
            onClick={clearFilters}
          >
            <X className="h-3.5 w-3.5" />
            Limpiar ({activeFilterCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : filteredItems.length === 0 && activeFilterCount > 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Ningun item coincide con los filtros activos"
          action={{ label: 'Limpiar filtros', onClick: clearFilters }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin items"
          description="Agrega tu primer item de inventario"
          action={{ label: 'Nuevo item', onClick: onCreateItem }}
        />
      ) : viewMode === 'tree' ? (
        <TreeView
          groups={groups}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
          onItemClick={onItemClick}
          visibleCols={visibleCols}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleGroupSelect={toggleGroupSelect}
        />
      ) : (
        <CardsView
          items={filteredItems}
          onItemClick={onItemClick}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedRows={selectedItems}
        visibleColumns={BULK_COLUMNS}
        onClear={() => setSelectedIds(new Set())}
        bulkActions={[
          {
            label: 'Cambiar estado',
            onClick: () => setBulkStatusOpen(true),
          },
        ]}
      />

      {/* Bulk status change dialog */}
      <BulkStatusDialog
        open={bulkStatusOpen}
        onOpenChange={setBulkStatusOpen}
        onConfirm={handleBulkStatusChange}
        isPending={updateItem.isPending}
      />
    </div>
  )
}
