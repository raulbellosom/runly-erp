import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, ChevronRight, FileText, Send, Eye, Code2, Trash2 } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Card, TextField, ComboboxField, PageHeader, EmptyState,
  ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent,
  LoadingState, ErrorState, SwitchField,
} from '@runly/ui'
import { toast } from 'sonner'
import FormFieldBuilder from './FormFieldBuilder.jsx'
import FormSubmissionsPanel from './FormSubmissionsPanel.jsx'
import FormSettingsPanel from './FormSettingsPanel.jsx'
import FormPreview from './FormPreview.jsx'
import FormApiPanel from './FormApiPanel.jsx'

async function apiGet(path, token) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Copy-to-clipboard button ────────────────────────────────────────────────
function CopyButton({ text, label = 'Copiar', size = 'sm' }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const isSmall = size === 'sm'

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copiar: ${text}`}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border transition-colors font-medium',
        isSmall
          ? 'text-xs px-2 py-1'
          : 'text-sm px-3 py-1.5',
        copied
          ? 'border-green-500/40 bg-green-500/10 text-green-500'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]',
      ].join(' ')}
    >
      {copied
        ? <><Check size={isSmall ? 11 : 13} />{label ? ' Copiado' : ''}</>
        : <><Copy size={isSmall ? 11 : 13} />{label ? ` ${label}` : ''}</>
      }
    </button>
  )
}

// ── Integration tip (collapsible code snippet) ──────────────────────────────
function CodeBlock({ code, label }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-[hsl(var(--background))] border border-[hsl(var(--border))] px-3 py-2">
      <code className="flex-1 text-xs font-mono text-[hsl(var(--foreground))] break-all select-all leading-relaxed whitespace-pre">
        {code}
      </code>
      <CopyButton text={code} label={label ?? 'Copiar'} />
    </div>
  )
}

function IntegrationTip({ formId, formName }) {
  const [open, setOpen] = useState(false)

  const slug = (formName ?? 'miFormulario')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '')

  const configLine = `  ${slug}: '${formId}',`
  const importLine = `import { FORMS } from '../config/forms'`
  const usageLine  = `<DynamicForm formId={FORMS.${slug}} client:load />`

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
      >
        <Code2 size={14} />
        <span className="font-medium">Cómo usar en tu sitio web</span>
        <ChevronRight
          size={14}
          className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-[hsl(var(--border))] p-4 space-y-4 bg-[hsl(var(--muted)/0.4)]">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
              1. Agrega el ID a <code className="font-mono normal-case bg-[hsl(var(--muted))] px-1 rounded">src/config/forms.ts</code>
            </p>
            <CodeBlock
              code={`export const FORMS = {\n${configLine}\n  // ... otros formularios\n}`}
              label="Copiar"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
              2. Usa el componente en tu página Astro
            </p>
            <CodeBlock
              code={`${importLine}\n\n${usageLine}`}
              label="Copiar"
            />
          </div>

          <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            Los IDs de formulario son identificadores públicos — no van en <code className="font-mono">.env</code>.
            Todos los formularios del sitio se gestionan desde <code className="font-mono">src/config/forms.ts</code>.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Form list card ───────────────────────────────────────────────────────────
function FormCard({ form, active, onClick }) {
  const fieldCount = form._count?.fields ?? 0
  const subCount   = form._count?.submissions ?? 0
  const shortId    = form.id.split('-')[0]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={[
        'w-full text-left rounded-xl border p-3.5 cursor-pointer',
        active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] shadow-sm'
          : 'border-[hsl(var(--border))]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-sm font-semibold leading-tight truncate ${active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'}`}>
          {form.name}
        </span>
        {form.wizardMode
          ? <span className="text-[10px] font-semibold shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500 border border-violet-500/20">WIZARD</span>
          : <FileText size={13} className={`shrink-0 mt-0.5 ${active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} />
        }
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span>{fieldCount} campo{fieldCount !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Send size={10} />
            {subCount}
          </span>
        </div>

        <div onClick={e => e.stopPropagation()}>
          <CopyButton text={form.id} label="" size="sm" />
        </div>
      </div>
    </div>
  )
}

// ── Form detail header ───────────────────────────────────────────────────────
function FormDetailHeader({ form, onDelete }) {
  const shortId = form.id.split('-')[0]

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-[hsl(var(--foreground))] truncate">{form.name}</h2>
          {form.description && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5 line-clamp-1">{form.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 shrink-0 text-xs text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.1)] px-2.5 py-1.5 rounded-md transition-colors"
        >
          <Trash2 size={12} />
          Eliminar
        </button>
      </div>

      {/* ID row */}
      <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] px-3 py-2">
        <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide shrink-0">ID</span>
        <code className="flex-1 text-xs font-mono text-[hsl(var(--foreground))] truncate select-all" title={form.id}>
          {form.id}
        </code>
        <CopyButton text={form.id} label="Copiar ID" size="sm" />
      </div>

      <IntegrationTip formId={form.id} formName={form.name} />
    </div>
  )
}

