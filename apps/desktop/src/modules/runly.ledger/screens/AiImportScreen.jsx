// apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx
import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PageHeader, Button, Badge, EmptyState, ErrorState, Card,
  DistDropZone, SelectField, Checkbox, Input,
} from '@runly/ui'
import { ArrowLeft, Check, FileWarning, Upload, ListChecks, CheckCircle2, Landmark, CheckCircle, AlertTriangle, FileText, CopyX, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useAiImportMutations } from '../hooks/use-ai-import.js'
import { useAccountList } from '../hooks/use-ledger-queries.js'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

const STEPS = [
  { key: 'upload', label: 'Cargar archivo', icon: Upload },
  { key: 'review', label: 'Revisión y mapeo', icon: ListChecks },
  { key: 'confirm', label: 'Confirmar e importar', icon: CheckCircle2 },
]

function StepIndicator({ current }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((step, idx) => {
        const Icon = step.icon
        const state = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending'
        return (
          <div
            key={step.key}
            className={[
              'flex items-center gap-2 rounded-lg border px-3 py-2 min-w-48',
              state === 'active' && 'border-(--brand-primary) bg-(--brand-soft)',
              state === 'done' && 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]',
              state === 'pending' && 'border-[hsl(var(--border))] bg-transparent opacity-60',
            ].filter(Boolean).join(' ')}
          >
            <span className={[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
              state === 'active' && 'bg-(--brand-primary) text-(--brand-primary-foreground)',
              state === 'done' && 'bg-[hsl(var(--muted-foreground)/0.25)] text-[hsl(var(--foreground))]',
              state === 'pending' && 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
            ].filter(Boolean).join(' ')}
            >
              {state === 'done' ? <Check size={13} /> : idx + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Paso {idx + 1}
              </div>
              <div className="text-xs font-medium truncate flex items-center gap-1">
                <Icon size={12} className="shrink-0" />
                {step.label}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fmtAmount(value) {
  return Number(value ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })
}

export default function AiImportScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { recognize, commit } = useAiImportMutations()
  const { data: accountsData } = useAccountList()

  // When arriving from an account's own "Importar" menu (AccountScreen.jsx),
  // that account is pre-selected and the user is sent back to it afterward
  // instead of the generic accounts list.
  const presetAccountId = location.state?.accountId ?? null
  const presetAccountName = location.state?.accountName ?? null

  const [result, setResult] = useState(null)
  const [accountId, setAccountId] = useState(presetAccountId)
  const [rows, setRows] = useState([])
  const [batchKey, setBatchKey] = useState(null)

  const accounts = accountsData?.data ?? []
  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.name} — ${a.bank}` })),
    [accounts],
  )

  const includedRows = rows.filter((r) => !r.possibleDuplicate || r.includeDuplicate)
  const includedCount = includedRows.length
  const duplicateCount = rows.filter((r) => r.possibleDuplicate).length
  const totals = useMemo(() => {
    let deposits = 0
    let withdrawals = 0
    for (const r of includedRows) {
      deposits += Number(r.deposito) || 0
      withdrawals += Number(r.retiro) || 0
    }
    return { deposits, withdrawals }
  }, [includedRows])

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file) return
    recognize.mutate(file, {
      onSuccess: (data) => {
        setResult(data)
        setAccountId(presetAccountId ?? data.detectedAccount?.id ?? null)
        setRows((data.rows ?? []).map((r) => ({ ...r, includeDuplicate: false })))
        setBatchKey(crypto.randomUUID())
      },
      onError: (err) => toast.error(err.message),
    })
  }

  function resetToUpload() {
    recognize.reset()
    setResult(null)
    setAccountId(null)
    setRows([])
    setBatchKey(null)
  }

  // ── Step 2: Row editing ───────────────────────────────────────────────────

  function updateRow(tempId, patch) {
    setRows((current) => current.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)))
  }

  // ── Step 3: Confirm ───────────────────────────────────────────────────────

  function handleConfirm() {
    if (!accountId || includedCount === 0) return
    commit.mutate(
      {
        proofToken: result.proofToken,
        accountId,
        batchKey,
        rows: includedRows.map((r) => ({
          tempId: r.tempId,
          fecha: r.fecha,
          nombre: r.nombre,
          referencia: r.referencia,
          concepto: r.concepto,
          numero: r.numero,
          deposito: r.deposito,
          retiro: r.retiro,
          categoryId: null,
          tipoId: null,
          includeDuplicate: !!r.includeDuplicate,
        })),
      },
      {
        onSuccess: (data) => {
          toast.success(`${data.inserted} movimientos importados.`)
          queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
          queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
          queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
          navigate(`/app/m/runly.ledger/accounts/${accountId}`)
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const currentStep = !result ? 'upload' : commit.isPending ? 'confirm' : 'review'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0 space-y-4">
        <PageHeader
          className="pb-0"
          eyebrow="Runly Ledger · Importación inteligente"
          onBack={() =>
            navigate(
              presetAccountId
                ? `/app/m/runly.ledger/accounts/${presetAccountId}`
                : '/app/m/runly.ledger/accounts',
            )
          }
          backLabel={presetAccountName ?? 'Cuentas bancarias'}
          title="Importar movimientos con IA"
          description={
            presetAccountName
              ? `Sube un estado de cuenta para "${presetAccountName}" (PDF, foto, CSV o Excel) y revisa los movimientos antes de importarlos.`
              : 'Sube un estado de cuenta (PDF, foto, CSV o Excel) y revisa los movimientos antes de importarlos.'
          }
        />
        <StepIndicator current={currentStep} />
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 sm:px-6 sm:py-8">

        {/* Step 1: Upload */}
        {!result && (
          <div className="max-w-lg mx-auto">
            <DistDropZone
              accept=".pdf,.csv,.xlsx,.jpg,.jpeg,.png,.webp"
              maxSizeMB={20}
              fullScreenOverlay
              overlayLabel="Suelta tu estado de cuenta aqui"
              overlayHint="PDF, foto, CSV o Excel"
              onFile={handleFile}
              isUploading={recognize.isPending}
              emptyLabel={recognize.isPending ? 'Analizando archivo...' : 'Arrastra tu estado de cuenta aqui'}
              emptyHint="PDF, foto, CSV o Excel"
            />

            {recognize.isError && (
              <ErrorState
                className="mt-4"
                title="No se pudo analizar el archivo"
                description={recognize.error?.message}
                onRetry={() => recognize.reset()}
              />
            )}
          </div>
        )}

        {/* Step 2: Review */}
        {result && (
          <div className="max-w-5xl mx-auto space-y-4">
            <Card variant="solid" className="rounded-xl flex items-end gap-3 flex-wrap p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--brand-soft) text-(--brand-primary)">
                <Landmark size={18} />
              </div>
              <div className="flex-1 max-w-sm min-w-56">
                <SelectField
                  label="Cuenta destino"
                  required
                  options={accountOptions}
                  value={accountId ?? ''}
                  onValueChange={setAccountId}
                  placeholder="Selecciona una cuenta"
                />
              </div>
              {presetAccountId ? (
                <Badge variant="secondary" className="mb-2.5">
                  Cuenta preseleccionada
                </Badge>
              ) : result.detectedAccount && (
                <Badge variant="success" className="mb-2.5">
                  Detectada automaticamente
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="mb-1" onClick={resetToUpload}>
                <ArrowLeft size={13} className="mr-1" />
                Volver a subir
              </Button>
            </Card>

            {rows.length > 0 && (
              <LedgerStatStrip
                items={[
                  { key: 'detected', label: 'Detectados', value: rows.length, icon: FileText, tone: 'brand' },
                  { key: 'duplicates', label: 'Posibles duplicados', value: duplicateCount, icon: CopyX, tone: 'amber' },
                  { key: 'deposits', label: 'Total depósitos', value: `+${fmtAmount(totals.deposits)}`, icon: ArrowDownLeft, tone: 'success' },
                  { key: 'withdrawals', label: 'Total retiros', value: `-${fmtAmount(totals.withdrawals)}`, icon: ArrowUpRight, tone: 'destructive' },
                ]}
              />
            )}

            {rows.length === 0 ? (
              <EmptyState
                icon={FileWarning}
                title="Sin movimientos detectados"
                description="No se encontraron movimientos en el archivo. Intenta subir otro archivo."
                action={{ label: 'Volver a subir', onClick: resetToUpload }}
              />
            ) : (
              <>
                {/* Desktop: full editable grid */}
                <div className="hidden sm:block border border-[hsl(var(--border))] rounded-xl overflow-auto max-h-112">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] w-32">Fecha</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] w-24">Numero</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] min-w-40">Nombre</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] w-32">Referencia</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] min-w-36">Concepto</th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] w-28">Monto</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] min-w-48">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const isDeposit = Number(row.deposito) > 0
                        return (
                          <tr
                            key={row.tempId}
                            className={`border-t border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.4)] transition-colors ${idx % 2 === 1 ? 'bg-[hsl(var(--muted)/0.12)]' : ''} ${row.possibleDuplicate && !row.includeDuplicate ? 'opacity-70' : ''}`}
                          >
                            <td className="px-3 py-1.5">
                              <Input
                                value={row.fecha ?? ''}
                                onChange={(e) => updateRow(row.tempId, { fecha: e.target.value })}
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={row.numero ?? ''}
                                onChange={(e) => updateRow(row.tempId, { numero: e.target.value })}
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={row.nombre ?? ''}
                                onChange={(e) => updateRow(row.tempId, { nombre: e.target.value })}
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={row.referencia ?? ''}
                                onChange={(e) => updateRow(row.tempId, { referencia: e.target.value })}
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={row.concepto ?? ''}
                                onChange={(e) => updateRow(row.tempId, { concepto: e.target.value })}
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className={`px-3 py-1.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${isDeposit ? 'text-success' : 'text-destructive'}`}>
                              {isDeposit ? '+' : '-'}{fmtAmount(row.deposito || row.retiro)}
                            </td>
                            <td className="px-3 py-1.5">
                              {row.possibleDuplicate ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="warning" className="whitespace-nowrap gap-1">
                                    <AlertTriangle size={11} /> Posible duplicado
                                  </Badge>
                                  <label className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                                    <Checkbox
                                      checked={row.includeDuplicate}
                                      onCheckedChange={(checked) => updateRow(row.tempId, { includeDuplicate: !!checked })}
                                    />
                                    Incluir de todas formas
                                  </label>
                                </div>
                              ) : (
                                <Badge variant="success" className="gap-1">
                                  <CheckCircle size={11} /> Nuevo
                                </Badge>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: stacked editable cards */}
                <div className="sm:hidden border border-[hsl(var(--border))] rounded-xl overflow-auto max-h-140 divide-y divide-[hsl(var(--border)/0.5)]">
                  {rows.map((row) => {
                    const isDeposit = Number(row.deposito) > 0
                    return (
                      <div key={row.tempId} className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Input
                            value={row.nombre ?? ''}
                            onChange={(e) => updateRow(row.tempId, { nombre: e.target.value })}
                            placeholder="Nombre"
                            className="h-8 text-sm font-medium flex-1"
                          />
                          <span className={`text-sm font-mono font-semibold shrink-0 pt-1.5 whitespace-nowrap tabular-nums ${isDeposit ? 'text-success' : 'text-destructive'}`}>
                            {isDeposit ? '+' : '-'}{fmtAmount(row.deposito || row.retiro)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="block text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">Fecha</span>
                            <Input
                              value={row.fecha ?? ''}
                              onChange={(e) => updateRow(row.tempId, { fecha: e.target.value })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">Numero</span>
                            <Input
                              value={row.numero ?? ''}
                              onChange={(e) => updateRow(row.tempId, { numero: e.target.value })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">Referencia</span>
                            <Input
                              value={row.referencia ?? ''}
                              onChange={(e) => updateRow(row.tempId, { referencia: e.target.value })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">Concepto</span>
                            <Input
                              value={row.concepto ?? ''}
                              onChange={(e) => updateRow(row.tempId, { concepto: e.target.value })}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>
                        {row.possibleDuplicate ? (
                          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                            <Badge variant="warning">Posible duplicado</Badge>
                            <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                              <Checkbox
                                checked={row.includeDuplicate}
                                onCheckedChange={(checked) => updateRow(row.tempId, { includeDuplicate: !!checked })}
                              />
                              Incluir de todas formas
                            </label>
                          </div>
                        ) : (
                          <Badge variant="success">Nuevo</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

      </div>

      {result && rows.length > 0 && (
        <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-(--brand-primary)" />
              {includedCount} movimiento{includedCount !== 1 ? 's' : ''} listo{includedCount !== 1 ? 's' : ''} para importar
            </span>
            <span className="text-success font-mono font-semibold tabular-nums">+{fmtAmount(totals.deposits)}</span>
            <span className="text-destructive font-mono font-semibold tabular-nums">-{fmtAmount(totals.withdrawals)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetToUpload}>
              Descartar todo
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirm}
              disabled={!accountId || includedCount === 0 || commit.isPending}
            >
              <Check size={13} className="mr-1" />
              {commit.isPending ? 'Importando...' : `Continuar a confirmación (${includedCount})`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
