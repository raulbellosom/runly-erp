import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ActionMenu, Button } from '@runly/ui'
import { errorText, policyReasons, useTransition } from '../../hooks/usePurchases.js'
import { ROOT } from '../../lib/purchases-constants.js'
import { TransitionConfirmDialog } from './TransitionConfirmDialog.jsx'

const DONE = {
  submit: 'Documento enviado', approve: 'Aprobado', reject: 'Rechazado', issue: 'Orden emitida', close: 'Cerrado',
  cancel: 'Cancelado', reopen: 'Reabierto', convert: 'Orden creada desde la solicitud',
}

// Renders the actions from lib/document-actions.js on the dark hero: the
// first primary as a solid white button, one more visible, the rest in a menu.
export function DocumentActionBar({ kind, doc, actions, onDialog }) {
  const navigate = useNavigate()
  const transition = useTransition(kind, doc.id)
  const [pending, setPending] = useState(null)

  const run = async (action, payload = {}) => {
    try {
      const result = await transition.mutateAsync({ action: action.action, ...payload })
      toast.success(DONE[action.action] ?? 'Listo')
      setPending(null)
      if (action.opensResult && result?.id) navigate(`${ROOT}/${action.opensResult}/${result.id}`)
    } catch (error) {
      const reasons = policyReasons(error)
      toast.error(reasons.length ? `Bloqueado por política: ${reasons.map((r) => r.reason ?? r).join('; ')}` : errorText(error, 'No se pudo completar la acción'))
    }
  }

  const trigger = (action) => {
    if (action.type === 'edit') return navigate(`${ROOT}/${kind}/${doc.id}/edit`)
    if (action.type === 'navigate') return navigate(`${ROOT}/${action.to}`)
    if (action.type === 'dialog') return onDialog(action.dialog)
    if (action.confirm) return setPending(action)
    return run(action)
  }

  if (!actions.length) return null
  const visible = actions.filter((a) => a.tone !== 'danger').slice(0, 2)
  const rest = actions.filter((a) => !visible.includes(a))

  return (
    <>
      {visible.map((action, index) => (
        <Button key={action.key} disabled={transition.isPending} onClick={() => trigger(action)}
          className={index === 0 ? 'bg-white text-teal-900 hover:bg-white/90' : 'border border-white/30 bg-white/10 text-white hover:bg-white/20'}>
          {action.label}
        </Button>
      ))}
      {rest.length ? (
        <span className="text-white [&_button]:h-10 [&_button]:w-10 [&_button]:border [&_button]:border-white/30 [&_button]:bg-white/10 [&_button:hover]:bg-white/20 [&_button:hover]:text-white">
          <ActionMenu label="Más acciones" items={rest.map((a) => ({ label: a.label, onClick: () => trigger(a), variant: a.tone === 'danger' ? 'destructive' : undefined }))} />
        </span>
      ) : null}
      <TransitionConfirmDialog action={pending} open={Boolean(pending)} onOpenChange={(o) => { if (!o) setPending(null) }}
        loading={transition.isPending} onConfirm={(payload) => run(pending, payload)} />
    </>
  )
}
