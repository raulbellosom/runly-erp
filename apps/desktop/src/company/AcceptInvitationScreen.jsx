import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, ErrorState, PageHeader } from '@runly/ui'
import { useAuth } from '../auth/AuthProvider'
import { runly } from '../lib/runly'

export function AcceptInvitationScreen() {
  const [params] = useSearchParams()
  const { session, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invitationToken = params.get('token')
  const accept = useMutation({
    mutationFn: () => runly.collaboration.acceptInvitation(invitationToken, session.access_token),
    onSuccess: async ({ data }) => {
      queryClient.clear()
      if (data.resourceType === 'company') localStorage.setItem('runly-active-company', data.resourceId)
      await refreshProfile(session)
      const path = data.resourceType === 'company' ? '/app' : `/app/shared/${data.resourceType}/${data.resourceId}`
      navigate(path, { replace: true })
    },
  })
  return <main className="mx-auto max-w-xl p-6">
    <PageHeader title="Invitación a Runly" />
    <Card className="mt-6 space-y-4 p-6">
      <p>Al aceptar obtendrás acceso a la empresa o al recurso que compartieron contigo.</p>
      {(!invitationToken || accept.isError) && <ErrorState title="Invitación no disponible" description="Comprueba que usas la cuenta invitada. El enlace puede haber caducado o haber sido revocado." />}
      <Button disabled={!invitationToken || accept.isPending} onClick={() => accept.mutate()}>
        {accept.isPending ? 'Aceptando…' : 'Aceptar invitación'}
      </Button>
    </Card>
  </main>
}
