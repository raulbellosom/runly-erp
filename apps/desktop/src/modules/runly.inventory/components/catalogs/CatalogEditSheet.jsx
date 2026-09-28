import { Button, Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@runly/ui'

export function CatalogEditSheet({ open, onOpenChange, title, busy, saveDisabled, onSave, children }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
        <SheetFooter className="shrink-0 border-t border-[hsl(var(--border))] px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button type="button" onClick={onSave} disabled={busy || saveDisabled}>{busy ? 'Guardando...' : 'Guardar'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
