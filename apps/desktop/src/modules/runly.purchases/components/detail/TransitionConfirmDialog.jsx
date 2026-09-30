import { useEffect, useState } from 'react'
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextareaField } from '@runly/ui'

// Confirmation before a transition; with `comment` it also asks why
// (reject, cancel), and passes { comment } to onConfirm.
export function TransitionConfirmDialog({ action, open, onOpenChange, onConfirm, loading }) {
  const [comment, setComment] = useState('')
  useEffect(() => { if (open) setComment('') }, [open])
  const confirm = action?.confirm
  if (!confirm) return null

  if (!confirm.comment) {
    return (
      <ConfirmDialog open={open} onOpenChange={onOpenChange} title={confirm.title} description={confirm.description}
        confirmLabel={confirm.confirmLabel ?? action.label} cancelLabel="Volver" loading={loading} onConfirm={() => onConfirm({})} />
    )
  }

  const danger = action.tone === 'danger'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader className="shrink-0">
          <DialogTitle>{confirm.title}</DialogTitle>
          <DialogDescription>{confirm.description}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-0.5">
          <TextareaField label="Motivo" required={action.action === 'reject'} rows={3} maxLength={1000} value={comment}
            onChange={(e) => setComment(e.target.value)} placeholder="Queda en el historial del documento." />
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Volver</Button>
          <Button variant={danger ? 'destructive' : 'default'} disabled={loading || (action.action === 'reject' && !comment.trim())}
            onClick={() => onConfirm({ comment: comment.trim() || undefined })}>
            {loading ? 'Guardando...' : confirm.confirmLabel ?? action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
