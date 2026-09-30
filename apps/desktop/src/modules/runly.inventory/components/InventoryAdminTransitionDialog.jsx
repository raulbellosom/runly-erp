import { useEffect, useState } from 'react'
import {
  Button, DatePickerField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  FileUploader, SelectField, TextareaField,
} from '@runly/ui'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'
import { ADMIN_ACTIONS, DEREGISTRATION_REASONS } from '../lib/admin-status.js'
import { useInventoryAdminTransition } from '../hooks/useInventoryAdmin.js'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Asks for what an administrative action needs (reason, effective date,
// comment, evidence) and applies it to one item (`itemId`) or many (`ids`).
// No <form>: it can open over other dialogs/forms.
export function InventoryAdminTransitionDialog({ action, itemId = null, ids = null, itemLabel = '', open, onOpenChange, onDone }) {
  const { session } = useAuth()
  const token = session?.access_token
  const config = ADMIN_ACTIONS[action]
  const transition = useInventoryAdminTransition()
  const [values, setValues] = useState({ reason: '', effectiveDate: todayIso(), comment: '', file: null })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (open) { setValues({ reason: '', effectiveDate: todayIso(), comment: '', file: null }); setErrors({}) }
  }, [open, action])

  if (!config) return null
  const fields = config.fields
  const set = (key, value) => { setValues((v) => ({ ...v, [key]: value })); setErrors((e) => ({ ...e, [key]: '' })) }

  async function submit() {
    const next = {}
    if (fields.reason && !values.reason) next.reason = 'Elige el motivo'
    if (fields.effectiveDate && !values.effectiveDate) next.effectiveDate = 'Indica la fecha'
    if (fields.comment === 'required' && !values.comment.trim()) next.comment = 'Escribe el motivo del cambio'
    setErrors(next)
    if (Object.keys(next).length) return
    const body = {
      action,
      ...(fields.reason ? { reason: values.reason } : {}),
      ...(fields.effectiveDate ? { effectiveDate: values.effectiveDate } : {}),
      ...(values.comment.trim() ? { comment: values.comment.trim() } : {}),
      ...(values.file?.id ? { fileId: values.file.id } : {}),
    }
    try {
      const result = await transition.mutateAsync(ids ? { ids, ...body } : { id: itemId, ...body })
      if (ids) {
        if (result.failed) toast.warning(`${result.applied} aplicados, ${result.failed} no: ${result.results.find((r) => !r.ok)?.error ?? ''}`)
        else toast.success(`${config.label}: ${result.applied} activos`)
      } else {
        toast.success(`${config.label}: listo`)
      }
      onDone?.(result)
      onOpenChange(false)
    } catch (err) { toast.error(err?.message ?? 'No se pudo aplicar la acción.') }
  }

  const uploadEvidence = async (file) => {
    const form = new FormData()
    form.append('file', file)
    form.append('moduleKey', 'runly.inventory')
    form.append('entityType', 'InvItemAdminEvent')
    const res = await runly.files.upload(form, token)
    return res?.data ?? res
  }

  const target = ids ? `${ids.length} activos seleccionados` : itemLabel

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{target ? `${target}. ` : ''}{config.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          {fields.reason ? (
            <SelectField label="Motivo" required value={values.reason} placeholder="Elegir motivo" options={DEREGISTRATION_REASONS}
              onValueChange={(v) => set('reason', v)} error={errors.reason} />
          ) : null}
          {fields.effectiveDate ? (
            <DatePickerField label="Fecha efectiva" required value={values.effectiveDate} onChange={(v) => set('effectiveDate', v ?? '')} error={errors.effectiveDate} />
          ) : null}
          <TextareaField label={fields.comment === 'required' ? 'Comentario' : 'Comentario (opcional)'} required={fields.comment === 'required'}
            value={values.comment} maxLength={2000} onChange={(e) => set('comment', e.target.value)} error={errors.comment} />
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Evidencia (opcional)</p>
            <FileUploader value={values.file} onChange={(file) => set('file', file)} onUpload={uploadEvidence}
              accept="image/*,application/pdf" hint="Acta, foto o documento que respalde el cambio." emptyLabel="Adjuntar evidencia" />
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" variant={config.destructive ? 'destructive' : 'default'} disabled={transition.isPending} onClick={submit}>
            {transition.isPending ? 'Aplicando...' : config.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
