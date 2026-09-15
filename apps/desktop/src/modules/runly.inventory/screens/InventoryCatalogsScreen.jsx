import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  PageHeader,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  TextField,
  TextareaField,
  SelectField,
  EmptyState,
  LoadingState,
  ConfirmDialog,
  SortableList,
} from '@runly/ui'
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInventoryCategories,
  useCreateInventoryCategory,
  useUpdateInventoryCategory,
  useDeleteInventoryCategory,
  useReorderInventoryCategories,
  useInventoryBrands,
  useCreateInventoryBrand,
  useUpdateInventoryBrand,
  useDeleteInventoryBrand,
  useReorderInventoryBrands,
  useInventoryLocations,
  useCreateInventoryLocation,
  useUpdateInventoryLocation,
  useDeleteInventoryLocation,
  useReorderInventoryLocations,
  useInventoryCustomFields,
  useCreateInventoryCustomField,
  useUpdateInventoryCustomField,
  useDeleteInventoryCustomField,
  useReorderInventoryCustomFields,
} from '../hooks/useInventoryCatalogs.js'

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableRow({ item, onEdit, onDelete, dragHandleProps, isDragging }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <>
      <div
        className={[
          'flex items-center gap-2 px-3 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg group',
          isDragging ? 'opacity-50 shadow-lg' : '',
        ].join(' ')}
      >
        <button
          {...dragHandleProps}
          type="button"
          className="cursor-grab text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] touch-none shrink-0"
          aria-label="Arrastrar para reordenar"
        >
          <GripVertical size={14} />
        </button>
        <span className="flex-1 text-sm font-medium text-[hsl(var(--foreground))] truncate">
          {item.name ?? item.label}
        </span>
        <span className="text-xs text-[hsl(var(--muted-foreground))] hidden sm:block truncate max-w-48">
          {item.description ?? item.fieldKey ?? ''}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--destructive))]"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Eliminar "${item.name ?? item.label}"`}
        description="Esta accion deshabilitara el registro. Los items asociados no se veran afectados."
        confirmLabel="Eliminar"
        onConfirm={() => { onDelete(item.id); setDeleteOpen(false) }}
      />
    </>
  )
}

// ── Generic sortable section ──────────────────────────────────────────────────

function SortableCatalogSection({ rows, onEdit, onDelete, onReorder, isLoading, emptyMsg, onCreate }) {
  const [localOrder, setLocalOrder] = useState(null)

  useEffect(() => {
    setLocalOrder(null)
  }, [rows])

  const items = localOrder ?? rows

  function handleReorder(newOrder) {
    setLocalOrder(newOrder)
    onReorder(newOrder)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Agregar
        </Button>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState title="Sin registros" description={emptyMsg} action={{ label: 'Agregar', onClick: onCreate }} />
      ) : (
        <div className="space-y-1.5">
          <SortableList
            items={items}
            onReorder={handleReorder}
            renderItem={(item, { dragHandleProps, isDragging }) => (
              <SortableRow
                item={item}
                dragHandleProps={dragHandleProps}
                isDragging={isDragging}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )}
          />
        </div>
      )}
    </div>
  )
}

// ── Simple edit sheet ─────────────────────────────────────────────────────────

function SimpleSheet({ open, onOpenChange, title, fields, values, onChange, onSave, busy, saveDisabled }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="py-6 space-y-4">
          {fields.map(f => f.type === 'textarea' ? (
            <TextareaField
              key={f.key}
              label={f.label}
              value={values[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              rows={3}
            />
          ) : (
            <TextField
              key={f.key}
              label={f.label}
              value={values[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              required={f.required}
            />
          ))}
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={busy || saveDisabled}>
            {busy ? 'Guardando...' : 'Guardar'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Category tab ──────────────────────────────────────────────────────────────

function CategoriesTab() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', color: '#7c3aed' })

  const { data, isLoading } = useInventoryCategories()
  const rows = (data?.data ?? data ?? []).filter(c => c.enabled !== false)
  const createMutation = useCreateInventoryCategory()
  const updateMutation = useUpdateInventoryCategory()
  const deleteMutation = useDeleteInventoryCategory()
  const reorderMutation = useReorderInventoryCategories()

  function openCreate() {
    setEditing(null)
    setForm({ name: '', description: '', color: '#7c3aed' })
    setSheetOpen(true)
  }

  function openEdit(item) {
    setEditing(item)
    setForm({ name: item.name, description: item.description ?? '', color: item.color ?? '#7c3aed' })
    setSheetOpen(true)
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...form })
        toast.success('Categoria actualizada')
      } else {
        await createMutation.mutateAsync(form)
        toast.success('Categoria creada')
      }
      setSheetOpen(false)
    } catch (err) {
      toast.error(err?.message ?? 'Error al guardar')
    }
  }

  function handleReorder(newOrder) {
    reorderMutation.mutate(newOrder.map((item, idx) => ({ id: item.id, sortOrder: idx * 10 })))
  }

  const busy = createMutation.isPending || updateMutation.isPending

  return (
    <>
      <SortableCatalogSection
        rows={rows}
        onEdit={openEdit}
        onDelete={id => deleteMutation.mutateAsync(id).then(() => toast.success('Eliminado'))}
        onReorder={handleReorder}
        isLoading={isLoading}
        emptyMsg="Crea tu primera categoria de activos"
        onCreate={openCreate}
      />
      <SimpleSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? 'Editar categoria' : 'Nueva categoria'}
        fields={[
          { key: 'name', label: 'Nombre', placeholder: 'Tecnologia', required: true },
          { key: 'description', label: 'Descripcion', placeholder: 'Equipos electronicos...', type: 'textarea' },
          { key: 'color', label: 'Color (hex)', placeholder: '#7c3aed' },
        ]}
        values={form}
        onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))}
        onSave={handleSave}
        busy={busy}
        saveDisabled={!form.name?.trim()}
      />
    </>
  )
}

