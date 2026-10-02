import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Trash2, LogOut, Shapes, FileText } from 'lucide-react'
import { NoteIcon } from '../noteIcons.jsx'

export function NoteCard({ note, isSelected, onClick, onTrash }) {
  const excerpt = (() => {
    if (!note.content || typeof note.content !== 'string') return ''
    // Block tags become spaces so text from separate lines doesn't glue together
    const plainText = note.content
      .replace(/<(p|div|h[1-6]|li|br)[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    // The first line of content is duplicated as note.title (see NoteEditor.jsx) — skip it
    const title = (note.title || '').trim()
    const body = title && plainText.startsWith(title) ? plainText.slice(title.length) : plainText
    return body.trim().slice(0, 100)
  })()

  const lastMod = note.updated_at
    ? formatDistanceToNow(new Date(note.updated_at), { addSuffix: true, locale: es })
    : ''

  return (
    <div
      onClick={onClick}
      className={[
        'group relative px-4 py-3.5 cursor-pointer border-b border-border/50 transition-all duration-100',
        isSelected
          ? 'bg-amber-50 dark:bg-amber-900/20 border-l-[3px] border-l-amber-400 pl-3.5'
          : 'hover:bg-muted/50 border-l-[3px] border-l-transparent',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {note.icon ? (
              <NoteIcon
                name={note.icon}
                size={13}
                className={isSelected ? 'text-amber-500 shrink-0' : 'text-muted-foreground shrink-0'}
              />
            ) : note.note_type === 'canvas' ? (
              <Shapes size={13} className={isSelected ? 'text-amber-500 shrink-0' : 'text-muted-foreground shrink-0'} />
            ) : (
              <FileText size={13} className={isSelected ? 'text-amber-500 shrink-0' : 'text-muted-foreground/60 shrink-0'} />
            )}
            <h3 className={[
              'text-sm truncate',
              isSelected
                ? 'font-semibold text-amber-700 dark:text-amber-300'
                : 'font-medium text-foreground',
            ].join(' ')}>
              {note.title || 'Sin titulo'}
            </h3>
          </div>
          {excerpt && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{excerpt}</p>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {note.note_type === 'canvas' ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Lienzo
              </span>
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground/70">
                Nota
              </span>
            )}
            {note.tags?.slice(0, 2).map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
            {note.tags?.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{note.tags.length - 2}</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">{lastMod}</span>
          </div>
        </div>

        {onTrash && (
          // List rows carry is_owner; a shared note offers "leave", never delete.
          <button
            onClick={e => { e.stopPropagation(); onTrash(note) }}
            className="opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-md transition-all"
            title={note.is_owner === false ? 'Salir de la nota' : 'Enviar a papelera'}
          >
            {note.is_owner === false
              ? <LogOut className="w-3.5 h-3.5" />
              : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}
