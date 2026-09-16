import { useCurrentEditor } from '@tiptap/react'
import { useState } from 'react'
import {
  Undo2, Redo2, Link2, PenLine, Table2, ChevronDown, ExternalLink, Unlink,
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Code, Code2, List, ListOrdered, ListChecks,
  Quote, Type, Highlighter, Image as ImageIcon, Loader2, HelpCircle,
} from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent, ImageSourceSheet, useCoarsePointer } from '@runly/ui'
import { useIsDark } from '../hooks/useIsDark.js'
import { uploadAndInsertNoteImage } from '../lib/noteImageUpload.js'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog.jsx'
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'

const TEXT_COLORS_LIGHT = [
  '#0f172a', '#475569', '#94a3b8', '#cbd5e1',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#d946ef',
]
const TEXT_COLORS_DARK = [
  '#f8fafc', '#94a3b8', '#475569', '#1e293b',
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa',
  '#f472b6', '#e879f9',
]

// Same pastels in both modes — CSS forces dark text on marks in dark mode
const HIGHLIGHT_COLORS_LIGHT = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#e9d5ff',
  '#fce7f3', '#fed7aa', '#fecaca', '#cffafe',
]
const HIGHLIGHT_COLORS_DARK = HIGHLIGHT_COLORS_LIGHT

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick?.() }}
      disabled={disabled}
      title={title}
      className={[
        'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none shrink-0',
        active
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled ? 'opacity-30 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="h-5 w-px bg-border mx-0.5 shrink-0" />
}

function ColorPopover({ title, colors, onColor, onClear, isColorActive, triggerIsActive, triggerContent }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onMouseDown={e => e.preventDefault()}
          className={[
            'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-0.5 transition-colors select-none shrink-0',
            triggerIsActive
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ].join(' ')}
          title={title}
        >
          {triggerContent}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-auto" side="bottom" align="start">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</p>
        <div className="grid grid-cols-7 gap-1.5">
          {colors.map(c => (
            <button
              key={c}
              onMouseDown={e => { e.preventDefault(); onColor(c) }}
              style={{ backgroundColor: c }}
              title={c}
              className={[
                'w-6 h-6 rounded border-2 transition-all hover:scale-110',
                isColorActive(c)
                  ? 'border-amber-500 scale-110 shadow-sm'
                  : 'border-border hover:border-foreground/40',
              ].join(' ')}
            />
          ))}
        </div>
        <button
          onMouseDown={e => { e.preventDefault(); onClear() }}
          className="mt-2.5 w-full text-[11px] text-muted-foreground hover:text-foreground text-left px-1 py-1 rounded hover:bg-muted transition-colors"
        >
          Sin color
        </button>
      </PopoverContent>
    </Popover>
  )
}

