import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Lock, Save, Send } from 'lucide-react'
import { AttachmentsPanel, Button, EmptyState, ErrorState, PageHeader, TextareaField, FormSkeleton } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { attachmentsConfig } from '../lib/attachments.js'
import { errorText, policyReasons, useCapabilities, useDocument, useNextNumber, usePurchasesCan, useSaveDocument, useTransition } from '../hooks/usePurchases.js'
import { usePurchaseRoute } from '../hooks/usePurchaseRoute.js'
import { SCHEMAS, defaultsFor, toPayload } from '../lib/document-schema.js'
import { lineFromApi } from '../lib/document-math.js'
import { KINDS, ROOT } from '../lib/purchases-constants.js'
import { HeaderFields } from '../components/editor/HeaderFields.jsx'
import { LineItemsEditor } from '../components/editor/LineItemsEditor.jsx'
import { TotalsCard } from '../components/editor/TotalsCard.jsx'
import { LinkedInventoryCard } from '../components/editor/LinkedInventoryCard.jsx'
import { LinkedOrdersField } from '../components/editor/LinkedOrdersField.jsx'

const EDITABLE = ['orders', 'invoices', 'requests']

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-sm md:p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p> : null}
      </header>
      {children}
    </section>
  )
}

function policyMessage(error, fallback) {
  const reasons = policyReasons(error)
  if (reasons.length) return `${fallback}: ${reasons.map((r) => r.reason ?? r).join('; ')}`
  return errorText(error, fallback)
}

