// Column type conversions a module update may perform (spec
// 2026-10-03-rme3-module-platform-v2 §10.6, plan Task 4.2). Each supported
// pair has a SQL predicate telling which non-null values convert cleanly (the
// preflight counts the rows that do NOT) and the USING expression. Types are
// the normalized sqlType strings of schema-diff.js (VARCHAR(255), NUMERIC(18,4)...).
const q = (column) => `"${column}"`

function family(sqlType) {
  const type = String(sqlType ?? '').toUpperCase()
  if (type === 'TEXT') return { kind: 'text', length: null }
  const varchar = /^VARCHAR\((\d+)\)$/.exec(type)
  if (varchar) return { kind: 'text', length: Number(varchar[1]) }
  if (type === 'INTEGER') return { kind: 'integer' }
  if (/^NUMERIC(\(\d+,\d+\))?$/.test(type)) return { kind: 'numeric' }
  if (type === 'BOOLEAN') return { kind: 'boolean' }
  if (type === 'DATE') return { kind: 'date' }
  if (type === 'TIMESTAMPTZ') return { kind: 'timestamptz' }
  if (type === 'UUID') return { kind: 'uuid' }
  if (type === 'TEXT[]') return { kind: 'text_array' }
  return { kind: 'other' }
}

const BOOLEAN_WORDS = "('true','false','t','f','yes','no','y','n','on','off','1','0')"
const TEXT_TO = {
  integer: (c) => `trim(${c}) ~ '^[+-]?[0-9]{1,9}$'`,
  numeric: (c) => `trim(${c}) ~ '^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)$'`,
  boolean: (c) => `lower(trim(${c})) IN ${BOOLEAN_WORDS}`,
  date: (c) => `trim(${c}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
  timestamptz: (c) => `trim(${c}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?$'`,
  uuid: (c) => `lower(trim(${c})) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
}

// { predicate(col) | null (always converts), using(col, toType) } or null when unsupported.
export function columnConversion(fromType, toType) {
  const from = family(fromType)
  const to = family(toType)
  const target = String(toType).toUpperCase()
  const lengthFits = (c) => (to.length ? `char_length(${c}::text) <= ${to.length}` : null)
  if (from.kind === 'text' && to.kind === 'text') {
    return { predicate: from.length === null || (to.length !== null && to.length < from.length) ? lengthFits : () => null, using: (c) => `${c}::${target}` }
  }
  if (from.kind === 'text' && TEXT_TO[to.kind]) {
    const cast = to.kind === 'boolean' ? (c) => `lower(trim(${c}))::BOOLEAN` : (c) => `trim(${c})::${target}`
    return { predicate: TEXT_TO[to.kind], using: cast }
  }
  if (to.kind === 'text' && ['integer', 'numeric', 'boolean', 'date', 'timestamptz', 'uuid'].includes(from.kind)) {
    return { predicate: lengthFits, using: (c) => `${c}::${target}` }
  }
  if (from.kind === 'integer' && to.kind === 'numeric') return { predicate: () => null, using: (c) => `${c}::${target}` }
  if (from.kind === 'numeric' && to.kind === 'numeric') return { predicate: () => null, using: (c) => `${c}::${target}` }
  if (from.kind === 'numeric' && to.kind === 'integer') {
    return { predicate: (c) => `${c} = trunc(${c}) AND abs(${c}) < 2147483648`, using: (c) => `${c}::INTEGER` }
  }
  if (from.kind === 'date' && to.kind === 'timestamptz') return { predicate: () => null, using: (c) => `${c}::TIMESTAMPTZ` }
  if (from.kind === 'timestamptz' && to.kind === 'date') return { predicate: () => null, using: (c) => `${c}::DATE` }
  if (from.kind === 'text' && to.kind === 'text_array') {
    return { predicate: () => null, using: (c) => `CASE WHEN ${c} IS NULL OR ${c} = '' THEN NULL ELSE ARRAY[${c}::TEXT] END` }
  }
  if (from.kind === 'text_array' && to.kind === 'text') {
    return { predicate: (c) => (to.length ? `char_length(array_to_string(${c}, ', ')) <= ${to.length}` : null), using: (c) => `array_to_string(${c}, ', ')::${target}` }
  }
  return null
}

// Preflight: rows whose non-null value would not convert; null when every row converts.
export function conversionFailingRowsSql(table, column, fromType, toType) {
  const conversion = columnConversion(fromType, toType)
  if (!conversion) return null
  const predicate = conversion.predicate(q(column))
  if (!predicate) return null
  return `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE ${q(column)} IS NOT NULL AND NOT (${predicate})`
}

export function conversionSql(table, column, fromType, toType, { nullFailing = false } = {}) {
  const conversion = columnConversion(fromType, toType)
  const predicate = conversion.predicate(q(column))
  const statements = []
  if (nullFailing && predicate) statements.push(`UPDATE "${table}" SET ${q(column)} = NULL WHERE ${q(column)} IS NOT NULL AND NOT (${predicate});`)
  statements.push(`ALTER TABLE "${table}" ALTER COLUMN ${q(column)} TYPE ${String(toType).toUpperCase()} USING ${conversion.using(q(column))};`)
  return statements
}
