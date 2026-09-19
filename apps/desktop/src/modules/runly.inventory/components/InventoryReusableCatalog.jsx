import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, DataTable, Sheet, SheetContent, SheetHeader, SheetTitle, TextField, TextareaField, ErrorState } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'

const COLUMNS = [{ accessorKey: 'name', header: 'Nombre' }, { accessorKey: 'details.brandName', header: 'Marca' }, { accessorKey: 'details.description', header: 'Descripción' }]
export function InventoryReusableCatalog({ kind }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const request = body => intakeRequest({ apiBaseUrl: getApiUrl(), token: session?.access_token, companyId: activeCompanyId, path: `/inventory/${kind}`, body })
  const query = useQuery({ queryKey: ['inventory', kind, activeCompanyId], queryFn: () => request(), enabled: Boolean(session?.access_token && activeCompanyId) })
  async function save() {
    setSaving(true); setError('')
    try { await request({ name, description }); await qc.invalidateQueries({ queryKey: ['inventory', kind] }); setOpen(false); setName(''); setDescription('') }
    catch (error) { setError(error.message) }
    finally { setSaving(false) }
  }
  return <div className="space-y-3"><div className="flex justify-end"><Button onClick={() => setOpen(true)}>Nuevo {kind === 'models' ? 'modelo' : 'tipo'}</Button></div>
    <DataTable columns={COLUMNS} data={query.data ?? []} isLoading={query.isPending} isError={query.isError} onRetry={() => query.refetch()} emptyTitle="Sin registros" />
    <Sheet open={open} onOpenChange={setOpen}><SheetContent><SheetHeader><SheetTitle>Nuevo {kind === 'models' ? 'modelo' : 'tipo'}</SheetTitle></SheetHeader><TextField label="Nombre" value={name} onChange={event => setName(event.target.value)} maxLength={kind === 'types' ? 50 : 255} /><TextareaField label="Descripción" value={description} onChange={event => setDescription(event.target.value)} />{error && <ErrorState title="No se pudo guardar" description={error} />}<Button disabled={saving || !name.trim()} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</Button></SheetContent></Sheet>
  </div>
}