// ── Brand tab ─────────────────────────────────────────────────────────────────

function BrandsTab() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })

  const { data, isLoading } = useInventoryBrands()
  const rows = (data?.data ?? data ?? []).filter(b => b.enabled !== false)
  const createMutation = useCreateInventoryBrand()
  const updateMutation = useUpdateInventoryBrand()
  const deleteMutation = useDeleteInventoryBrand()
  const reorderMutation = useReorderInventoryBrands()

  function openCreate() { setEditing(null); setForm({ name: '', description: '' }); setSheetOpen(true) }
  function openEdit(item) { setEditing(item); setForm({ name: item.name, description: item.description ?? '' }); setSheetOpen(true) }

  async function handleSave() {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...form })
        toast.success('Marca actualizada')
      } else {
        await createMutation.mutateAsync(form)
        toast.success('Marca creada')
      }
      setSheetOpen(false)
    } catch (err) { toast.error(err?.message ?? 'Error al guardar') }
  }

  function handleReorder(newOrder) {
    reorderMutation.mutate(newOrder.map((item, idx) => ({ id: item.id, sortOrder: idx * 10 })))
  }

  return (
    <>
      <SortableCatalogSection
        rows={rows}
        onEdit={openEdit}
        onDelete={id => deleteMutation.mutateAsync(id).then(() => toast.success('Eliminado'))}
        onReorder={handleReorder}
        isLoading={isLoading}
        emptyMsg="Crea tu primera marca"
        onCreate={openCreate}
      />
      <SimpleSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? 'Editar marca' : 'Nueva marca'}
        fields={[
          { key: 'name', label: 'Nombre', placeholder: 'Dell', required: true },
          { key: 'description', label: 'Descripcion', placeholder: 'Fabricante de equipos...', type: 'textarea' },
        ]}
        values={form}
        onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))}
        onSave={handleSave}
        busy={createMutation.isPending || updateMutation.isPending}
        saveDisabled={!form.name?.trim()}
      />
    </>
  )
}

// ── Location tab ──────────────────────────────────────────────────────────────

function LocationsTab() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', address: '' })

  const { data, isLoading } = useInventoryLocations()
  const rows = (data?.data ?? data ?? []).filter(l => l.enabled !== false)
  const createMutation = useCreateInventoryLocation()
  const updateMutation = useUpdateInventoryLocation()
  const deleteMutation = useDeleteInventoryLocation()
  const reorderMutation = useReorderInventoryLocations()

  function openCreate() { setEditing(null); setForm({ name: '', description: '', address: '' }); setSheetOpen(true) }
  function openEdit(item) { setEditing(item); setForm({ name: item.name, description: item.description ?? '', address: item.address ?? '' }); setSheetOpen(true) }

  async function handleSave() {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...form })
        toast.success('Ubicacion actualizada')
      } else {
        await createMutation.mutateAsync(form)
        toast.success('Ubicacion creada')
      }
      setSheetOpen(false)
    } catch (err) { toast.error(err?.message ?? 'Error al guardar') }
  }

  function handleReorder(newOrder) {
    reorderMutation.mutate(newOrder.map((item, idx) => ({ id: item.id, sortOrder: idx * 10 })))
  }

  return (
    <>
      <SortableCatalogSection
        rows={rows}
        onEdit={openEdit}
        onDelete={id => deleteMutation.mutateAsync(id).then(() => toast.success('Eliminado'))}
        onReorder={handleReorder}
        isLoading={isLoading}
        emptyMsg="Crea tu primera ubicacion"
        onCreate={openCreate}
      />
      <SimpleSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? 'Editar ubicacion' : 'Nueva ubicacion'}
        fields={[
          { key: 'name', label: 'Nombre', placeholder: 'Oficina principal', required: true },
          { key: 'description', label: 'Descripcion', placeholder: 'Planta 3, area de TI...', type: 'textarea' },
          { key: 'address', label: 'Direccion', placeholder: 'Av. Lima 123...' },
        ]}
        values={form}
        onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))}
        onSave={handleSave}
        busy={createMutation.isPending || updateMutation.isPending}
        saveDisabled={!form.name?.trim()}
      />
    </>
  )
}

