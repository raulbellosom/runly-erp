import { useState, useCallback } from 'react'
import { Copy, Check, NotebookPen, X, FileDown } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'
import { useNoteFolders, useCreateNoteFolder } from '../hooks/useNoteFolders.js'
import { useNoteTags, useCreateNoteTag, useSetNoteTags } from '../hooks/useNoteTags.js'
import { NOTE_BACKGROUND_COLORS } from '../lib/noteColors.js'
import { NOTE_PAPER_STYLES, paperStylePreviewBackground } from '../lib/paperStyles.js'
import { NoteIcon } from '../noteIcons.jsx'
import { NoteIconPickerContent } from './NoteIconPicker.jsx'
import {
  ConfirmDialog, TextField, CreatableComboboxField,
  Popover, PopoverTrigger, PopoverContent,
} from '@runly/ui'

function SectionLabel({ children }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
      {children}
    </label>
  )
}

export function NoteSettingsPanel({ note, onUpdate, onPublish, onUnpublish, onTrash }) {
  const { session } = useAuth()
  const [exporting, setExporting] = useState(false)
  const { data: foldersData } = useNoteFolders()
  const { data: tagsData } = useNoteTags()
  const createFolder = useCreateNoteFolder()
  const createTag = useCreateNoteTag()
  const setNoteTags = useSetNoteTags()
  const [trashOpen, setTrashOpen] = useState(false)

  const folders = foldersData?.folders ?? []
  const allTags = tagsData?.tags ?? []
  const noteTags = note?.tags ?? []
  const noteTagIds = noteTags.map(t => t.id)

  const folderOptions = [
    { value: '__none__', label: 'Sin carpeta' },
    ...folders.map(f => ({ value: f.id, label: f.name })),
  ]

  // Only show tags not already assigned, so the combobox is an "add" action
  const unassignedTagOptions = allTags
    .filter(t => !noteTagIds.includes(t.id))
    .map(t => ({ value: t.id, label: t.name }))

  const publicUrl = note?.public_slug
    ? `${window.location.origin}/app/p/notes/${note.public_slug}`
    : null

  const [copied, setCopied] = useState(false)
  const handleCopyLink = useCallback(() => {
    if (!publicUrl) return
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [publicUrl])

  const activeBg = note?.background_color ?? null
  const isCanvas = note?.note_type === 'canvas'

  // Canvas export from the settings panel: the whole scene, images included.
  // Dynamic-imports keep the heavy Excalidraw export utils out of this always-
  // loaded panel's chunk.
  const handleCanvasExport = useCallback(
    async (format) => {
      if (!note?.id || exporting) return
      setExporting(true)
      try {
        const [{ scene }, exportMod, imgMod, layerMod] = await Promise.all([
          runly.notes.getCanvas(note.id, session?.access_token),
          import('../lib/canvasExport.js'),
          import('../lib/canvasImages.js'),
          import('../lib/canvasLayers.js'),
        ])
        const fileArr = await imgMod.hydrateImages(scene.files)
        const files = {}
        for (const f of fileArr) files[f.id] = f
        const args = {
          elements: layerMod.deriveScene(scene.elements ?? [], scene.layers ?? []),
          appState: scene.appState ?? {},
          files,
          title: note.title,
        }
        const fn =
          format === 'png'
            ? exportMod.exportCanvasPng
            : format === 'svg'
              ? exportMod.exportCanvasSvg
              : exportMod.exportCanvasPdf
        await fn(args)
      } catch (err) {
        toast.error(err?.message ?? 'No se pudo exportar')
      } finally {
        setExporting(false)
      }
    },
    [note?.id, note?.title, session?.access_token, exporting],
  )

  function handleAddTag(tagId) {
    if (!tagId || noteTagIds.includes(tagId)) return
    setNoteTags.mutate({ noteId: note.id, tagIds: [...noteTagIds, tagId] })
  }

  function handleRemoveTag(tagId) {
    setNoteTags.mutate({ noteId: note.id, tagIds: noteTagIds.filter(id => id !== tagId) })
  }

  function handleCreateTag(name) {
    createTag.mutate({ name: name.trim() }, {
      onSuccess: (res) => {
        const newId = res?.tag?.id
        if (newId) setNoteTags.mutate({ noteId: note.id, tagIds: [...noteTagIds, newId] })
      },
    })
  }

  function handleFolderChange(v) {
    onUpdate({ folderId: v === '__none__' ? null : v })
  }

  function handleCreateFolder(name) {
    createFolder.mutate({ name: name.trim() }, {
      onSuccess: (res) => {
        const newId = res?.folder?.id
        if (newId) onUpdate({ folderId: newId })
      },
    })
  }

  if (!note) return null

  return (
    <div className="flex flex-col gap-5 p-5 text-sm overflow-y-auto h-full bg-card border-l border-border">

      <h3 className="font-semibold text-foreground text-sm tracking-tight">Ajustes de nota</h3>

      {/* ── Icono ────────────────────────────────────────── */}
      <div>
        <SectionLabel>Icono</SectionLabel>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="w-12 h-12 rounded-xl border border-border bg-muted flex items-center justify-center hover:bg-muted/70 transition-colors"
              title="Seleccionar icono"
            >
              {note.icon
                ? <NoteIcon name={note.icon} size={20} className="text-amber-500" />
                : <NotebookPen className="w-5 h-5 text-muted-foreground" />
              }
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-84 p-3" side="bottom" align="start">
            <NoteIconPickerContent value={note.icon} onChange={icon => onUpdate({ icon })} />
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Titulo ───────────────────────────────────────── */}
      <TextField
        label="Titulo"
        value={note.title ?? ''}
        onChange={e => onUpdate({ title: e.target.value })}
        placeholder="Titulo de la nota"
      />

      {/* ── Exportar (solo lienzo) ───────────────────────── */}
      {isCanvas && (
        <div>
          <SectionLabel>Exportar lienzo</SectionLabel>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleCanvasExport('png')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors disabled:opacity-50"
            >
              <FileDown size={13} /> PNG
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleCanvasExport('svg')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors disabled:opacity-50"
            >
              <FileDown size={13} /> SVG
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleCanvasExport('pdf')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors disabled:opacity-50"
            >
              <FileDown size={13} /> PDF
            </button>
          </div>
        </div>
      )}

      {/* ── Carpeta ──────────────────────────────────────── */}
      <CreatableComboboxField
        label="Carpeta"
        options={folderOptions}
        value={note.folder_id ?? '__none__'}
        onChange={handleFolderChange}
        onCreate={handleCreateFolder}
        isCreating={createFolder.isPending}
        placeholder="Buscar o crear carpeta..."
        searchPlaceholder="Buscar carpeta..."
      />

      {/* ── Color de fondo ───────────────────────────────── */}
      <div>
        <SectionLabel>Color de fondo</SectionLabel>
        <div className="flex gap-2 flex-wrap">
          {NOTE_BACKGROUND_COLORS.map(bg => {
            // Use the saturated swatch color for the picker so colors are easily distinguishable
            const swatchColor = bg.swatch ?? null
            const isActive = activeBg === bg.value
            return (
              <button
                key={bg.value ?? 'none'}
                onClick={() => onUpdate({ backgroundColor: bg.value })}
                title={bg.label}
                className="w-7 h-7 rounded-full transition-all hover:scale-110 focus-visible:outline-none"
                style={{
                  backgroundColor: swatchColor ?? 'transparent',
                  borderWidth: 2,
                  borderStyle: 'solid',
                  borderColor: isActive ? '#f59e0b' : 'transparent',
                  boxShadow: isActive
                    ? '0 0 0 1.5px #f59e0b'
                    : bg.value === null
                    ? 'inset 0 0 0 1.5px hsl(var(--border))'
                    : 'none',
                  transform: isActive ? 'scale(1.2)' : 'scale(1)',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* ── Estilo de hoja ───────────────────────────────── */}
      <div>
        <SectionLabel>Estilo de hoja</SectionLabel>
        <div className="flex gap-2">
          {NOTE_PAPER_STYLES.map(style => {
            const isActive = (note?.paper_style ?? 'none') === style.value
            return (
              <button
                key={style.value}
                type="button"
                onClick={() => onUpdate({ paperStyle: style.value })}
                title={style.label}
                className={`flex-1 h-14 rounded-lg border-2 bg-background transition-all ${
                  isActive ? 'border-amber-500' : 'border-border hover:border-muted-foreground/40'
                }`}
                style={paperStylePreviewBackground(style.value)}
              >
                <span className="sr-only">{style.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Etiquetas ────────────────────────────────────── */}
      <div>
        <SectionLabel>Etiquetas</SectionLabel>
        {noteTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {noteTags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 border border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-300"
              >
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  className="rounded-full hover:bg-amber-200 dark:hover:bg-amber-800/50 p-0.5 transition-colors"
                  title="Quitar etiqueta"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <CreatableComboboxField
          options={unassignedTagOptions}
          value=""
          onChange={handleAddTag}
          onCreate={handleCreateTag}
          isCreating={createTag.isPending}
          placeholder="Agregar etiqueta..."
          searchPlaceholder="Buscar o crear etiqueta..."
        />
      </div>

      {/* ── Enlace publico ───────────────────────────────── */}
      <div>
        <SectionLabel>Enlace publico</SectionLabel>
        {publicUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 text-xs border border-border rounded-lg px-3 py-2.5 bg-muted text-muted-foreground truncate font-mono">
                {publicUrl}
              </div>
              <button
                onClick={handleCopyLink}
                className={`p-2.5 border rounded-lg transition-all shrink-0 ${
                  copied
                    ? 'border-green-400 bg-green-50 dark:bg-green-950/30'
                    : 'border-border hover:bg-muted'
                }`}
                title={copied ? 'Copiado' : 'Copiar enlace'}
              >
                {copied
                  ? <Check className="w-3.5 h-3.5 text-green-500" />
                  : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                }
              </button>
            </div>
            <button
              onClick={onUnpublish}
              className="text-xs text-destructive hover:underline"
            >
              Desactivar enlace publico
            </button>
          </div>
        ) : (
          <button
            onClick={onPublish}
            className="text-xs px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
          >
            Generar enlace publico
          </button>
        )}
      </div>

      {/* ── Zona de peligro ──────────────────────────────── */}
      <div className="mt-auto pt-4 border-t border-border">
        <button
          onClick={() => setTrashOpen(true)}
          className="w-full text-xs text-destructive hover:bg-destructive/5 py-2.5 rounded-lg border border-destructive/20 transition-colors font-medium"
        >
          Enviar a papelera
        </button>
      </div>

      <ConfirmDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title="Enviar nota a papelera"
        description="La nota se movera a la papelera. Puedes restaurarla desde alli."
        confirmLabel="Mover a papelera"
        onConfirm={() => { setTrashOpen(false); onTrash?.() }}
      />
    </div>
  )
}
