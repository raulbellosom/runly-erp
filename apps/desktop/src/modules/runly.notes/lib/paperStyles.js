// Paper-style catalog for the note "Estilo de hoja" setting, plus the
// preview backgrounds used by NoteSettingsPanel's picker thumbnails. The
// real ruled/grid rendering inside the editor lives in styles.css (scoped
// via the [data-paper-style] attribute NoteEditor sets), sized in `em` so it
// tracks `.tiptap`'s actual line-height — these previews use fixed px since
// they're small decorative swatches, not real editor content.
export const NOTE_PAPER_STYLES = [
  { value: 'none',  label: 'En blanco' },
  { value: 'lined', label: 'Rayado' },
  { value: 'grid',  label: 'Cuadriculado' },
]

export function paperStylePreviewBackground(value) {
  const line = 'hsl(var(--border)) 9px, hsl(var(--border)) 10px'
  if (value === 'lined') {
    return { backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent 9px, ${line})` }
  }
  if (value === 'grid') {
    return {
      backgroundImage:
        `repeating-linear-gradient(to bottom, transparent, transparent 9px, ${line}),` +
        `repeating-linear-gradient(to right, transparent, transparent 9px, ${line})`,
    }
  }
  return {}
}
