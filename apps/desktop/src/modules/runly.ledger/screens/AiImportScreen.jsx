// apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PageHeader, Button, Badge, EmptyState, ErrorState,
  DistDropZone, SelectField, Checkbox, Input,
} from '@runly/ui'
import { ArrowLeft, Check, FileWarning } from 'lucide-react'
import { useAiImportMutations } from '../hooks/use-ai-import.js'
import { useAccountList } from '../hooks/use-ledger-queries.js'

function fmtAmount(value) {
  return Number(value ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })
}

export default function AiImportScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { recognize, commit } = useAiImportMutations()
  const { data: accountsData } = useAccountList()

  const [result, setResult] = useState(null)
  const [accountId, setAccountId] = useState(null)
  const [rows, setRows] = useState([])
  const [batchKey, setBatchKey] = useState(null)

  const accounts = accountsData?.data ?? []
  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.name} — ${a.bank}` })),
    [accounts],
  )

  const includedRows = rows.filter((r) => !r.possibleDuplicate || r.includeDuplicate)
  const includedCount = includedRows.length

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file) return
    recognize.mutate(file, {
      onSuccess: (data) => {
        setResult(data)
        setAccountId(data.detectedAccount?.id ?? null)
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0">
        <PageHeader
          className="pb-0"
          onBack={() => navigate('/app/m/runly.ledger/accounts')}
          backLabel="Cuentas bancarias"
          title="Importar con IA"
          description="Sube un estado de cuenta (PDF, foto, CSV o Excel) y revisa los movimientos antes de importarlos."
        />
      </div>

      <div className="flex-1 overflow-auto px-6 py-8">

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
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-sm">
                <SelectField
                  label="Cuenta destino"
                  required
                  options={accountOptions}
                  value={accountId ?? ''}
                  onValueChange={setAccountId}
                  placeholder="Selecciona una cuenta"
                />
              </div>
              {result.detectedAccount && (
                <Badge variant="success" className="mb-2.5">
                  Detectada automaticamente
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="mb-1" onClick={resetToUpload}>
                <ArrowLeft size={13} className="mr-1" />
                Volver a subir
              </Button>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                icon={FileWarning}
                title="Sin movimientos detectados"
                description="No se encontraron movimientos en el archivo. Intenta subir otro archivo."
                action={{ label: 'Volver a subir', onClick: resetToUpload }}
              />
            ) : (
              <div className="border border-[hsl(var(--border))] rounded-xl overflow-auto max-h-112">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[hsl(var(--muted)/0.4)] border-b border-[hsl(var(--border))]">
                      <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                      <th className="px-3 py-2 text-left font-semibold">Nombre</th>
                      <th className="px-3 py-2 text-right font-semibold">Monto</th>
                      <th className="px-3 py-2 text-left font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isDeposit = Number(row.deposito) > 0
                      return (
                        <tr key={row.tempId} className="border-t border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.2)]">
                          <td className="px-3 py-1.5 w-36">
                            <Input
                              value={row.fecha ?? ''}
                              onChange={(e) => updateRow(row.tempId, { fecha: e.target.value })}
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
                          <td className={`px-3 py-1.5 text-right font-mono font-semibold ${isDeposit ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {isDeposit ? '+' : '-'}{fmtAmount(row.deposito || row.retiro)}
                          </td>
                          <td className="px-3 py-1.5">
                            {row.possibleDuplicate ? (
                              <div className="flex items-center gap-2">
                                <Badge variant="warning" className="whitespace-nowrap">Posible duplicado</Badge>
                                <label className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                                  <Checkbox
                                    checked={row.includeDuplicate}
                                    onCheckedChange={(checked) => updateRow(row.tempId, { includeDuplicate: !!checked })}
                                  />
                                  Incluir de todas formas
                                </label>
                              </div>
                            ) : (
                              <Badge variant="secondary">Nuevo</Badge>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleConfirm}
                disabled={!accountId || includedCount === 0 || commit.isPending}
              >
                <Check size={13} className="mr-1" />
                {commit.isPending ? 'Importando...' : `Importar ${includedCount} movimientos`}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
