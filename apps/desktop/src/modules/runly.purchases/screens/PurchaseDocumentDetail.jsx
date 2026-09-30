import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActivityTimeline, AttachmentsPanel, EmptyState, ErrorState, LoadingState, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@runly/ui'
import { FileX } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly.js'
import { useCapabilities, useDocument, usePurchasesCan } from '../hooks/usePurchases.js'
import { usePurchaseRoute } from '../hooks/usePurchaseRoute.js'
import { KINDS, PAYMENT_METHODS, PRIORITY_OPTIONS, ROOT, docPath } from '../lib/purchases-constants.js'
import { getDocumentActions } from '../lib/document-actions.js'
import { attachmentsConfig } from '../lib/attachments.js'
import { DocumentHero, dateFact } from '../components/detail/DocumentHero.jsx'
import { DocumentActionBar } from '../components/detail/DocumentActionBar.jsx'
import { PolicyAlerts } from '../components/detail/PolicyAlerts.jsx'
import { LinesPanel } from '../components/detail/LinesPanel.jsx'
import { InventoryRelationsPanel, isInventoryRelation } from '../components/detail/InventoryRelationsPanel.jsx'
import { RelatedDocumentsPanel, collectRelated } from '../components/detail/RelatedDocumentsPanel.jsx'
import { QuotesCompare } from '../components/detail/QuotesCompare.jsx'
import { ReceiveOrderDialog } from '../components/detail/ReceiveOrderDialog.jsx'
import { PaymentDialog } from '../components/detail/PaymentDialog.jsx'
import { CreateInventoryFromLineDialog } from '../components/detail/CreateInventoryFromLineDialog.jsx'

const DETAIL_KINDS = ['orders', 'invoices', 'requests', 'receipts', 'cases']
const label = (options, value) => options.find((o) => o.value === value)?.label

function factsFor(kind, d) {
  if (kind === 'orders') return [dateFact('Fecha', d.issueDate), dateFact('Entrega esperada', d.expectedDate), { label: 'Referencia del proveedor', value: d.supplierReference }, { label: 'Condiciones de pago', value: d.paymentTerms }, dateFact('Emitida', d.issuedAt)]
  if (kind === 'invoices') return [dateFact('Emisión', d.issueDate), dateFact('Vence', d.dueDate), { label: 'UUID fiscal', value: d.fiscalUuid }, { label: 'Forma de pago', value: label(PAYMENT_METHODS, d.paymentMethod) }, dateFact('Pagada', d.paidAt)]
  if (kind === 'requests') return [dateFact('Se necesita', d.neededBy), { label: 'Prioridad', value: label(PRIORITY_OPTIONS, d.priority) }, { label: 'Solicitante', value: d.requesterName ?? d.requester?.name }, dateFact('Creada', d.createdAt)]
  if (kind === 'receipts') return [dateFact('Recibida', d.receivedAt), { label: 'Orden', value: d.orderNumber ?? d.order?.number }, { label: 'Recibió', value: d.receivedByName }]
  return [dateFact('Abierto', d.createdAt), dateFact('Cerrado', d.closedAt)]
}

