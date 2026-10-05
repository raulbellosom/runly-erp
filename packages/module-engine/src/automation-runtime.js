export const isEmpty = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

export function matches(when, data, previous = null) {
  if (!when) return true
  const value = data?.[when.field]
  if (when.op === 'filled') return !isEmpty(value)
  if (when.op === 'changed') return Boolean(previous) && JSON.stringify(previous[when.field] ?? null) !== JSON.stringify(value ?? null)
  if (when.op === 'equals') return String(value ?? '') === String(when.value)
  return false
}

export function render(template, data) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => (data?.[key] === undefined || data?.[key] === null ? '' : String(data[key])))
}

export function sourceValue(source, ctx) {
  if (source.from === 'value') return source.value
  if (source.from === 'field') return ctx.data?.[source.field]
  if (source.from === 'template') return render(source.template, ctx.data)
  if (source.from === 'recordId') return ctx.data?.id
  if (source.from === 'actor') return ctx.actorId
  return undefined
}

export function buildArgs(automation, ctx) {
  const args = {}
  for (const [name, source] of Object.entries(automation.action.args)) {
    let value = sourceValue(source, ctx)
    if (isEmpty(value)) continue
    if (automation.runtime.arrayArgs.includes(name) && !Array.isArray(value)) value = [value]
    args[name] = value
  }
  if (automation.runtime.acceptsSource && args.sourceEntityId === undefined && ctx.recordId) args.sourceEntityId = ctx.recordId
  if (ctx.idempotencyKey) args.idempotencyKey = ctx.idempotencyKey
  return args
}

