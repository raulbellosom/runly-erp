import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
  Button, TextField, SelectField, MarkdownField, ConfirmDialog,
  Popover, PopoverTrigger, PopoverContent,
} from '@runly/ui'
import { CalendarCheck, CalendarX, RefreshCw, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useCreateProject, useUpdateProject, useArchiveProject, useProject, useSyncProjectCalendar } from '../hooks/useProjectsData'
import { PROJECT_ICONS, getProjectIcon } from '../lib/projectIcons.js'

const TEMPLATE_OPTIONS = [
  { value: 'general',    label: 'General' },
  { value: 'desarrollo', label: 'Desarrollo' },
  { value: 'ventas',     label: 'Ventas' },
  { value: 'marketing',  label: 'Marketing' },
]

const PRESET_COLORS = [
  '#6366f1', '#2563eb', '#0ea5e9', '#0891b2',
  '#14b8a6', '#22c55e', '#84cc16', '#f59e0b',
  '#f97316', '#ef4444', '#ec4899', '#db2777',
  '#a855f7', '#7c3aed', '#64748b', '#1e293b',
]

export default function ProjectFormModal({ open, onOpenChange, project, onCreated, onArchived }) {
  const isEdit = Boolean(project)
  const createProject = useCreateProject()
  const updateProject = useUpdateProject(project?.id)
  const archiveProject = useArchiveProject()
  const { data: projectDetail } = useProject(isEdit && open ? project?.id : null)
  const syncCalendar = useSyncProjectCalendar(project?.id)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [icon, setIcon] = useState('FolderKanban')
  const [template, setTemplate] = useState('general')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const calendarLinked = projectDetail?.calendarLinked ?? (project?.calendarId != null)

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '')
      setDescription(project?.description ?? '')
      setColor(project?.color ?? '#6366f1')
      setIcon(project?.icon ?? 'FolderKanban')
      setTemplate('general')
    }
  }, [open, project])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    if (isEdit) {
      updateProject.mutate(
        { name: trimmed, description: description.trim() || null, color, icon },
        {
          onSuccess: () => {
            toast.success('Proyecto actualizado')
            onOpenChange(false)
          },
          onError: () => toast.error('No se pudo actualizar el proyecto'),
        },
      )
    } else {
      createProject.mutate(
        { name: trimmed, description: description.trim() || null, color, icon, template },
        {
          onSuccess: (data) => {
            toast.success('Proyecto creado')
            onOpenChange(false)
            onCreated?.(data?.data ?? data)
          },
          onError: () => toast.error('No se pudo crear el proyecto'),
        },
      )
    }
  }

  function handleArchive() {
    archiveProject.mutate(project.id, {
      onSuccess: () => {
        toast.success('Proyecto archivado')
        setArchiveOpen(false)
        onOpenChange(false)
        onArchived?.()
      },
      onError: () => toast.error('No se pudo archivar el proyecto'),
    })
  }

  const isPending = createProject.isPending || updateProject.isPending
  const SelectedIcon = getProjectIcon(icon)

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" scrollable>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? 'Editar los datos del proyecto' : 'Crear un nuevo proyecto'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto overscroll-contain space-y-5 pr-1 -mr-1">
          {/* Preview badge + Name */}
          <div className="flex items-end gap-3">
            <span
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
              style={{ background: color }}
            >
              <SelectedIcon size={22} className="text-white" />
            </span>
            <TextField
              label="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del proyecto"
              required
              autoFocus
              className="flex-1 h-12 text-base"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              Color
            </label>
            <div className="grid grid-cols-8 gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full transition-all focus-visible:outline-none"
                  style={{
                    backgroundColor: c,
                    border: color === c ? '2px solid white' : '2px solid transparent',
                    transform: color === c ? 'scale(1.18)' : 'scale(1)',
                    boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Icon picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              Icono
            </label>
            <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-foreground/30 transition-colors"
                >
                  <span
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: color + '22', color }}
                  >
                    <SelectedIcon size={15} />
                  </span>
                  <span className="flex-1 text-left text-muted-foreground">Cambiar icono</span>
                  <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-1.5">
                <div className="grid grid-cols-9 gap-1 max-h-52 overflow-y-auto">
                  {PROJECT_ICONS.map(({ name: iName, Icon: Ic }) => (
                    <button
                      key={iName}
                      type="button"
                      onClick={() => { setIcon(iName); setIconPickerOpen(false) }}
                      title={iName}
                      className="w-10 h-10 rounded-lg flex items-center justify-center transition-all focus-visible:outline-none"
                      style={
                        icon === iName
                          ? { backgroundColor: color + '22', color }
                          : {}
                      }
                    >
                      <Ic
                        size={17}
                        className={icon === iName ? '' : 'text-muted-foreground hover:text-foreground'}
                      />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <MarkdownField
            label="Descripcion"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripcion opcional..."
          />

          {!isEdit && (
            <SelectField
              label="Plantilla de columnas"
              value={template}
              onValueChange={setTemplate}
              options={TEMPLATE_OPTIONS}
            />
          )}

          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                {calendarLinked
                  ? <CalendarCheck size={15} className="text-green-500 shrink-0" />
                  : <CalendarX size={15} className="text-amber-500 shrink-0" />
                }
                <span className={calendarLinked ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}>
                  {calendarLinked ? 'Calendario vinculado' : 'Calendario desvinculado'}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={syncCalendar.isPending}
                onClick={() =>
                  syncCalendar.mutate(undefined, {
                    onSuccess: () => toast.success(calendarLinked ? 'Calendario sincronizado' : 'Calendario recreado'),
                    onError: () => toast.error('No se pudo sincronizar el calendario'),
                  })
                }
              >
                <RefreshCw size={12} className={syncCalendar.isPending ? 'animate-spin' : ''} />
                {calendarLinked ? 'Sincronizar' : 'Reconectar'}
              </Button>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => setArchiveOpen(true)}
              >
                Archivar
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending}>
              {isEdit ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={archiveOpen}
      onOpenChange={setArchiveOpen}
      title="Archivar proyecto"
      description={`El proyecto "${project?.name ?? ''}" se marcara como archivado. Podras restaurarlo desde la configuracion.`}
      confirmLabel="Archivar"
      onConfirm={handleArchive}
    />
    </>
  )
}