// Detail for orders, invoices, requests, receipts and cases: hero with the
// process track, policy alerts, then tabs. Tabs for disabled capabilities
// or missing permissions are not rendered.
export default function PurchaseDocumentDetail() {
  const navigate = useNavigate()
  const { section, id } = usePurchaseRoute()
  const kind = DETAIL_KINDS.includes(section) ? section : 'orders'
  const meta = KINDS[kind]
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const caps = useCapabilities()
  const can = usePurchasesCan()
  const query = useDocument(kind, id)
  const [dialog, setDialog] = useState(null)
  const [lineForItems, setLineForItems] = useState(null)
  const doc = query.data

  const actions = useMemo(() => getDocumentActions(kind, doc, { has: caps.has, can }), [kind, doc, caps.has, can])
  const shell = (node) => <div className="min-h-dvh p-4 md:p-6">{node}</div>
  if (query.isLoading || caps.isLoading) return shell(<LoadingState />)
  if (query.isError) {
    return shell(query.error?.status === 404
      ? <EmptyState icon={FileX} title={`${meta.short} no encontrada`} description="Puede que se haya eliminado o pertenezca a otra empresa." />
      : <ErrorState title="No se pudo cargar el documento" onRetry={() => query.refetch()} />)
  }
  if (!doc) return shell(<EmptyState icon={FileX} title={`${meta.short} no encontrada`} />)

  const inventoryOn = caps.has('inventoryRelations') && ['orders', 'invoices', 'receipts'].includes(kind)
  const canManageRelations = can('purchases.relation.manage') && doc.status !== 'CANCELLED'
  const quotesOn = caps.has('quotes') && ['requests', 'cases'].includes(kind) && can('purchases.quote.read')
  const filesOn = ['orders', 'invoices', 'receipts'].includes(kind) || (kind === 'requests')
  const related = collectRelated(doc)
  const inventoryCount = (doc.relations ?? []).filter(isInventoryRelation).length
  const policyMin = (doc.policyCheck?.requirements ?? []).find((r) => r.stage === 'QUOTES')?.min

  const tabs = [
    kind !== 'cases' && { value: 'lines', label: 'Conceptos', count: doc.lines?.length },
    kind === 'cases' && { value: 'related', label: 'Documentos', count: related.reduce((n, g) => n + g.rows.length, 0) },
    quotesOn && { value: 'quotes', label: 'Cotizaciones', count: doc.quotes?.length },
    inventoryOn && { value: 'inventory', label: 'Inventario', count: inventoryCount },
    kind !== 'cases' && { value: 'related', label: 'Relacionados', count: related.reduce((n, g) => n + g.rows.length, 0) },
    filesOn && { value: 'files', label: 'Archivos' },
    { value: 'activity', label: 'Actividad' },
  ].filter(Boolean)

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader compact eyebrow="Compras" title={meta.plural} onBack={() => navigate(`${ROOT}/${kind}`)} backLabel={`Volver a ${meta.plural.toLowerCase()}`} />

      <DocumentHero kind={kind} doc={doc} facts={factsFor(kind, doc).filter((f) => f.value)}
        onOpenRef={(ref) => { const path = docPath(ref.type, ref.id); if (path) navigate(path) }}
        actions={<DocumentActionBar kind={kind} doc={doc} actions={actions} onDialog={setDialog} />} />

      <PolicyAlerts policyCheck={doc.policyCheck} />

      {doc.notes || doc.justification || doc.description ? (
        <p className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">{doc.justification ?? doc.description ?? doc.notes}</p>
      ) : null}

      <Tabs defaultValue={tabs[0].value} className="space-y-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                {t.label}{t.count ? <span className="rounded-full bg-teal-500/15 px-1.5 text-[11px] tabular-nums text-teal-700 dark:text-teal-300">{t.count}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="lines">
          <LinesPanel kind={kind} doc={doc} onCreateItems={setLineForItems}
            canCreateItems={inventoryOn && kind !== 'receipts' && can('inventory.item.create') && doc.status !== 'DRAFT' && doc.status !== 'CANCELLED'} />
        </TabsContent>
        <TabsContent value="related"><RelatedDocumentsPanel doc={doc} /></TabsContent>
        {quotesOn ? (
          <TabsContent value="quotes">
            <QuotesCompare quotes={doc.quotes ?? []} caseId={kind === 'cases' ? doc.id : doc.caseId} requestId={kind === 'requests' ? doc.id : null}
              currency={doc.currency} minRequired={policyMin} canManage={can('purchases.quote.manage') && !['CLOSED', 'CANCELLED'].includes(doc.status)} />
          </TabsContent>
        ) : null}
        {inventoryOn ? (
          <TabsContent value="inventory"><InventoryRelationsPanel entityType={meta.entityType} doc={doc} canManage={canManageRelations} /></TabsContent>
        ) : null}
        {filesOn ? (
          <TabsContent value="files">
            <AttachmentsPanel apiBaseUrl={getApiUrl()} token={session?.access_token} companyId={activeCompanyId} recordId={doc.id}
              config={attachmentsConfig(meta.entityType)} context="detail" readOnly={!can(meta.update)} showHeading={false} showViewToggle />
          </TabsContent>
        ) : null}
        <TabsContent value="activity">
          <ActivityTimeline sdk={runly} token={session?.access_token} entityType={meta.entityType} entityId={doc.id} limit={50}
            heightClass="max-h-[520px]" emptyMessage="Sin actividad registrada para este documento." />
        </TabsContent>
      </Tabs>

      {kind === 'orders' ? <ReceiveOrderDialog order={doc} open={dialog === 'receive'} onOpenChange={(o) => setDialog(o ? 'receive' : null)} /> : null}
      {kind === 'invoices' ? <PaymentDialog invoice={doc} open={dialog === 'pay'} onOpenChange={(o) => setDialog(o ? 'pay' : null)} /> : null}
      <CreateInventoryFromLineDialog line={lineForItems} open={Boolean(lineForItems)} onOpenChange={(o) => { if (!o) setLineForItems(null) }} />
    </div>
  )
}
