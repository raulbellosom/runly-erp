import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, ErrorState, SelectField, TextField } from '@runly/ui'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { runly } from '../lib/runly'

export function ResourceInvitationControl({ resourceType, resourceId }) {
  const { session } = useAuth()
  const token = session?.access_token
  const queryClient = useQueryClient()
  const [permission, setPermission] = useState('read')
  const [link, setLink] = useState(null)
  const [revokeId, setRevokeId] = useState(null)
  const key = ['resource-invitations', resourceType, resourceId]
  const list = useQuery({ queryKey: key, queryFn: () => runly.collaboration.listInvitations({ resourceType, resourceId }, token), enabled: Boolean(token && resourceId), retry: false })
  const create = useMutation({
    mutationFn: () => runly.collaboration.createInvitation({ resourceType, resourceId, permission }, token),
    onSuccess: ({ data }) => {
      setLink(new URL(`/app/accept-invitation?token=${encodeURIComponent(data.token)}`, window.location.origin).href)
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const revoke = useMutation({
    mutationFn: () => runly.collaboration.revokeInvitation(revokeId, token),
    onSuccess: () => { setRevokeId(null); setLink(null); queryClient.invalidateQueries({ queryKey: key }) },
  })
  // Owners manage invitations; members still use the ordinary sharing controls.
  if (list.isError || list.isPending) return null
  return <div className="space-y-3 border-t p-4">
    <p className="text-sm font-medium">Invitar a alguien externo</p>
    <p className="text-xs text-muted-foreground">El enlace permite aceptar una sola vez y caduca en 24 horas. Da acceso únicamente a este recurso.</p>
    {resourceType === 'note' && <SelectField label="Permiso" value={permission} onValueChange={setPermission} options={[{ value: 'read', label: 'Solo lectura' }, { value: 'edit', label: 'Puede editar' }]} />}
    <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>Crear invitación</Button>
    {link && <><TextField label="Enlace de invitación" value={link} readOnly /><Button variant="outline" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Enlace copiado')).catch(() => toast.error('Selecciona y copia el enlace'))}>Copiar enlace</Button></>}
    {(create.isError || revoke.isError) && <ErrorState title="No se pudo actualizar la invitación" />}
    {(list.data?.data ?? []).map((invitation, index) => <div key={invitation.id} className="flex items-center justify-between gap-2 text-sm">
      <span>Invitación {index + 1} · {invitation.acceptedAt ? 'Aceptada' : 'Pendiente'}</span>
      <Button variant="ghost" onClick={() => setRevokeId(invitation.id)}>Revocar</Button>
    </div>)}
    <ConfirmDialog open={Boolean(revokeId)} onOpenChange={(open) => !open && setRevokeId(null)} title="Revocar invitación" description="Se retirará también el acceso concedido al aceptar este enlace." confirmLabel="Revocar" onConfirm={() => revoke.mutate()} />
  </div>
}
