// apps/desktop/src/modules/runly.ledger/components/DesktopTransactionTable.jsx
import CategoryOptions from './CategoryOptions.jsx'
import { fmtDecimal, toDateValue } from '../lib/spreadsheet-helpers.js'

const colClass = 'px-2 py-0 h-8 text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] rounded w-full'
const thClass = 'px-2 py-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] text-left whitespace-nowrap border-b border-r border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] select-none last:border-r-0'
const tdClass = 'border-b border-r border-[hsl(var(--border)/0.5)] p-0 align-middle last:border-r-0'

// Desktop spreadsheet-style register: inline-editable grid with keyboard
// navigation (arrow up/down, tab-like Enter, Escape) across cells, plus an
// always-last "new row" for adding a movement without opening a dialog.
export default function DesktopTransactionTable({
  tableRef, rows, types, categories, canEdit,
  getDraft, setDraft, handleKeyDown, handleRowBlur, saveRow,
  newRow, setNewRow, onDelete,
}) {
  return (
    <table
      ref={tableRef}
      className="hidden sm:table w-full min-w-262.5 border-collapse text-sm"
      onFocus={(e) => {
        const el = e.target
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      }}
    >
      <thead className="sticky top-0 z-10">
        <tr>
          <th className={`${thClass} w-10 text-center`}>#</th>
          <th className={`${thClass} w-28`}>Fecha</th>
          <th className={`${thClass} w-32`}>Tipo</th>
          <th className={`${thClass} w-24`}>Numero</th>
          <th className={`${thClass} min-w-40`}>Nombre</th>
          <th className={`${thClass} w-28`}>Referencia</th>
          <th className={`${thClass} min-w-32`}>Concepto</th>
          <th className={`${thClass} w-28 text-right`}>Ingreso</th>
          <th className={`${thClass} w-28 text-right`}>Egreso</th>
          <th className={`${thClass} w-36`}>Categoria</th>
          <th className={`${thClass} w-28 text-right`}>Saldo</th>
          <th className={`${thClass} w-8`} />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={12} className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Sin movimientos.
            </td>
          </tr>
        )}
        {rows.map((row, rowIdx) => {
          const draft = getDraft(row, rowIdx)
          return (
            <tr
              key={row.id}
              onBlur={(event) => handleRowBlur(event, row, rowIdx)}
              className="hover:bg-[hsl(var(--muted)/0.2)]"
            >
              <td className={`${tdClass} text-center text-xs text-[hsl(var(--muted-foreground))]`}>
                {row.consecutive}
              </td>
              <td className={tdClass}>
                <input
                  type="date"
                  aria-label={`Fecha movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="fecha"
                  disabled={!canEdit}
                  enterKeyHint="next"
                  value={toDateValue(draft.fecha)}
                  onChange={(event) => setDraft(row, rowIdx, 'fecha', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'fecha')}
                />
              </td>
              <td className={tdClass}>
                <select
                  aria-label={`Tipo movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="tipo_id"
                  disabled={!canEdit}
                  value={draft.tipo_id ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'tipo_id', event.target.value || null)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'tipo_id')}
                >
                  <option value="">—</option>
                  {types.map((type) => <option key={type.id} value={type.id}>{type.code}</option>)}
                </select>
              </td>
              <td className={tdClass}>
                <input
                  type="text"
                  aria-label={`Numero movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="numero"
                  disabled={!canEdit}
                  enterKeyHint="next"
                  value={draft.numero ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'numero', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'numero')}
                />
              </td>
              <td className={tdClass}>
                <input
                  type="text"
                  aria-label={`Nombre movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="nombre"
                  disabled={!canEdit}
                  enterKeyHint="next"
                  value={draft.nombre ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'nombre', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'nombre')}
                />
              </td>
              <td className={tdClass}>
                <input
                  type="text"
                  aria-label={`Referencia movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="referencia"
                  disabled={!canEdit}
                  enterKeyHint="next"
                  value={draft.referencia ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'referencia', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'referencia')}
                />
              </td>
              <td className={tdClass}>
                <input
                  type="text"
                  aria-label={`Concepto movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="concepto"
                  disabled={!canEdit}
                  enterKeyHint="next"
                  value={draft.concepto ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'concepto', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'concepto')}
                />
              </td>
              <td className={tdClass}>
                <input
                  type="number"
                  aria-label={`Ingreso movimiento ${row.consecutive ?? rowIdx + 1}`}
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  enterKeyHint="next"
                  className={`${colClass} text-right`}
                  data-row={rowIdx}
                  data-col="deposito"
                  disabled={!canEdit}
                  value={draft.deposito ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'deposito', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'deposito')}
                />
              </td>
              <td className={tdClass}>
                <input
                  type="number"
                  aria-label={`Egreso movimiento ${row.consecutive ?? rowIdx + 1}`}
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  enterKeyHint="next"
                  className={`${colClass} text-right`}
                  data-row={rowIdx}
                  data-col="retiro"
                  disabled={!canEdit}
                  value={draft.retiro ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'retiro', event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'retiro')}
                />
              </td>
              <td className={tdClass}>
                <select
                  aria-label={`Categoria movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className={colClass}
                  data-row={rowIdx}
                  data-col="category_id"
                  disabled={!canEdit}
                  value={draft.category_id ?? ''}
                  onChange={(event) => setDraft(row, rowIdx, 'category_id', event.target.value || null)}
                  onKeyDown={(event) => handleKeyDown(event, row, rowIdx, 'category_id')}
                >
                  <CategoryOptions categories={categories} />
                </select>
              </td>
              <td className={`${tdClass} text-right pr-3 text-xs font-mono font-semibold`}>
                {fmtDecimal(row.saldo_actual)}
              </td>
              <td className={`${tdClass} text-center`}>
                <button
                  type="button"
                  aria-label={`Eliminar movimiento ${row.consecutive ?? rowIdx + 1}`}
                  className="text-[hsl(var(--muted-foreground))] hover:text-red-500 text-xs px-1 disabled:opacity-40"
                  disabled={!canEdit}
                  onClick={() => onDelete(row)}
                  title="Eliminar"
                >
                  ×
                </button>
              </td>
            </tr>
          )
        })}

        {newRow && (
          <tr
            onBlur={(event) => {
              const nextFocused = event.relatedTarget
              if (event.currentTarget.contains(nextFocused)) return
              saveRow(newRow, rows.length)
            }}
            className="bg-[hsl(var(--muted)/0.3)]"
          >
            <td className={`${tdClass} text-center text-xs text-[hsl(var(--muted-foreground))]`}>*</td>
            <td className={tdClass}>
              <input
                type="date"
                aria-label="Fecha nuevo movimiento"
                className={colClass}
                autoFocus
                disabled={!canEdit}
                enterKeyHint="next"
                value={newRow.fecha}
                onChange={(event) => setNewRow((row) => ({ ...row, fecha: event.target.value, _dirty: true }))}
                onKeyDown={(event) => { if (event.key === 'Escape') setNewRow(null) }}
              />
            </td>
            <td className={tdClass}>
              <select
                aria-label="Tipo nuevo movimiento"
                className={colClass}
                disabled={!canEdit}
                value={newRow.tipo_id ?? ''}
                onChange={(event) => setNewRow((row) => ({ ...row, tipo_id: event.target.value || null, _dirty: true }))}
              >
                <option value="">—</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.code}</option>)}
              </select>
            </td>
            <td className={tdClass}>
              <input
                type="text"
                aria-label="Numero nuevo movimiento"
                className={colClass}
                disabled={!canEdit}
                enterKeyHint="next"
                value={newRow.numero}
                onChange={(event) => setNewRow((row) => ({ ...row, numero: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <input
                type="text"
                aria-label="Nombre nuevo movimiento"
                className={colClass}
                placeholder="Nombre *"
                disabled={!canEdit}
                enterKeyHint="next"
                value={newRow.nombre}
                onChange={(event) => setNewRow((row) => ({ ...row, nombre: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <input
                type="text"
                aria-label="Referencia nuevo movimiento"
                className={colClass}
                disabled={!canEdit}
                enterKeyHint="next"
                value={newRow.referencia}
                onChange={(event) => setNewRow((row) => ({ ...row, referencia: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <input
                type="text"
                aria-label="Concepto nuevo movimiento"
                className={colClass}
                disabled={!canEdit}
                enterKeyHint="next"
                value={newRow.concepto}
                onChange={(event) => setNewRow((row) => ({ ...row, concepto: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <input
                type="number"
                aria-label="Ingreso nuevo movimiento"
                min="0"
                step="0.01"
                inputMode="decimal"
                enterKeyHint="next"
                className={`${colClass} text-right`}
                disabled={!canEdit}
                value={newRow.deposito}
                onChange={(event) => setNewRow((row) => ({ ...row, deposito: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <input
                type="number"
                aria-label="Egreso nuevo movimiento"
                min="0"
                step="0.01"
                inputMode="decimal"
                enterKeyHint="next"
                className={`${colClass} text-right`}
                disabled={!canEdit}
                value={newRow.retiro}
                onChange={(event) => setNewRow((row) => ({ ...row, retiro: event.target.value, _dirty: true }))}
              />
            </td>
            <td className={tdClass}>
              <select
                aria-label="Categoria nuevo movimiento"
                className={colClass}
                disabled={!canEdit}
                value={newRow.category_id ?? ''}
                onChange={(event) => setNewRow((row) => ({ ...row, category_id: event.target.value || null, _dirty: true }))}
              >
                <CategoryOptions categories={categories} />
              </select>
            </td>
            <td className={`${tdClass} text-right pr-3 text-xs`}>—</td>
            <td className={`${tdClass} text-center`}>
              <button type="button" aria-label="Cancelar nuevo movimiento" className="text-xs px-1 hover:text-red-500 disabled:opacity-40" disabled={!canEdit} onClick={() => setNewRow(null)}>
                ×
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
