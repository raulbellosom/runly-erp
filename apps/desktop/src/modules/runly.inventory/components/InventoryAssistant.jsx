import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AssistantWordmark, Button, Checkbox, ErrorState, Badge, Sheet, SheetContent, SheetTitle, MarkdownViewer, ModuleAssistantPanel, useCoarsePointer } from '@runly/ui'
import { Sparkles, FileText, Boxes, ChevronRight } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'
import { ALL_INVENTORY, InventoryAssistantContext, inventoryScopeLabel } from '../lib/assistant-context.js'
import { InventoryChatComposer, EMPTY_CHAT_DRAFT } from './InventoryChatComposer.jsx'
import { InventoryActionProposal } from './InventoryActionProposal.jsx'

const PROMPT_SUGGESTIONS = [
  '¿Cuántos equipos tengo disponibles?',
  'Busca un equipo por número de serie',
  'Crea un campo personalizado para garantía',
  'Resume el estado de este equipo',
]

function BotAvatar() {
  return <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}><Sparkles className="h-3.5 w-3.5" /></div>
}

export function InventoryAssistantHost({ children }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  return <AssistantWorkspace key={`${activeCompanyId}:${session?.user?.id}`} token={session?.access_token} companyId={activeCompanyId} userId={session?.user?.id}>{children}</AssistantWorkspace>
}

function AssistantWorkspace({ children, token, companyId, userId }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(null)
  const [launch, setLaunch] = useState({ context: ALL_INVENTORY, sequence: 0 })
  const [busy, setBusy] = useState(false)
  const [openedBefore, setOpenedBefore] = useState(false)
  const coarse = useCoarsePointer()
  const id = pathname.match(/\/inventory\/([0-9a-f-]{36})(?:\/edit)?$/i)?.[1]
  const currentContext = page?.path === pathname ? page.context : id ? { ...ALL_INVENTORY, mode: 'item', ids: [id] } : ALL_INVENTORY
  const setPageContext = useCallback(context => setPage(current => current?.path === pathname && JSON.stringify(current.context) === JSON.stringify(context) ? current : { path: pathname, context }), [pathname])
  const openAssistant = useCallback(context => {
    setOpenedBefore(true)
    if (busy) { setOpen(true); return }
    setLaunch(current => ({ context, sequence: current.sequence + 1 })); setOpen(true)
  }, [busy])
  const value = useMemo(() => ({ openAssistant, setPageContext, busy }), [openAssistant, setPageContext, busy])
  // ModuleAssistantPanel draws the header (list view / chat view with back).
  const renderPanel = content => coarse ? <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="flex h-[90dvh] w-full flex-col gap-0 p-0 sm:max-w-lg"><SheetTitle className="sr-only">MirAI, asistente de inventario</SheetTitle>{content}</SheetContent></Sheet>
    : <aside aria-label="Chat de inventario" className={`${open ? 'flex' : 'hidden'} h-full min-h-0 w-[390px] shrink-0 flex-col border-l bg-background`}>{content}</aside>
  return <InventoryAssistantContext.Provider value={value}><div className="flex h-full min-h-0 overflow-hidden">
    <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    {!open && <Button variant="outline" className="group fixed right-0 top-1/2 z-40 -translate-y-1/2 justify-start gap-0 overflow-hidden rounded-l-full rounded-r-none border-r-0 bg-background/90 px-3 text-muted-foreground shadow-md backdrop-blur transition-all duration-200 hover:gap-2 hover:bg-muted hover:px-4 hover:text-foreground hover:shadow-lg"
      aria-label="Abrir chat de inventario" onClick={() => { if (!openedBefore) { openAssistant(currentContext); setOpenedBefore(true) } else setOpen(true) }}>
      <Sparkles className="h-4 w-4 shrink-0" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-all duration-200 group-hover:max-w-24 group-hover:opacity-100"><AssistantWordmark /></span>
    </Button>}
    <InventoryChat token={token} companyId={companyId} userId={userId} open={open} launch={launch} currentContext={currentContext} onBusy={setBusy} renderPanel={renderPanel} onClose={coarse ? undefined : () => setOpen(false)} coarse={coarse} />
  </div></InventoryAssistantContext.Provider>
}

