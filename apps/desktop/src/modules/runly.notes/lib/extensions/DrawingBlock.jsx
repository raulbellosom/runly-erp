import { Node, mergeAttributes } from '@tiptap/react'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DrawingCanvas } from '../../components/DrawingCanvas.jsx'

export const DrawingBlock = Node.create({
  name: 'drawingBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      strokes: { default: '[]' },
      canvasWidth: { default: 700 },
      canvasHeight: { default: 300 },
      backgroundColor: { default: '#ffffff' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawing-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingCanvas)
  },

  addCommands() {
    return {
      insertDrawingBlock: () => ({ commands }) => {
        // A TipTap command isn't a React component, so it can't use the
        // useIsDark hook — but it also doesn't need to: this is the same
        // plain DOM check that hook uses internally for its own initial
        // state. Read live at insertion time so a new drawing always starts
        // legible against the app's CURRENT theme.
        const isDark =
          typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
        return commands.insertContent({
          type: 'drawingBlock',
          attrs: { backgroundColor: isDark ? '#1a1a1a' : '#ffffff' },
        })
      },
    }
  },
})