// ── Custom fields tab ─────────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'number', label: 'Numero' },
  { value: 'date', label: 'Fecha' },
  { value: 'boolean', label: 'Si/No' },
  { value: 'select', label: 'Lista de opciones' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
]

function CustomFieldsTab() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ label: '', fieldKey: '', fieldType: 'text' })
  const [localOrder, setLocalOrder] = useState(null)

  const { data, isLoading } = useInventoryCustomFields()
  const rows = (data?.data ?? data ?? []).filter(f => f.enabled !== false)
  const createMutation = useCreateInventoryCustomField()
  const updateMutation = useUpdateInventoryCustomField()
  const deleteMutation = useDeleteInventoryCustomField()
  const reorderMutation = useReorderInventoryCustomFields()

  useEffect(() => { setLocalOrder(null) }, [rows])

  const displayRows = (localOrder ?? rows).map(r => ({
    ...r,
    id: r.id,
    name: r.label,
    description: r.fieldKey,
  }))

  function openCreate() { setEditing(null); setForm({ label: '', fieldKey: '', fieldType: 'text' }); setSheetOpen(true) }
  function openEdit(displayItem) {
    const original = rows.find(r => r.id === displayItem.id)
    setEditing(original)
    setForm({ label: original.label, fieldKey: original.fieldKey, fieldType: original.fieldType })
    setSheetOpen(true)
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...form })
        toast.success('Campo actualizado')
      } else {
        await createMutation.mutateAsync(form)
        toast.success('Campo creado')
      }
      setSheetOpen(false)
    } catch (err) { toast.error(err?.message ?? 'Error al guardar') }
  }

  function handleReorder(newOrder) {
    setLocalOrder(newOrder.map(d => rows.find(r => r.id === d.id)))
    reorderMutation.mutate(newOrder.map((item, idx) => ({ id: item.id, sortOrder: idx * 10 })))
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nuevo campo
          </Button>
        </div>
        {isLoading ? <LoadingState /> : displayRows.length === 0 ? (
          <EmptyState title="Sin campos" description="Crea campos personalizados para tus categorias" action={{ label: 'Nuevo campo', onClick: openCreate }} />
        ) : (
          <div className="space-y-1.5">
            <SortableList
              items={displayRows}
              onReorder={handleReorder}
              renderItem={(item, { dragHandleProps, isDragging }) => (
                <SortableRow
                  item={item}
                  dragHandleProps={dragHandleProps}
                  isDragging={isDragging}
                  onEdit={openEdit}
                  onDelete={id => deleteMutation.mutateAsync(id).then(() => toast.success('Eliminado'))}
                />
              )}
            />
          </div>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? 'Editar campo' : 'Nuevo campo personalizado'}</SheetTitle>
          </SheetHeader>
          <div className="py-6 space-y-4">
            <TextField
              label="Etiqueta"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="Numero de serie externo"
              required
            />
            <TextField
              label="Clave (fieldKey)"
              value={form.fieldKey}
              onChange={e => setForm(f => ({ ...f, fieldKey: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
              placeholder="serial_ext"
              hint="Solo letras, numeros y guiones bajos"
              disabled={Boolean(editing)}
            />
            <SelectField
              label="Tipo de campo"
              value={form.fieldType}
              onChange={v => setForm(f => ({ ...f, fieldType: v }))}
              options={FIELD_TYPES}
            />
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={createMutation.isPending || updateMutation.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.label.trim() || !form.fieldKey.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

const VALID_TABS = new Set(['categories', 'brands', 'locations', 'custom-fields'])

export default function InventoryCatalogsScreen() {
  const [searchParams] = useSearchParams()
  const initialTab = useMemo(() => {
    const requested = searchParams.get('tab')
    return VALID_TABS.has(requested) ? requested : 'categories'
  }, [searchParams])

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Inventario"
        title="Catalogos"
        description="Administra categorias, marcas, ubicaciones y campos personalizados. Arrastra para reordenar."
      />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
          <TabsTrigger value="brands">Marcas</TabsTrigger>
          <TabsTrigger value="locations">Ubicaciones</TabsTrigger>
          <TabsTrigger value="custom-fields">Campos personalizados</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="brands" className="mt-4">
          <BrandsTab />
        </TabsContent>
        <TabsContent value="locations" className="mt-4">
          <LocationsTab />
        </TabsContent>
        <TabsContent value="custom-fields" className="mt-4">
          <CustomFieldsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