function InventoryChat({ token, companyId, userId, open, launch, currentContext, onBusy, renderPanel, onClose, coarse }) {
  const qc = useQueryClient()
  const key = useMemo(() => ['inventory', 'assistant', companyId, userId], [companyId, userId])
  const [activeId, setActiveId] = useState(null)
  const [draftContext, setDraftContext] = useState(ALL_INVENTORY)
  const [composer, setComposer] = useState(EMPTY_CHAT_DRAFT)
  const [seenLaunch, setSeenLaunch] = useState(launch.sequence)
  const [view, setView] = useState('chat')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (seenLaunch !== launch.sequence) { setSeenLaunch(launch.sequence); setActiveId(null); setDraftContext(launch.context); setError(''); setView('chat') }
  const request = useCallback((path, options = {}) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId, path: `/inventory/ai/threads${path}`, ...options }), [token, companyId])
  const threads = useQuery({ queryKey: [...key, 'threads'], queryFn: ({ signal }) => request('', { signal }), enabled: open && Boolean(token && companyId), retry: false })
  const thread = useQuery({ queryKey: [...key, 'thread', activeId], queryFn: ({ signal }) => request(`/${activeId}`, { signal }), enabled: open && Boolean(activeId), retry: false, staleTime: 0 })
  const context = activeId ? thread.data?.context : draftContext
  async function send(content, files, requestKey) {
    setBusy(true); onBusy(true); setError('')
    try {
      let current = thread.data
      if (!activeId) {
        current = await request('', { body: { context: draftContext } })
        if (!mounted.current) return false
        qc.setQueryData([...key, 'thread', current.id], current)
        setActiveId(current.id)
      }
      const form = new FormData()
      form.append('message', JSON.stringify({ content, requestKey, version: current.version }))
      files.forEach(file => form.append('files', file))
      const saved = await request(`/${current.id}/messages`, { body: form })
      if (!mounted.current) return false
      qc.setQueryData([...key, 'thread', current.id], saved)
      await qc.invalidateQueries({ queryKey: [...key, 'threads'] })
      return true
    } catch (err) {
      if (mounted.current) { setError(err.message); if ([401, 403].includes(err.status)) qc.removeQueries({ queryKey: key }) }
      return false
    } finally { if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  async function decide(message, decision) {
    setBusy(true); onBusy(true); setError('')
    try {
      const saved = await request(`/${activeId}/decision`, { body: { messageId: message.id, proposalId: message.proposal.id, decision } })
      if (!mounted.current) return
      qc.setQueryData([...key, 'thread', activeId], saved)
      await qc.invalidateQueries({ queryKey: ['inventory'] })
    } catch (err) { if (mounted.current) { setError(err.message); if ([401, 403].includes(err.status)) qc.removeQueries({ queryKey: key }) } }
    finally { if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  async function removeThread(item) {
    try { await request(`/${item.id}`, { method: 'DELETE' }); if (activeId === item.id) setActiveId(null); qc.removeQueries({ queryKey: [...key, 'thread', item.id] }); await qc.invalidateQueries({ queryKey: [...key, 'threads'] }) }
    catch (err) { setError(err.message) }
  }
  const title = activeId ? (threads.data ?? []).find(item => item.id === activeId)?.title ?? 'Conversación' : 'Nueva consulta'
  const contextChip = context && <div className="space-y-2"><Badge variant="outline" className="whitespace-normal">{inventoryScopeLabel(context)}</Badge>{!activeId && context.mode !== 'all' && <label className="flex items-center gap-2 text-xs"><Checkbox checked={context.allowCompanySearch} onCheckedChange={value => setDraftContext(current => ({ ...current, allowCompanySearch: Boolean(value) }))} />Permitir consultar otros equipos</label>}</div>
  return renderPanel(<ModuleAssistantPanel view={view} subtitle="Asistente de inventario" listLabel="Conversaciones de inventario" onClose={onClose} headerClassName={coarse ? 'pr-12' : undefined} busy={busy}
    conversations={threads.data ?? []} conversationsError={threads.isError ? threads.error.message : null} conversationsLoading={threads.isPending} activeId={activeId}
    onBack={() => { setView('list'); setError('') }}
    onNew={() => { setActiveId(null); setDraftContext(currentContext); setError(''); setView('chat') }}
    onSelect={item => { setActiveId(item.id); setError(''); setView('chat'); void qc.invalidateQueries({ queryKey: [...key, 'thread', item.id] }) }}
    onDelete={removeThread} chatTitle={title} chatContext={contextChip}>
    <ChatMessages messages={thread.isError ? [] : thread.data?.messages ?? []} busy={busy} loading={Boolean(activeId && thread.isPending)} error={error || thread.error?.message} onDecide={decide}
      onPickPrompt={prompt => setComposer(current => ({ ...current, draft: prompt }))} />
    <InventoryChatComposer state={composer} onChange={setComposer} onSend={send} busy={busy} disabled={Boolean(activeId && (!thread.data || thread.isError))} />
  </ModuleAssistantPanel>)
}

function ReferenceCards({ references }) {
  return <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
    {references.map(ref => <a key={ref.id} href={`/app/m/runly.inventory/inventory/${ref.id}`} target="_blank" rel="noreferrer"
      className="group flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-xs transition-colors hover:border-[--color-primary]/50 hover:bg-[--color-primary]/5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Boxes className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1 truncate font-medium">{ref.label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </a>)}
  </div>
}

function ChatMessages({ messages, busy, loading, error, onDecide, onPickPrompt }) {
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [messages, busy])
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3" role="log" aria-live="polite">
    {!messages.length && !loading && <div className="mx-auto my-4 max-w-sm space-y-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}><Sparkles className="h-6 w-6" /></div>
      <div><p className="text-sm font-semibold">Tu asistente de inventario</p><p className="mt-1 text-xs text-muted-foreground">Consulta equipos, lee fotos y documentos, o pide crear un equipo, catálogo o campo personalizado.</p></div>
      <div className="flex flex-col gap-2 text-left">{PROMPT_SUGGESTIONS.map(prompt => <button key={prompt} type="button" onClick={() => onPickPrompt?.(prompt)}
        className="rounded-xl border bg-[hsl(var(--muted)/0.4)] px-3 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--muted))]">{prompt}</button>)}</div>
    </div>}
    {messages.map(message => {
      const isUser = message.role === 'user'
      return <div key={message.id} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {!isUser && <BotAvatar />}
        <div className={`max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm ${isUser ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'}`}>
          {isUser ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : <MarkdownViewer value={message.text} />}
          {message.proposal && <InventoryActionProposal key={message.proposal.id} message={message} busy={busy} onDecide={onDecide} />}
          {message.attachments?.map((file, index) => <div key={`${file.name}:${index}`} className="space-y-2">{file.preview && <img src={file.preview} alt={file.name} className="max-h-40 max-w-full rounded-lg object-contain" />}<details className="rounded-lg border p-2 text-xs"><summary className="cursor-pointer break-all"><FileText className="mr-1 inline h-3 w-3" />{file.name} · contenido analizado{file.truncated ? ' (parcial)' : ''}</summary><p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{file.text}</p></details></div>)}
          {message.references?.length > 0 && <ReferenceCards references={message.references} />}
        </div>
      </div>
    })}
    {(busy || loading) && <div className="flex items-center gap-2 px-1" role="status">
      {!loading && <BotAvatar />}
      <div className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
      <span className="text-xs italic text-muted-foreground">{busy ? 'MirAI está analizando y consultando' : 'Cargando conversación'}</span>
    </div>}
    {error && <ErrorState title="No se pudo completar la consulta" description={error} />}
    <div ref={end} />
  </div>
}