function TableMenuItem({ label, onClick, destructive }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className={[
        'w-full text-left px-3 py-1.5 text-sm rounded transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

export function NoteToolbar({ noteId, token }) {
  const { editor } = useCurrentEditor()
  const isDark = useIsDark()
  const [linkUrl, setLinkUrl] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const isCoarsePointer = useCoarsePointer()
  const [imageSheetOpen, setImageSheetOpen] = useState(false)
  if (!editor) return null

  const TEXT_COLORS = isDark ? TEXT_COLORS_DARK : TEXT_COLORS_LIGHT
  const HIGHLIGHT_COLORS = isDark ? HIGHLIGHT_COLORS_DARK : HIGHLIGHT_COLORS_LIGHT

  const activeTextColor = editor.getAttributes('textStyle').color ?? null

  async function handleImageFile(file) {
    setUploadingImage(true)
    try {
      await uploadAndInsertNoteImage(file, { editor, noteId, token })
    } finally {
      setUploadingImage(false)
    }
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-background/90 backdrop-blur-sm flex-nowrap overflow-x-auto [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible sticky top-0 z-10 shadow-sm">

      {/* History */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Deshacer (Ctrl+Z)"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Rehacer (Ctrl+Y)"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Headings */}
      {[1, 2, 3].map(l => (
        <ToolbarButton
          key={l}
          onClick={() => editor.chain().focus().toggleHeading({ level: l }).run()}
          active={editor.isActive('heading', { level: l })}
          title={`Titulo ${l}`}
        >
          <span className="font-bold text-xs">H{l}</span>
        </ToolbarButton>
      ))}

      <Divider />

      {/* Marks */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Negrita (Ctrl+B)"
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Cursiva (Ctrl+I)"
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Subrayado (Ctrl+U)"
      >
        <UnderlineIcon className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Tachado"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')}
        title="Codigo inline"
      >
        <Code className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Text color */}
      <ColorPopover
        title="Color de texto"
        colors={TEXT_COLORS}
        onColor={c => editor.chain().focus().setColor(c).run()}
        onClear={() => editor.chain().focus().unsetColor().run()}
        isColorActive={c => editor.isActive('textStyle', { color: c })}
        triggerIsActive={Boolean(activeTextColor)}
        triggerContent={
          <span className="flex flex-col items-center gap-0.75">
            <Type className="w-3.5 h-3.5" />
            <span
              className="w-4 h-0.75 rounded-full transition-colors"
              style={{ backgroundColor: activeTextColor ?? '#0f172a' }}
            />
          </span>
        }
      />

      {/* Highlight */}
      <ColorPopover
        title="Color de resaltado"
        colors={HIGHLIGHT_COLORS}
        onColor={c => editor.chain().focus().toggleHighlight({ color: c }).run()}
        onClear={() => editor.chain().focus().unsetHighlight().run()}
        isColorActive={c => editor.isActive('highlight', { color: c })}
        triggerIsActive={editor.isActive('highlight')}
        triggerContent={<Highlighter className="w-3.5 h-3.5" />}
      />

      <Divider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Lista de viñetas"
      >
        <List className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Lista numerada"
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive('taskList')}
        title="Lista de tareas"
      >
        <ListChecks className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Block elements */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Cita"
      >
        <Quote className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        title="Bloque de codigo"
      >
        <Code2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="Insertar tabla"
      >
        <Table2 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Image + drawing + link */}
      {isCoarsePointer ? (
        <button
          type="button"
          title="Insertar imagen"
          disabled={uploadingImage}
          onClick={() => setImageSheetOpen(true)}
          className={[
            'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none shrink-0',
            uploadingImage
              ? 'opacity-50 cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ].join(' ')}
        >
          {uploadingImage
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <ImageIcon className="w-3.5 h-3.5" />}
        </button>
      ) : (
        <label
          title="Insertar imagen"
          className={[
            'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none cursor-pointer shrink-0',
            uploadingImage
              ? 'opacity-50 cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ].join(' ')}
        >
          {uploadingImage
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <ImageIcon className="w-3.5 h-3.5" />}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploadingImage}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleImageFile(file)
            }}
          />
        </label>
      )}
      <ImageSourceSheet
        open={imageSheetOpen}
        onOpenChange={setImageSheetOpen}
        onPickFile={handleImageFile}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().insertDrawingBlock().run()}
        title="Insertar canvas de dibujo"
      >
        <PenLine className="w-3.5 h-3.5" />
      </ToolbarButton>
      <Popover open={linkOpen} onOpenChange={open => {
        setLinkOpen(open)
        if (open) setLinkUrl(editor.getAttributes('link').href ?? '')
      }}>
        <PopoverTrigger asChild>
          <button
            onMouseDown={e => e.preventDefault()}
            className={[
              'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none shrink-0',
              editor.isActive('link')
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ].join(' ')}
            title="Insertar enlace"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-3 w-72" side="bottom" align="start">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Enlace</p>
          <form
            onSubmit={e => {
              e.preventDefault()
              const url = linkUrl.trim()
              if (!url) {
                editor.chain().focus().unsetLink().run()
              } else {
                const href = url.startsWith('http') ? url : `https://${url}`
                editor.chain().focus().setLink({ href }).run()
              }
              setLinkOpen(false)
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              type="text"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 text-sm border border-border rounded-md px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-md transition-colors"
            >
              Aplicar
            </button>
          </form>
          {editor.isActive('link') && (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border">
              <a
                href={editor.getAttributes('link').href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-amber-600 hover:underline flex-1 truncate"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                {editor.getAttributes('link').href}
              </a>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetLink().run(); setLinkOpen(false) }}
                className="text-xs text-destructive hover:underline flex items-center gap-1 shrink-0"
              >
                <Unlink className="w-3 h-3" />
                Quitar
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Table context menu — only when cursor is inside a table */}
      {editor.isActive('table') && (
        <>
          <Divider />
          <Popover>
            <PopoverTrigger asChild>
              <button
                onMouseDown={e => e.preventDefault()}
                className="h-8 sm:h-7 px-2 rounded flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors select-none shrink-0"
                title="Opciones de tabla"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Tabla</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-1 w-52" side="bottom" align="start">
              {tableMenuSections(getTableMenuActions(editor)).map((section, si) => (
                <div key={section.group}>
                  {si > 0 && <div className="my-1 border-t border-border" />}
                  {section.items.map((action) => (
                    <TableMenuItem
                      key={action.label}
                      label={action.label}
                      onClick={action.onClick}
                      destructive={action.destructive}
                    />
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </>
      )}

      <ToolbarButton
        onClick={() => setShortcutsOpen(true)}
        title="Atajos de teclado"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </ToolbarButton>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
