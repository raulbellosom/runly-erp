import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx
import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button, Card, DistDropZone, PageHeader, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@runly/ui'
import { ArrowLeft, ArrowRight, Check, Upload, ListChecks, Eye, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

const API_BASE = getApiUrl()

// Fields the user can map to
const TARGET_FIELDS = [
  { key: 'fecha',      label: 'Fecha *',    required: true  },
  { key: 'nombre',     label: 'Nombre *',   required: true  },
  { key: 'deposito',   label: 'Deposito',   required: false },
  { key: 'retiro',     label: 'Retiro',     required: false },
  { key: 'numero',     label: 'Numero',     required: false },
  { key: 'referencia', label: 'Referencia', required: false },
  { key: 'concepto',   label: 'Concepto',   required: false },
]

const STEP_UPLOAD  = 0
const STEP_MAPPING = 1
const STEP_PREVIEW = 2

const STEPS = [
  { label: 'Subir archivo', icon: Upload },
  { label: 'Mapear columnas', icon: ListChecks },
  { label: 'Previsualizar', icon: Eye },
]

function fmtCurrency(amount, currency = 'MXN') {
  return Number(amount ?? 0).toLocaleString('es-MX', {
    style: 'currency', currency, minimumFractionDigits: 2,
  })
}

export default function ImportWizard() {
  // The route is a wildcard (*) — extract account ID from "accounts/UUID/import".
  const { "*": wildcard } = useParams()
  const accountId = useMemo(() => wildcard?.split('/')[1] ?? null, [wildcard])

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const token = session?.access_token ?? null

  const [step, setStep]       = useState(STEP_UPLOAD)
  const [parsing, setParsing] = useState(false)
  const [rawRows, setRawRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)

  // Load account details for the context header
  const { data: accountData } = useQuery({
    queryKey: ['ledger-account', accountId],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudo cargar la cuenta.')
      return res.json()
    },
    enabled: !!accountId && !!token,
  })
  const account = accountData?.data ?? null

  // ── Step 1: Upload ────────────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext !== 'csv' && ext !== 'xlsx') {
      toast.error('Solo se aceptan archivos CSV o XLSX.')
      return
    }

    setParsing(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/import/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'No se pudo leer el archivo.')
      }
      const { rows, headers: hdrs } = await res.json()
      if (!rows.length) { toast.error('El archivo no tiene datos.'); return }

      setHeaders(hdrs)
      setRawRows(rows)

      // Auto-map by header similarity
      const autoMap = {}
      TARGET_FIELDS.forEach(({ key }) => {
        const match = hdrs.find((h) => {
          const lower = h.toLowerCase()
          if (key === 'fecha')      return lower.includes('fecha')
          if (key === 'nombre')     return lower.includes('nombre') || lower.includes('descripci')
          if (key === 'deposito')   return lower.includes('dep') || lower.includes('abono')
          if (key === 'retiro')     return lower.includes('ret') || lower.includes('cargo') || lower.includes('egreso')
          if (key === 'numero')     return lower.includes('num') || lower.includes('folio')
          if (key === 'referencia') return lower.includes('ref')
          if (key === 'concepto')   return lower.includes('concepto') || lower.includes('nota')
          return lower.includes(key)
        })
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
      setStep(STEP_MAPPING)
    } catch (err) {
      toast.error(err.message ?? 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  // ── Step 2: Preview mutation ──────────────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(
        `${API_BASE}/ledger/accounts/${accountId}/import/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rows: rawRows, mapping }),
        },
      )
      if (!res.ok) throw new Error('Error al previsualizar.')
      return res.json()
    },
    onSuccess: (data) => { setPreview(data); setStep(STEP_PREVIEW) },
    onError: (err) => toast.error(err.message),
  })

  // ── Step 3: Commit mutation ───────────────────────────────────────────────────

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(
        `${API_BASE}/ledger/accounts/${accountId}/import/commit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rows: rawRows, mapping }),
        },
      )
      if (!res.ok) throw new Error('Error al importar.')
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`${data.inserted} movimientos importados.`)
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
      navigate(`/app/m/runly.ledger/accounts/${accountId}`)
    },
    onError: (err) => toast.error(err.message),
  })

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Account context header (matches AccountScreen layout) ──────── */}
      <div className="px-6 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0 space-y-4">
        <PageHeader
          className="pb-0"
          eyebrow="Runly Ledger · Importación de movimientos"
          onBack={() => navigate(`/app/m/runly.ledger/accounts/${accountId}`)}
          backLabel={account ? account.name : 'Cuenta'}
          title="Importar movimientos"
          description={
            account && (
              <>
                {account.bank}
                <span className="mx-1.5 opacity-40">·</span>
                {account.currency}
                <span className="mx-1.5 opacity-40">·</span>
                <span className="font-semibold tabular-nums text-(--brand-primary)">
                  {fmtCurrency(account.current_balance, account.currency)}
                </span>
              </>
            )
          }
        />

        {/* ── Step indicators ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const state = step > i ? 'done' : step === i ? 'active' : 'pending'
            return (
              <div
                key={s.label}
                className={[
                  'flex items-center gap-2 rounded-lg border px-3 py-2 min-w-44',
                  state === 'active' && 'border-(--brand-primary) bg-(--brand-soft)',
                  state === 'done' && 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]',
                  state === 'pending' && 'border-[hsl(var(--border))] bg-transparent opacity-60',
                ].filter(Boolean).join(' ')}
              >
                <span
                  className={[
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    state === 'active' && 'bg-(--brand-primary) text-(--brand-primary-foreground)',
                    state === 'done' && 'bg-[hsl(var(--muted-foreground)/0.25)] text-[hsl(var(--foreground))]',
                    state === 'pending' && 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
                  ].filter(Boolean).join(' ')}
                >
                  {state === 'done' ? <Check size={13} /> : i + 1}
                </span>
                <span className="text-xs font-medium flex items-center gap-1 truncate">
                  <Icon size={12} className="shrink-0" />
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-8">

        {/* Step 0: Upload */}
        {step === STEP_UPLOAD && (
          <div className="max-w-lg mx-auto">
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Sube un archivo CSV o XLSX con tus movimientos bancarios. La primera fila debe contener los encabezados de columna.
            </p>
            <DistDropZone
              accept=".csv,.xlsx"
              maxSizeMB={20}
              fullScreenOverlay
              isUploading={parsing}
              overlayLabel="Suelta tu archivo aqui"
              overlayHint="CSV o XLSX — primera fila debe ser encabezados"
              onFile={handleFile}
              emptyLabel="Arrastra tu archivo CSV o XLSX aqui"
              emptyHint="CSV o XLSX — primera fila debe ser encabezados"
            />
          </div>
        )}

        {/* Step 1: Mapping */}
        {step === STEP_MAPPING && (
          <div className="max-w-lg mx-auto">
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Asocia las columnas de tu archivo con los campos del sistema.
              Se detectaron <strong>{rawRows.length}</strong> filas.
            </p>

            <div className="space-y-3">
              {TARGET_FIELDS.map(({ key, label, required }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="w-36 text-sm shrink-0 text-[hsl(var(--foreground))]">
                    {label}
                  </label>
                  <Select
                    value={mapping[key] ?? '__none__'}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v === '__none__' ? undefined : v }))}
                  >
                    <SelectTrigger className={`flex-1 text-sm ${required && !mapping[key] ? 'border-amber-400 dark:border-amber-600' : ''}`}>
                      <SelectValue placeholder="— sin mapear —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— sin mapear —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-6">
              <Button variant="ghost" size="sm" onClick={() => setStep(STEP_UPLOAD)}>
                <ArrowLeft size={13} className="mr-1" />
                Atras
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => previewMutation.mutate()}
                disabled={!mapping.fecha || !mapping.nombre || previewMutation.isPending}
              >
                Previsualizar
                <ArrowRight size={13} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === STEP_PREVIEW && preview && (
          <div className="max-w-2xl mx-auto space-y-4">
            <LedgerStatStrip
              items={[
                { key: 'valid', label: 'Filas válidas', value: preview.valid_count, icon: CheckCircle2, tone: 'success' },
                ...(preview.error_count > 0
                  ? [{ key: 'errors', label: 'Filas con error', value: preview.error_count, icon: AlertTriangle, tone: 'destructive' }]
                  : []),
              ]}
            />

            {preview.errors?.length > 0 && (
              <Card variant="solid" className="rounded-xl overflow-hidden border-rose-500/30">
                <div className="px-3 py-2 bg-rose-500 text-xs font-semibold text-white flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Errores detectados
                </div>
                <div className="max-h-40 overflow-auto divide-y divide-[hsl(var(--border)/0.5)]">
                  {preview.errors.map((e) => (
                    <div key={e.rowIndex} className="px-3 py-2 text-xs">
                      <span className="font-semibold">Fila {e.rowIndex}:</span>{' '}
                      {e.errors.join(', ')}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {preview.valid?.length > 0 && (
              <div className="border border-[hsl(var(--border))] rounded-xl overflow-auto max-h-64">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Fecha</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Nombre</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Deposito</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Retiro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid.slice(0, 20).map((row, i) => (
                      <tr key={i} className={`border-t border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.4)] transition-colors ${i % 2 === 1 ? 'bg-[hsl(var(--muted)/0.12)]' : ''}`}>
                        <td className="px-3 py-1.5">{row.fecha}</td>
                        <td className="px-3 py-1.5 truncate max-w-50">{row.nombre}</td>
                        <td className="px-3 py-1.5 text-right text-success font-mono tabular-nums">{row.deposito ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right text-destructive font-mono tabular-nums">{row.retiro ?? '—'}</td>
                      </tr>
                    ))}
                    {preview.valid.length > 20 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-center text-[hsl(var(--muted-foreground))] text-xs">
                          ... y {preview.valid.length - 20} mas
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(STEP_MAPPING)}>
                <ArrowLeft size={13} className="mr-1" />
                Atras
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => commitMutation.mutate()}
                disabled={preview.valid_count === 0 || commitMutation.isPending}
              >
                <Check size={13} className="mr-1" />
                Importar {preview.valid_count} movimientos
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
