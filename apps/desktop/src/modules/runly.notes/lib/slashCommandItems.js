import {
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Code2, Table2, ImagePlus, PenLine,
} from 'lucide-react'
import { pickAndUploadNoteImage } from './noteImageUpload.js'

// Notion-style "/" command list. Each `run` reuses the exact same editor
// command the equivalent NoteToolbar.jsx button already calls — no
// duplicated block-insertion logic. `allowedInTable: true` marks the only
// two items that stay available while the cursor is inside a table cell —
// everything else (headings, lists, nested tables, etc.) stays blocked
// there (see docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md).
export function buildSlashItems({ noteId, token }) {
  return [
    { title: 'Titulo 1', icon: Heading1, keywords: ['heading', 'h1', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
    { title: 'Titulo 2', icon: Heading2, keywords: ['heading', 'h2', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
    { title: 'Titulo 3', icon: Heading3, keywords: ['heading', 'h3', 'titulo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
    { title: 'Lista con vinetas', icon: List, keywords: ['bullet', 'lista'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { title: 'Lista numerada', icon: ListOrdered, keywords: ['ordered', 'numerada', 'lista'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { title: 'Lista de tareas', icon: ListChecks, keywords: ['task', 'checklist', 'pendientes'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
    { title: 'Cita', icon: Quote, keywords: ['quote', 'blockquote'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
    { title: 'Bloque de codigo', icon: Code2, keywords: ['code', 'codigo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
    { title: 'Tabla', icon: Table2, keywords: ['table', 'tabla'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: 'Imagen', icon: ImagePlus, keywords: ['image', 'imagen', 'foto'], allowedInTable: true,
      run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); pickAndUploadNoteImage({ editor, noteId, token }) } },
    { title: 'Canvas de dibujo', icon: PenLine, keywords: ['drawing', 'dibujo', 'canvas'], allowedInTable: true,
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertDrawingBlock().run() },
  ]
}

// Pure filter used by the Suggestion `items` callback — kept separate from
// buildSlashItems so it's testable without a TipTap editor instance.
export function filterSlashItems(items, { query, inTable }) {
  const pool = inTable ? items.filter((item) => item.allowedInTable === true) : items
  const q = (query || '').toLowerCase()
  if (!q) return pool
  return pool.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  )
}
