import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { SlashCommandMenu } from '../../components/SlashCommandMenu.jsx'
import { buildSlashItems, filterSlashItems } from '../slashCommandItems.js'

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return { noteId: null, token: null }
  },

  addProseMirrorPlugins() {
    const { noteId, token } = this.options
    const items = buildSlashItems({ noteId, token })

    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        // Table cells allow image + drawing (filtered in `items` below); only
        // codeBlock stays a hard block on the whole menu opening at all.
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: ({ editor, query }) =>
          filterSlashItems(items, { query, inTable: editor.isActive('table') }),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let component
          let unmount

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandMenu, { props, editor: props.editor })
              unmount = props.mount(component.element)
            },
            onUpdate(props) {
              component.updateProps(props)
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                unmount?.()
                return true
              }
              return component.ref?.onKeyDown(props) ?? false
            },
            onExit() {
              unmount?.()
              component.destroy()
            },
          }
        },
      }),
    ]
  },
})
