import { lazy, Suspense, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TextareaField } from '@runly/ui'
import { useAuth } from '../auth/AuthProvider'
import { runly } from '../lib/runly'
import { hydrateImages } from '../modules/runly.notes/lib/canvasImages.js'
import { deriveScene, ensureLayers } from '../modules/runly.notes/lib/canvasLayers.js'

const NoteEditor = lazy(() => import('../modules/runly.notes/components/NoteEditor.jsx').then((m) => ({ default: m.NoteEditor })))
const CanvasEditor = lazy(() => import('../modules/runly.notes/components/CanvasEditor.jsx').then((m) => ({ default: m.CanvasEditor })))
const CanvasStage = lazy(() => import('../modules/runly.notes/components/CanvasStage.jsx'))

function SharedCanvasView({ id, token }) {
  const scene = useQuery({
    queryKey: ['shared-canvas', id],
    queryFn: async () => {
      const { scene } = await runly.notes.getCanvas(id, token)
      const files = await hydrateImages(scene.files)
      return { elements: deriveScene(scene.elements, ensureLayers(scene.layers)), files: Object.fromEntries(files.map((file) => [file.id, file])), appState: scene.appState, scrollToContent: true }
    },
    staleTime: 0, refetchInterval: 10_000, retry: false,
  })
  if (scene.isError) return <ErrorState title="Recurso no disponible" />
  if (!scene.data) return <LoadingState />
  return <CanvasStage key={scene.dataUpdatedAt} initialData={scene.data} viewModeEnabled />
}

function SharedChat({ id, token }) {
  const [body, setBody] = useState('')
  const queryClient = useQueryClient()
  const messages = useQuery({ queryKey: ['shared-chat', id], queryFn: () => runly.chat.listMessages(id, { limit: 40 }, token), refetchInterval: 5000, retry: false, staleTime: 0 })
  const send = useMutation({
    mutationFn: () => runly.chat.sendMessage(id, { body }, token),
    onSuccess: () => { setBody(''); queryClient.invalidateQueries({ queryKey: ['shared-chat', id] }) },
  })
  if (messages.isError) return <ErrorState title="Conversación no disponible" />
  if (messages.isPending) return <LoadingState />
  const rows = [...(messages.data?.data ?? [])].sort((a, b) => new Date(a.createdAt ?? a.created_at) - new Date(b.createdAt ?? b.created_at))
  return <div className="mx-auto max-w-3xl space-y-4 p-4">
    {!rows.length && <EmptyState title="Sin mensajes" description="Puedes iniciar la conversación." />}
    {rows.map((message) => <Card key={message.id} className="p-4"><p className="text-sm font-medium">{message.sender?.displayName ?? 'Participante'}</p><p className="whitespace-pre-wrap break-words">{message.body}</p></Card>)}
    <TextareaField label="Mensaje" value={body} onChange={(e) => setBody(e.target.value)} />
    {send.isError && <ErrorState title="No se pudo enviar el mensaje" />}
    <Button disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>Enviar</Button>
  </div>
}

export function SharedResourceScreen() {
  const { resourceType, id } = useParams()
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const resource = useQuery({
    queryKey: ['shared-resource', resourceType, id],
    queryFn: () => resourceType === 'note' ? runly.notes.get(id, token) : runly.chat.getConversation(id, token),
    enabled: Boolean(token && ['chat', 'note'].includes(resourceType)),
    retry: false, staleTime: 0, refetchInterval: 10_000,
  })
  if (!['chat', 'note'].includes(resourceType) || resource.isError) return <ErrorState title="Recurso no disponible" description="La invitación puede haber sido revocada." />
  if (resource.isPending) return <LoadingState />
  const note = resource.data?.note
  const readOnly = note && note.owner_user_id !== userProfile?.id && !note.shares?.some((share) => share.userId === userProfile?.id && share.permission === 'edit')
  return <main className="flex h-dvh flex-col">
    <div className="p-4"><PageHeader title={note?.title ?? resource.data?.data?.title ?? 'Recurso compartido'} /></div>
    <div className="min-h-0 flex-1 overflow-auto"><Suspense fallback={<LoadingState />}>
      {resourceType === 'chat' ? <SharedChat id={id} token={token} />
        : note?.note_type === 'canvas' ? (readOnly ? <SharedCanvasView id={id} token={token} /> : <CanvasEditor note={note} />)
          : <NoteEditor note={note} readOnly={Boolean(readOnly)} />}
    </Suspense></div>
  </main>
}
