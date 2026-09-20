// apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx
import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge, Button, DistDropZone, PageHeader, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@runly/ui'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

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

const STEPS = ['Subir archivo', 'Mapear columnas', 'Previsualizar']

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
  const [rawRows, setRawRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)

  // Load account details for the context header
  const { data: accountData } = useQuery({
    queryKey: ['ledger-account', accountId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/ledger/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudo cargar la cuenta.')
      return res.json()
    },
    enabled: !!accountId && !!token,
  })
  const account = accountData?.data ?? null

  // ── Step 1: Upload ────────────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext !== 'csv') {
      toast.error('Solo se aceptan archivos CSV. Exporta tu hoja de calculo como CSV e intenta de nuevo.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const lines = text.split(/\r?\n/).filter(Boolean)
        if (lines.length < 2) { toast.error('El archivo no tiene datos.'); return }

        const parsecsv = (line) => {
          const result = []; let cur = ''; let inQ = false
          for (const ch of line) {
            if (ch === '"') { inQ = !inQ }
            else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
            else cur += ch
          }
          result.push(cur.trim())
          return result
        }

        const firstLine = lines[0].replace(/^﻿/, '') // Strip BOM
        const hdrs = parsecsv(firstLine)
        setHeaders(hdrs)

        const rows = lines.slice(1).map((line) => {
          const vals = parsecsv(line)
          return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] ?? '']))
        })
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
      } catch {
        toast.error('No se pudo leer el archivo.')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  // ── Step 2: Preview mutation ──────────────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
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
      const res = await fetch(
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
      <div className="px-6 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0">
        <PageHeader
          className="pb-0"
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
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: 'var(--module-accent, #16a34a)' }}
                >
                  {fmtCurrency(account.current_balance, account.currency)}
                </span>
              </>
            )
          }
        />
      </div>

      {/* ── Step indicators ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[hsl(var(--border))] shrink-0">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={
                step >= i
                  ? { backgroundColor: 'var(--module-accent, #16a34a)', color: '#fff' }
                  : { border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }
              }
            >
              {step > i ? <Check size={12} /> : i + 1}
            </span>
            <span
              className={`text-sm whitespace-nowrap ${
                step === i
                  ? 'font-semibold text-[hsl(var(--foreground))]'
                  : 'text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-[hsl(var(--muted-foreground))] mx-1">›</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-8">

        {/* Step 0: Upload */}
        {step === STEP_UPLOAD && (
          <div className="max-w-lg mx-auto">
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Sube un archivo CSV con tus movimientos bancarios. La primera fila debe contener los encabezados de columna.
            </p>
            <DistDropZone
              accept=".csv"
              maxSizeMB={20}
              fullScreenOverlay
              overlayLabel="Suelta tu archivo CSV aqui"
              overlayHint="CSV — primera fila debe ser encabezados"
              onFile={handleFile}
              emptyLabel="Arrastra tu archivo CSV aqui"
              emptyHint="CSV — primera fila debe ser encabezados"
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
            <div className="flex gap-3">
              <Badge variant="success" className="text-sm px-3.5 py-1.5 gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
                {preview.valid_count} filas validas
              </Badge>
              {preview.error_count > 0 && (
                <Badge variant="destructive" className="text-sm px-3.5 py-1.5 gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
                  {preview.error_count} filas con error
                </Badge>
              )}
            </div>

            {preview.errors?.length > 0 && (
              <div className="border border-red-200 dark:border-red-800 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-red-500 dark:bg-red-950/40 text-xs font-semibold text-white dark:text-red-300">
                  Errores detectados
                </div>
                <div className="max-h-40 overflow-auto divide-y divide-red-100 dark:divide-red-900">
                  {preview.errors.map((e) => (
                    <div key={e.rowIndex} className="px-3 py-2 text-xs">
                      <span className="font-semibold">Fila {e.rowIndex}:</span>{' '}
                      {e.errors.join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.valid?.length > 0 && (
              <div className="border border-[hsl(var(--border))] rounded-xl overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[hsl(var(--muted)/0.4)] border-b border-[hsl(var(--border))]">
                      <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                      <th className="px-3 py-2 text-left font-semibold">Nombre</th>
                      <th className="px-3 py-2 text-right font-semibold">Deposito</th>
                      <th className="px-3 py-2 text-right font-semibold">Retiro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-t border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.2)]">
                        <td className="px-3 py-1.5">{row.fecha}</td>
                        <td className="px-3 py-1.5 truncate max-w-50">{row.nombre}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 dark:text-emerald-400 font-mono">{row.deposito ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right text-red-600 dark:text-red-400 font-mono">{row.retiro ?? '—'}</td>
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
