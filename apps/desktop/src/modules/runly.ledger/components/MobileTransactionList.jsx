// apps/desktop/src/modules/runly.ledger/components/MobileTransactionList.jsx
import { Pencil, Trash2 } from 'lucide-react'
import { fmtDecimal, toDateValue } from '../lib/spreadsheet-helpers.js'

export default function MobileTransactionList({ rows, canEdit, onEdit, onDelete }) {
  return (
    <div className="sm:hidden divide-y divide-[hsl(var(--border)/0.5)]">
      {rows.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Sin movimientos.
        </div>
      )}
      {rows.map((row) => (
        <div key={row.id} className="px-4 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{row.nombre}</span>
              <span className={`text-sm font-mono font-semibold shrink-0 tabular-nums ${Number(row.deposito) > 0 ? 'text-success' : 'text-destructive'}`}>
                {Number(row.deposito) > 0 ? '+' : '-'}{fmtDecimal(row.deposito || row.retiro)}
              </span>
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 flex flex-wrap gap-x-2">
              <span>{toDateValue(row.fecha)}</span>
              {row.tipo_code && <span>· {row.tipo_code}</span>}
              {row.category_name && <span>· {row.category_name}</span>}
            </div>
            {(row.concepto || row.referencia) && (
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate">
                {row.concepto || row.referencia}
              </div>
            )}
            <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">
              Saldo: {fmtDecimal(row.saldo_actual)}
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-col gap-1 shrink-0">
              <button
                type="button"
                aria-label={`Editar movimiento ${row.consecutive ?? ''}`}
                className="p-1.5 rounded-md hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                onClick={() => onEdit(row)}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                aria-label={`Eliminar movimiento ${row.consecutive ?? ''}`}
                className="p-1.5 rounded-md hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-500"
                onClick={() => onDelete(row)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
