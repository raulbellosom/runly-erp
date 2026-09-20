import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentEditor } from '@tiptap/react'
import { useBlockDragReorder } from '../hooks/useBlockDragReorder.js'
import { NoteBlockDragHandle } from './NoteBlockDragHandle.jsx'

function TableHandle({ editor, pos, dom }) {
  const drag = useBlockDragReorder({
    editor,
    getPos: () => pos,
    getBoxEl: () => dom,
    getFrameEl: () => dom,
    editable: editor.isEditable,
    isEditing: false,
  })
  return <NoteBlockDragHandle label="Mover tabla" drag={drag} />
}

// TipTap's TableView owns the table/colgroup/tbody and column resizing.
// Its wrapper ignores mutations outside tbody, so controls can live in a
// portal there without entering the document or replacing that node view.
export function TableDragHandles() {
  const { editor } = useCurrentEditor()
  const [tables, setTables] = useState([])

  useEffect(() => {
    if (!editor) return
    const hosts = new Map()
    function update() {
      const next = []
      const current = new Set()
      editor.state.doc.forEach((node, pos) => {
        if (node.type.name !== 'table') return
        const dom = editor.view.nodeDOM(pos)
        if (!dom?.classList.contains('tableWrapper')) return
        current.add(dom)
        let host = hosts.get(dom)
        if (!host) {
          host = document.createElement('div')
          host.contentEditable = 'false'
          host.dataset.html2canvasIgnore = 'true'
          host.className = 'sticky left-0 mb-1 flex w-fit'
          dom.prepend(host)
          hosts.set(dom, host)
        }
        next.push({ pos, dom, host })
      })
      for (const [dom, host] of hosts) {
        if (!current.has(dom)) { host.remove(); hosts.delete(dom) }
      }
      setTables(previous => previous.length === next.length && previous.every((table, i) =>
        table.pos === next[i].pos && table.host === next[i].host,
      ) ? previous : next)
    }
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
      for (const host of hosts.values()) host.remove()
    }
  }, [editor])

  return tables.map(({ pos, dom, host }) => createPortal(
    <TableHandle editor={editor} pos={pos} dom={dom} />, host, String(pos),
  ))
}
