import { Button, Textarea, ChatAttachMenu, useCoarsePointer } from '@runly/ui'
import { Paperclip, X, Send } from 'lucide-react'

export const EMPTY_CHAT_DRAFT = { draft: '', files: [], error: '', requestKey: null }

export function InventoryChatComposer({ onSend, busy, disabled, state, onChange }) {
  const coarse = useCoarsePointer()
  const { draft, files, error } = state
  const setDraft = draft => onChange(current => ({ ...current, draft, requestKey: null }))
  const setFiles = value => onChange(current => ({ ...current, files: typeof value === 'function' ? value(current.files) : value, requestKey: null }))
  const setError = error => onChange(current => ({ ...current, error }))
  function addFiles(incoming) {
    const next = [...files, ...incoming]
    if (next.length > 5 || next.some(file => file.size > 10 * 1024 * 1024) || next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { setError('Máximo 5 archivos, 10 MB por archivo y 20 MB en total.'); return }
    if (next.some(file => !/\.(png|jpe?g|webp|heic|pdf|txt|csv|md|docx|xlsx)$/i.test(file.name))) { setError('Usa imágenes, PDF, Word DOCX, Excel XLSX, TXT, CSV o Markdown.'); return }
    setFiles(next); setError('')
  }
  async function send() {
    if (busy || disabled || (!draft.trim() && !files.length)) return
    const requestKey = state.requestKey ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
    onChange(current => ({ ...current, requestKey }))
    if (await onSend(draft.trim(), files, requestKey)) onChange(EMPTY_CHAT_DRAFT)
  }
  return <div className="space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    {files.length > 0 && <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{files.map((file, index) => <div key={`${file.name}:${index}`} className="flex max-w-full items-center gap-1.5 rounded-full border bg-[hsl(var(--muted))] py-1 pl-2.5 pr-1 text-xs"><Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="min-w-0 max-w-40 truncate">{file.name}</span><Button size="icon" variant="ghost" className="h-5 w-5" disabled={busy} aria-label={`Quitar ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X className="h-3 w-3" /></Button></div>)}</div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Textarea value={draft} aria-label="Mensaje para el asistente de inventario" placeholder="Escribe una pregunta o adjunta archivos…" maxLength={2000} disabled={busy || disabled} rows={2}
      className="resize-none"
      onChange={event => setDraft(event.target.value)} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); addFiles(Array.from(event.clipboardData.files)) } }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
    <div className="flex items-center justify-between">
      <ChatAttachMenu disabled={busy || disabled} showCamera={coarse}
        trigger={<Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Adjuntar archivos e imágenes" disabled={busy || disabled}><Paperclip className="h-4 w-4" /></Button>}
        onPickCamera={file => addFiles([file])} onPickImages={addFiles} onPickDocuments={addFiles} />
      <span className="text-[11px] text-muted-foreground">Consulta y crea con confirmación</span>
      <Button size="icon" className="h-8 w-8 shrink-0" aria-label="Enviar mensaje" disabled={busy || disabled || (!draft.trim() && !files.length)} onClick={send}><Send className="h-4 w-4" /></Button>
    </div>
  </div>
}
