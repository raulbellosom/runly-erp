import { Users } from 'lucide-react'

function initials(name) {
  return (name ?? '?').trim()[0]?.toUpperCase() ?? '?'
}

// Static footer, rendered OUTSIDE the note card, listing who has access to
// the note (the owner + everyone it's shared with) — display name only, see
// getPublicNote's collaborators query in shares-service.js.
export function PublicNoteCollaborators({ collaborators = [] }) {
  if (!collaborators.length) return null

  return (
    <div className="mt-6 flex flex-col items-center gap-3 text-center">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        <Users size={12} />
        Colaboradores de esta nota
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {collaborators.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-600 shadow-sm"
          >
            <span className="w-5 h-5 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-semibold">
              {initials(c.display_name)}
            </span>
            {c.display_name || 'Usuario'}
            {c.is_owner && <span className="text-gray-400">· Autor</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
