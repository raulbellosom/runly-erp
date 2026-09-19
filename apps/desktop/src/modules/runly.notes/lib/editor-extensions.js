import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { columnResizing, columnResizingPluginKey } from '@tiptap/pm/tables'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Collaboration from '@tiptap/extension-collaboration'
// TipTap v3 renamed CollaborationCursor -> CollaborationCaret (the -cursor
// package stopped at v2 and does not work against v3 core).
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { SlashCommand } from './extensions/SlashCommand.jsx'
import { TrailingNode } from './extensions/TrailingNode.js'
import { bodyPlaceholderText } from './placeholderText.js'

// TipTap only installs column resizing when initially editable. Notes open
// in view mode, so retain this plugin across mode switches. Its handlers
// already check view.editable before allowing a resize.
const NoteTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent()
    if (this.options.resizable && !plugins.some(plugin => plugin.key === columnResizingPluginKey.key)) {
      plugins.unshift(columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: this.options.View,
        lastColumnResizable: this.options.lastColumnResizable,
      }))
    }
    return plugins
  },
})

// CollaborationCaret's default cursor builder renders an unstyled block <div>
// with the user's name — with no matching CSS it shows as a full-width solid
// bar. We render instead a thin caret line with a small circular avatar chip
// (name on hover), Notion / Google-Docs style.
function buildCollabCaret(user) {
  const color = user?.color || '#f59e0b'
  const name = user?.name || 'Colaborador'

  const caret = document.createElement('span')
  caret.className = 'runly-yjs-caret'
  caret.style.setProperty('--caret-color', color)

  const chip = document.createElement('span')
  chip.className = 'runly-yjs-caret__chip'
  chip.style.backgroundColor = color
  chip.title = name

  if (user?.avatarUrl) {
    const img = document.createElement('img')
    img.className = 'runly-yjs-caret__img'
    img.src = user.avatarUrl
    img.alt = name
    img.addEventListener('error', () => {
      img.remove()
      chip.textContent = name.trim().charAt(0).toUpperCase() || '?'
    })
    chip.appendChild(img)
  } else {
    chip.textContent = name.trim().charAt(0).toUpperCase() || '?'
  }

  caret.appendChild(chip)
  return caret
}

// Remote text selection — a light wash instead of the default opaque-ish tint.
function buildCollabSelection(user) {
  const color = user?.color || '#f59e0b'
  return { class: 'ProseMirror-yjs-selection', style: `background-color: ${color}22` }
}

export function buildExtensions({
  ydoc, provider, userColor, userName, userId, userAvatarUrl,
  readOnly = false, noteId, token,
}) {
  const collab = Boolean(ydoc && provider)

  const base = [
    // Exclude link/underline/image/trailingNode from StarterKit — we register
    // them explicitly below (StarterKit v3 bundles them; adding duplicates
    // triggers a TipTap "Duplicate extension names" warning).
    //
    // In StarterKit v3 the history extension is `undoRedo` (from
    // @tiptap/extensions); the old `history` key is silently ignored. When
    // Collaboration is active it MUST be disabled — Collaboration ships its own
    // Y.js-backed undo/redo and the two histories corrupt each other (TipTap
    // warns "not compatible with @tiptap/extension-undo-redo"). Off only in
    // collab mode so the plain read-only / public editor keeps normal undo.
    StarterKit.configure({
      undoRedo: collab ? false : undefined,
      link: false,
      underline: false,
      trailingNode: false,
    }),
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    NoteTable.configure({ resizable: !readOnly }),
    TableRow,
    TableCell,
    TableHeader,
    // Image is intentionally omitted here: AnnotatableImage (added in NoteEditor) overrides
    // the 'image' node. Including both would produce a duplicate-extension warning.
    CharacterCount,
    Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ editor, node }) =>
        bodyPlaceholderText({
          isFirst: editor.state.doc.firstChild === node,
          nodeTypeName: node.type.name,
          isEmpty: node.content.size === 0,
          docChildCount: editor.state.doc.childCount,
        }),
    }),
    TrailingNode,
  ]

  if (!readOnly) {
    base.push(SlashCommand.configure({ noteId, token }))
  }

  if (collab) {
    base.push(
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user: {
          id: userId ?? null,
          name: userName ?? 'Anonimo',
          color: userColor ?? '#f59e0b',
          avatarUrl: userAvatarUrl ?? null,
        },
        render: buildCollabCaret,
        selectionRender: buildCollabSelection,
      }),
    )
  }

  return base
}
