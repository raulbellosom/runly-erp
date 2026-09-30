// Pure line/total math shared by the editor, the totals card and payloads.
// Amounts are rounded to cents per line so the sum matches what the API stores.

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const cents = (value) => Math.round(num(value) * 100) / 100

export function computeLine(line) {
  const quantity = num(line.quantity)
  const unitAmount = num(line.unitAmount)
  const taxRate = num(line.taxRate)
  const subtotal = cents(quantity * unitAmount)
  const taxAmount = cents(subtotal * taxRate)
  return { subtotal, taxAmount, total: cents(subtotal + taxAmount) }
}

export function computeTotals(lines = []) {
  const byRate = new Map()
  let subtotal = 0
  let tax = 0
  let goods = 0
  for (const line of lines) {
    const values = computeLine(line)
    subtotal += values.subtotal
    tax += values.taxAmount
    if ((line.itemKind ?? 'GOODS') === 'GOODS') goods += 1
    const rate = num(line.taxRate)
    if (values.taxAmount) byRate.set(rate, cents((byRate.get(rate) ?? 0) + values.taxAmount))
  }
  subtotal = cents(subtotal)
  tax = cents(tax)
  return {
    subtotal,
    tax,
    total: cents(subtotal + tax),
    taxes: [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, amount]) => ({ rate, amount })),
    lineCount: lines.length,
    hasGoods: goods > 0,
  }
}

// Lines as the API expects them (spec section 3: item_kind, unit, tax_rate).
export function linesToPayload(lines = []) {
  return lines
    .filter((line) => String(line.description ?? '').trim() || Number(line.unitAmount) > 0)
    .map((line, index) => {
      const values = computeLine(line)
      return {
        ...(line.id ? { id: line.id } : {}),
        description: String(line.description ?? '').trim(),
        itemKind: line.itemKind ?? 'GOODS',
        quantity: num(line.quantity),
        unit: line.unit || null,
        unitAmount: num(line.unitAmount),
        taxRate: num(line.taxRate),
        taxAmount: values.taxAmount,
        total: values.total,
        inventoryCategoryId: line.inventoryCategoryId || null,
        sortOrder: index,
      }
    })
}

export function lineFromApi(line) {
  return {
    id: line.id,
    description: line.description ?? '',
    itemKind: line.itemKind ?? 'GOODS',
    quantity: num(line.quantity ?? 1),
    unit: line.unit ?? 'pza',
    unitAmount: num(line.unitAmount),
    // DECIMAL(6,4) arrives as "0.1600"; normalise to the option values.
    taxRate: String(num(line.taxRate ?? 0.16)),
    inventoryCategoryId: line.inventoryCategoryId ?? null,
  }
}

export const emptyLine = () => ({ description: '', itemKind: 'GOODS', quantity: 1, unit: 'pza', unitAmount: 0, taxRate: '0.16' })

// Remaining quantity per order line for the receipt dialog.
export const pendingQuantity = (line) => (line.pendingQuantity != null
  ? Math.max(0, num(line.pendingQuantity))
  : Math.max(0, num(line.quantity) - num(line.receivedQuantity)))
