import { NoteCard } from './NoteCard.jsx'
import { EmptyState, SearchInput } from '@runly/ui'

export function NotesList({
  notes = [], selectedNoteId, onSelect, onTrash, isLoading, showTrash = false,
  search = '', onSearchChange,
}) {
  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-3 py-2.5 border-b border-border">
        <SearchInput
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          onClear={() => onSearchChange('')}
          placeholder="Buscar notas..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <span className="text-xs text-muted-foreground">Cargando notas...</span>
          </div>
        ) : notes.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={search ? 'Sin resultados' : showTrash ? 'Papelera vacia' : 'Sin notas'}
              description={
                search
                  ? 'Intenta con otro termino de busqueda'
                  : showTrash
                  ? 'Las notas eliminadas apareceran aqui'
                  : 'Crea tu primera nota con el boton superior'
              }
            />
          </div>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              isSelected={note.id === selectedNoteId}
              onClick={() => onSelect(note)}
              onTrash={!showTrash ? onTrash : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
