import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@runly/ui'
import { Plug } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'
import { moduleKeyFromPath, useCurrentMiraiRecord } from '../../modules/runly.chat/lib/miraiPageContext.js'
import { ConnectionSections } from './ConnectionSections.jsx'
import { recordConnectionTarget, useHasConnectionSlot } from './recordConnectionTarget.js'

// Shell-level "Conexiones" button (spec 2026-10-03-rme3-module-platform-v2 §5
// goal 6): any core screen that publishes a connectable record through
// useMiraiRecordContext but renders no ConnectionSections of its own gets the
// connected sections in a Sheet, with zero per-screen code.
export function RecordConnectionsButton() {
  const { pathname } = useLocation()
  const record = useCurrentMiraiRecord()
  const hasSlot = useHasConnectionSlot()
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const [open, setOpen] = useState(false)
  const token = session?.access_token
  const target = recordConnectionTarget(moduleKeyFromPath(pathname), record)
  const enabled = Boolean(token && target && !hasSlot)

  // Same key as ConnectionSections, so opening the Sheet reuses this result.
  const { data: sections = [] } = useQuery({
    queryKey: ['connections', 'records', target?.targetType, target?.targetId, 'detail', activeCompanyId],
    queryFn: async () => (await runly.connections.records(target.targetType, target.targetId, 'detail', token))?.data ?? [],
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  if (!enabled || !sections.length) return null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="absolute bottom-4 left-4 z-20 rounded-full shadow-md"
        onClick={() => setOpen(true)}
      >
        <Plug className="h-4 w-4" />
        Conexiones
        <span className="text-xs text-muted-foreground">{sections.length}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
            <SheetTitle>Conexiones</SheetTitle>
            <SheetDescription>{record?.label || 'Datos de otros módulos para este registro.'}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ConnectionSections targetType={target.targetType} targetId={target.targetId} asSlot={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