// Full-page editor for orders, invoices and requests. Accepts
// ?inventoryId= (repeatable), ?orderId= (invoices) and ?caseId=.
export default function PurchaseDocumentEditor() {
  const navigate = useNavigate()
  const { section, id, isEdit, searchParams } = usePurchaseRoute()
  const kind = EDITABLE.includes(section) ? section : 'orders'
  const meta = KINDS[kind]
  const caps = useCapabilities()
  const can = usePurchasesCan()
  const existing = useDocument(kind, isEdit ? id : null)
  const orderId = kind === 'invoices' && !isEdit ? searchParams.get('orderId') : null
  const sourceOrder = useDocument('orders', orderId)
  const urlInventoryIds = useMemo(() => [...new Set(searchParams.getAll('inventoryId').filter(Boolean))], [searchParams])

  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  // New documents stage files locally; they upload once the draft exists.
  const attachments = useRef(null)
  const save = useSaveDocument(kind)
  const transition = useTransition(kind, id)
  const [supplier, setSupplier] = useState(null)
  const [knownItems, setKnownItems] = useState({})
  const form = useForm({
    resolver: zodResolver(SCHEMAS[kind]),
    defaultValues: defaultsFor(kind, { inventoryIds: urlInventoryIds, caseId: searchParams.get('caseId') }),
  })
  const { control, handleSubmit, reset, getValues, setValue, formState: { errors, isDirty } } = form
  const lines = useWatch({ control, name: 'lines' })
  const currency = useWatch({ control, name: 'currency' })
  const supplierId = useWatch({ control, name: 'supplierId' })
  const inheritItems = useWatch({ control, name: 'inheritItems' })
  const issueDate = useWatch({ control, name: 'issueDate' })
  // Invoices carry the supplier folio; orders and requests get a suggestion.
  const suggested = useNextNumber(kind, issueDate || undefined, !isEdit && kind !== 'invoices')
  const folio = isEdit ? { sequence: existing.data?.sequence } : suggested.data

  // Load the draft being edited, or prefill an invoice from its order, once.
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    if (isEdit && existing.data) {
      reset(defaultsFor(kind, { doc: existing.data }))
      setSupplier(existing.data.supplier ?? null)
      loaded.current = true
    } else if (orderId && sourceOrder.data) {
      const order = sourceOrder.data
      reset({
        ...defaultsFor(kind, { inventoryIds: urlInventoryIds, caseId: order.caseId }),
        supplierId: order.supplierId ?? null,
        currency: order.currency ?? 'MXN',
        lines: (order.lines ?? []).map(({ id: _omit, ...line }) => lineFromApi(line)),
        orderIds: [order.id],
      })
      setSupplier(order.supplier ?? null)
      loaded.current = true
    }
  }, [isEdit, existing.data, orderId, sourceOrder.data, kind, reset, urlInventoryIds])

  const submit = (andSubmit) => handleSubmit(async (values) => {
    let saved
    try {
      saved = await save.mutateAsync({ id: isEdit ? id : null, data: toPayload(kind, values, { isEdit }) })
    } catch (error) {
      toast.error(policyMessage(error, 'No se pudo guardar'))
      return
    }
    const targetId = saved?.id ?? id
    if (!isEdit && targetId && attachments.current?.pendingItems?.length) {
      const upload = await attachments.current.flushPending(targetId)
      if (!upload?.ok) toast.error('El documento se guardó, pero algunos archivos no se pudieron subir. Súbelos desde el detalle.')
    }
    if (andSubmit && targetId) {
      try {
        await transition.mutateAsync({ action: 'submit', targetId })
        toast.success(`${meta.short} enviada`)
      } catch (error) {
        toast.error(policyMessage(error, 'Se guardó como borrador, pero no se pudo enviar'))
      }
    } else {
      toast.success(isEdit ? 'Cambios guardados' : `${meta.short} guardada como borrador`)
    }
    navigate(`${ROOT}/${kind}/${targetId}`, { replace: true })
  }, () => toast.error('Revisa los campos marcados'))

  const backTo = isEdit ? `${ROOT}/${kind}/${id}` : `${ROOT}/${kind}`
  const shell = (node) => <div className="min-h-dvh p-4 md:p-6">{node}</div>

  if (caps.isLoading || (isEdit && existing.isLoading) || (orderId && sourceOrder.isLoading)) return shell(<FormSkeleton sections={3} />)
  if (!caps.has(meta.capability)) {
    return shell(<EmptyState icon={meta.icon} title="Esta etapa no está activa" description="Tu flujo de compras no usa este tipo de documento." />)
  }
  if (!can(isEdit ? meta.update : meta.create)) {
    return shell(<EmptyState icon={Lock} title="Sin permiso" description="Tu rol no permite registrar este tipo de documento." />)
  }
  if (isEdit && existing.isError) return shell(<ErrorState title="No se pudo cargar el documento" onRetry={() => existing.refetch()} />)
  if (isEdit && existing.data && existing.data.status !== 'DRAFT') {
    return shell(
      <EmptyState icon={Lock} title="Este documento ya no se puede editar"
        description="Solo los borradores se editan. Usa las acciones del detalle para avanzar o cancelar."
        action={{ label: "Ver detalle", onClick: () => navigate(backTo) }} />,
    )
  }

  const title = isEdit ? `Editar ${existing.data?.number ?? meta.short.toLowerCase()}` : meta.newLabel ?? `Nueva ${meta.short.toLowerCase()}`
  const showInventory = caps.has('inventoryRelations') && kind !== 'requests' && !isEdit
  const busy = save.isPending || transition.isPending

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader eyebrow={meta.singular} title={title} onBack={() => navigate(backTo)}
        description={kind === 'invoices' ? 'Captura la factura tal como la emitió tu proveedor.' : kind === 'requests' ? 'Describe lo que se necesita; se convertirá en orden al aprobarse.' : 'La orden se guarda como borrador hasta que la envíes.'} />

      <form onSubmit={(e) => e.preventDefault()} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          <Section title="Datos generales">
            <HeaderFields kind={kind} control={control} supplier={supplier} onSupplier={setSupplier} folio={folio} />
          </Section>

          {kind === 'invoices' && caps.has('purchaseOrders') ? (
            <Section title="Órdenes relacionadas" description="Vincula la factura con las órdenes que cobra.">
              <Controller control={control} name="orderIds" render={({ field }) => (
                <LinkedOrdersField value={field.value} onChange={field.onChange} supplierId={supplierId}
                  known={sourceOrder.data ? { [sourceOrder.data.id]: sourceOrder.data } : Object.fromEntries((existing.data?.orders ?? []).map((o) => [o.id, o]))}
                  invoiceId={isEdit ? id : undefined}
                  inherit={Boolean(inheritItems)} onInheritChange={(v) => setValue('inheritItems', v, { shouldDirty: true })} />
              )} />
            </Section>
          ) : null}

          <Section title="Conceptos" description="Bienes y servicios, con su cantidad, precio e impuesto.">
            <LineItemsEditor control={control} getValues={getValues} errors={errors} currency={currency} />
          </Section>

          {showInventory ? (
            <Controller control={control} name="inventoryIds" render={({ field }) => (
              <LinkedInventoryCard ids={field.value} onChange={field.onChange} known={knownItems}
                onKnown={(items) => setKnownItems((k) => ({ ...k, ...Object.fromEntries(items.map((i) => [i.id, i])) }))} />
            )} />
          ) : null}

          <Section title="Archivos" description={kind === 'invoices' ? 'PDF y XML de la factura, comprobantes y evidencias.' : 'Cotizaciones, fichas técnicas, fotos o cualquier respaldo.'}>
            <AttachmentsPanel apiBaseUrl={getApiUrl()} token={session?.access_token} companyId={activeCompanyId}
              recordId={isEdit ? id : null} config={{ ...attachmentsConfig(meta.entityType), placement: 'embedded' }}
              context="form" showHeading={false} onControllerReady={(controller) => { attachments.current = controller }} />
          </Section>

          <Section title="Notas internas">
            <Controller control={control} name="notes" render={({ field }) => (
              <TextareaField rows={3} placeholder="Instrucciones de entrega, acuerdos o aclaraciones." maxLength={2000} {...field} value={field.value ?? ''} />
            )} />
          </Section>
        </div>

        <TotalsCard lines={lines} currency={currency} title={kind === 'requests' ? 'Monto estimado' : 'Total del documento'}
          footnote={kind === 'requests' ? 'El estimado ayuda a decidir si se requiere aprobación o cotizaciones.' : null}>
          <Button type="button" disabled={busy} onClick={submit(true)} className="w-full">
            <Send className="h-4 w-4" />{kind === 'invoices' ? 'Guardar y registrar' : 'Guardar y enviar'}
          </Button>
          <Button type="button" variant="outline" disabled={busy || (isEdit && !isDirty)} onClick={submit(false)} className="w-full">
            <Save className="h-4 w-4" />{busy ? 'Guardando...' : 'Guardar borrador'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(backTo)} className="w-full">Cancelar</Button>
        </TotalsCard>
      </form>
    </div>
  )
}