// ── New form dialog ──────────────────────────────────────────────────────────
const NEW_FORM_DEFAULTS = {
  name: '', description: '', submitLabel: 'Enviar', successMessage: '',
  notifyEmail: '', createsLead: true, defaultAssigneeUserId: '',
  honeypotEnabled: true, turnstileRequired: false, wizardMode: false,
}

function NewFormDialog({ open, onOpenChange, siteId, token, assignees, turnstileConfigured, onCreated }) {
  const queryClient = useQueryClient()
  const [data, setData] = useState(NEW_FORM_DEFAULTS)
  const set = (key, val) => setData(d => ({ ...d, [key]: val }))

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(`${getApiUrl()}/website/forms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data, siteId,
          description:           data.description.trim()    || undefined,
          successMessage:        data.successMessage.trim() || undefined,
          notifyEmail:           data.notifyEmail.trim()    || null,
          defaultAssigneeUserId: data.defaultAssigneeUserId || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: (form) => {
      toast.success('Formulario creado')
      queryClient.invalidateQueries({ queryKey: ['website-forms', siteId] })
      setData(NEW_FORM_DEFAULTS)
      onCreated(form.id)
    },
    onError: err => toast.error(err.message || 'Error al crear formulario'),
  })

  return (
    <Dialog open={open} onOpenChange={open => { onOpenChange(open); if (!open) setData(NEW_FORM_DEFAULTS) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo formulario</DialogTitle>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); mutation.mutate() }} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Nombre"
              value={data.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Formulario de contacto"
              required
              autoFocus
            />
            <TextField
              label="Botón de envío"
              value={data.submitLabel}
              onChange={e => set('submitLabel', e.target.value)}
            />
          </div>
          <TextField
            label="Descripción (opcional)"
            value={data.description}
            onChange={e => set('description', e.target.value)}
          />
          <TextField
            label="Mensaje de éxito (opcional)"
            value={data.successMessage}
            onChange={e => set('successMessage', e.target.value)}
            placeholder="Gracias, nos pondremos en contacto pronto."
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Notificar por email"
              type="email"
              value={data.notifyEmail}
              onChange={e => set('notifyEmail', e.target.value)}
              placeholder="tu@empresa.com"
            />
            <ComboboxField
              label="Responsable"
              options={[
                { value: '', label: 'Sin responsable' },
                ...assignees.map(a => ({ value: a.id, label: a.displayName })),
              ]}
              value={data.defaultAssigneeUserId}
              onChange={v => set('defaultAssigneeUserId', v)}
              placeholder="Seleccionar..."
              searchPlaceholder="Buscar..."
            />
          </div>
          <div className="rounded-lg border border-[hsl(var(--border))] p-3 space-y-2">
            <SwitchField
              id="nf-lead"
              label="Crear lead automáticamente"
              description="Registra cada envío como lead en runly.growth"
              checked={data.createsLead}
              onChange={v => set('createsLead', v)}
            />
            <SwitchField
              id="nf-honeypot"
              label="Activar honeypot anti-spam"
              description="Campo oculto que atrapa bots"
              checked={data.honeypotEnabled}
              onChange={v => set('honeypotEnabled', v)}
            />
            <SwitchField
              id="nf-turnstile"
              label="Requerir Turnstile (CAPTCHA)"
              description={turnstileConfigured ? 'Anti-bot de Cloudflare' : 'Configura las claves en Ajustes primero'}
              checked={data.turnstileRequired}
              disabled={!turnstileConfigured}
              onChange={v => set('turnstileRequired', v)}
            />
            <SwitchField
              id="nf-wizard"
              label="Modo paso a paso (wizard)"
              description="Divide el formulario en pasos numerados. Configura el paso de cada campo después."
              checked={data.wizardMode}
              onChange={v => set('wizardMode', v)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending || !data.name.trim()}>
              {mutation.isPending ? 'Creando...' : 'Crear formulario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function WebsiteFormsScreen() {
  const { session } = useAuth()
  const token = session?.access_token
  const queryClient = useQueryClient()

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedFormId = searchParams.get('form')
  function setSelectedFormId(id) {
    setSearchParams(id ? { form: id } : {}, { replace: true })
  }
  const [activeTab, setActiveTab] = useState('campos')
  const [newFormOpen, setNewFormOpen]       = useState(false)
  const [deleteTarget, setDeleteTarget]     = useState(null)

  // ── Queries ────────────────────────────────────────────────────────────────
  const siteQuery = useQuery({
    queryKey: ['website-site', token],
    queryFn: () => apiGet('/website/site', token),
    enabled: Boolean(token),
    staleTime: 60_000,
  })
  const siteId = siteQuery.data?.data?.id ?? null
  const turnstileConfigured = Boolean(
    siteQuery.data?.data?.turnstileSiteKey && siteQuery.data?.data?.turnstileSecretKeySet,
  )

  const formsQuery = useQuery({
    queryKey: ['website-forms', siteId, token],
    queryFn: () => apiGet(`/website/forms?siteId=${siteId}`, token),
    enabled: Boolean(token) && Boolean(siteId),
    staleTime: 30_000,
  })
  const forms = formsQuery.data?.data ?? []
  const activeFormId = selectedFormId ?? forms[0]?.id ?? null

  const formDetailQuery = useQuery({
    queryKey: ['website-form-detail', activeFormId, token],
    queryFn: () => apiGet(`/website/forms/${activeFormId}`, token),
    enabled: Boolean(token) && Boolean(activeFormId),
    staleTime: 15_000,
  })
  const formDetail = formDetailQuery.data ?? null

  const { data: assigneesData } = useQuery({
    queryKey: ['website-form-assignees', token],
    queryFn: () => apiGet('/website/form-assignees', token),
    enabled: Boolean(token),
    staleTime: 60_000,
  })
  const assignees = assigneesData?.data ?? []

  // ── Delete mutation ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (formId) => {
      const res = await companyFetch(`${getApiUrl()}/website/forms/${formId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Error al eliminar')
    },
    onSuccess: () => {
      toast.success('Formulario eliminado')
      setSelectedFormId(null)
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['website-forms', siteId] })
    },
    onError: () => { toast.error('Error al eliminar'); setDeleteTarget(null) },
  })

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (siteQuery.isPending) return <LoadingState variant="page" />

  if (siteQuery.isError || formsQuery.isError) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          title="No se pudieron cargar los formularios"
          message={(siteQuery.error ?? formsQuery.error)?.message}
          onRetry={() => { siteQuery.refetch(); formsQuery.refetch() }}
        />
      </div>
    )
  }

  if (!siteId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader eyebrow="Runly Website" title="Formularios" />
        <EmptyState title="Sitio web no configurado" description='Configura tu sitio primero en la sección "Sitio web".' />
      </div>
    )
  }

  const selectedForm = forms.find(f => f.id === activeFormId) ?? null
  const subCount = selectedForm?._count?.submissions ?? 0

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Website"
        title="Formularios"
        description="Define campos, copia el ID y úsalo en tu sitio con DynamicForm."
        actions={<Button onClick={() => setNewFormOpen(true)}>Nuevo formulario</Button>}
      />

      {formsQuery.isPending ? (
        <LoadingState message="Cargando formularios..." />
      ) : forms.length === 0 ? (
        <EmptyState
          title="Sin formularios"
          description="Crea tu primer formulario para capturar envíos desde el sitio público."
          action={{ label: 'Crear primer formulario', onClick: () => setNewFormOpen(true) }}
        />
      ) : (
        <div className="flex gap-5 items-start">
          {/* ── Left: form list ─────────────────────────────────────────── */}
          <div className="w-56 shrink-0 space-y-2">
            {forms.map(form => (
              <FormCard
                key={form.id}
                form={form}
                active={activeFormId === form.id}
                onClick={() => { setSelectedFormId(form.id); setActiveTab('campos') }}
              />
            ))}
          </div>

          {/* ── Right: form detail ──────────────────────────────────────── */}
          <div key={activeFormId} className="flex-1 min-w-0 space-y-4">
            {selectedForm ? (
              <>
                <Card className="p-4">
                  <FormDetailHeader
                    form={selectedForm}
                    onDelete={() => setDeleteTarget(selectedForm)}
                  />
                </Card>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="campos">Campos</TabsTrigger>
                    <TabsTrigger value="preview">
                      <Eye size={13} className="mr-1.5" />
                      Vista previa
                    </TabsTrigger>
                    <TabsTrigger value="configuracion">Configuración</TabsTrigger>
                    <TabsTrigger value="api">
                      <Code2 size={13} className="mr-1.5" />
                      API
                    </TabsTrigger>
                    <TabsTrigger value="envios">
                      Envíos
                      {subCount > 0 && (
                        <span className="ml-1.5 text-[10px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full px-1.5 py-0.5 leading-none">
                          {subCount}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="campos">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando campos..." />
                    ) : (
                      <FormFieldBuilder
                        formId={selectedForm.id}
                        fields={formDetail?.fields ?? []}
                        wizardMode={formDetail?.wizardMode ?? false}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['website-form-detail', selectedForm.id] })}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="preview">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando vista previa..." />
                    ) : (
                      <FormPreview form={formDetail} />
                    )}
                  </TabsContent>

                  <TabsContent value="configuracion">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando configuración..." />
                    ) : formDetailQuery.isError ? (
                      <ErrorState
                        title="No se pudo cargar"
                        message={formDetailQuery.error?.message}
                        onRetry={() => formDetailQuery.refetch()}
                      />
                    ) : (
                      <FormSettingsPanel
                        key={formDetail?.id}
                        form={formDetail}
                        token={token}
                        assignees={assignees}
                        turnstileConfigured={turnstileConfigured}
                        onSaved={() => {
                          formDetailQuery.refetch()
                          queryClient.invalidateQueries({ queryKey: ['website-forms', siteId] })
                        }}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="api">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando..." />
                    ) : (
                      <FormApiPanel form={formDetail} />
                    )}
                  </TabsContent>

                  <TabsContent value="envios">
                    <FormSubmissionsPanel formId={selectedForm.id} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un formulario.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <NewFormDialog
        open={newFormOpen}
        onOpenChange={setNewFormOpen}
        siteId={siteId}
        token={token}
        assignees={assignees}
        turnstileConfigured={turnstileConfigured}
        onCreated={(id) => { setSelectedFormId(id); setNewFormOpen(false) }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title="Eliminar formulario"
        description={`Se eliminará permanentemente "${deleteTarget?.name}" con todos sus campos y envíos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget?.id)}
      />
    </div>
  )
}
