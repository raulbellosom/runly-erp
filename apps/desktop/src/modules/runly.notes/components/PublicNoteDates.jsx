const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

function NoteDate({ label, value }) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return null
  return <span>{label}: <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time></span>
}

export function PublicNoteDates({ createdAt, updatedAt }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
      <NoteDate label="Creada" value={createdAt} />
      <NoteDate label="Última modificación" value={updatedAt} />
    </div>
  )
}
