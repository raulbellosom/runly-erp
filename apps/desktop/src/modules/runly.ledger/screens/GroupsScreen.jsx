// apps/desktop/src/modules/runly.ledger/screens/GroupsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Button, EmptyState, ErrorState, TextField } from '@runly/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@runly/ui'
import { Plus, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

export default function GroupsScreen() {
  const navigate    = useNavigate()
  const { session } = useAuth()
  const token       = session?.access_token ?? null
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName]       = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ledger-groups', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/ledger/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudieron cargar los grupos.')
      return res.json()
    },
    enabled: !!token,
  })

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const res = await fetch(`${API_BASE}/ledger/groups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'No se pudo crear el grupo.')
      return
    }
    toast.success('Grupo creado.')
    setNewName('')
    setCreateOpen(false)
    queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
  }

  const groups = data?.data ?? []

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
      </div>
    )
  }

  if (isError) return <ErrorState description="No se pudieron cargar los grupos." onRetry={refetch} />

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <PageHeader
          eyebrow="Runly Ledger"
          title="Grupos"
          description="Espacios compartidos para colaborar en cuentas bancarias."
          actions={
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} className="mr-1" /> Nuevo grupo
            </Button>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        {groups.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="Sin grupos"
            description="Crea un grupo para empezar a colaborar en cuentas compartidas."
            action={{ label: 'Nuevo grupo', onClick: () => setCreateOpen(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => navigate(`/app/m/runly.ledger/groups/${group.id}`)}
                className="text-left p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FolderOpen size={14} className="text-[hsl(var(--muted-foreground))]" />
                  <span className="text-xs text-[hsl(var(--muted-foreground))] capitalize">{group.my_role}</span>
                </div>
                <div className="font-semibold text-sm truncate">{group.name}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  {group.member_count} miembro{Number(group.member_count) !== 1 ? 's' : ''} · {group.account_count} cuenta{Number(group.account_count) !== 1 ? 's' : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) setCreateOpen(false) }}>
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Nuevo grupo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <TextField
              label="Nombre del grupo"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Finanzas Q2"
              autoFocus
              maxLength={128}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" size="sm" disabled={!newName.trim()}>Crear</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
