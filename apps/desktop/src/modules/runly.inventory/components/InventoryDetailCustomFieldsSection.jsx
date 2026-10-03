// Registry key: runly.inventory:CustomFieldsSection — the item's custom field
// values (its type's fields and the ones added to this item only).
const YES_NO = { true: 'Sí', false: 'No' }

function formatValue(field, value) {
  if (field?.fieldType === 'boolean') return YES_NO[String(value)] ?? value
  if (field?.fieldType === 'date' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = String(value).slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return value
}

export default function InventoryDetailCustomFieldsSection({ data }) {
  const entries = (data?.customValues ?? []).filter((cv) => cv?.field && cv.value !== null && cv.value !== '')
  if (!entries.length) return null
  return (
    <dl className="grid gap-4 md:grid-cols-2">
      {entries.map((cv) => {
        const value = formatValue(cv.field, cv.value)
        const isLink = cv.field.fieldType === 'url'
        return (
          <div key={cv.fieldId ?? cv.field.id} className={cv.field.fieldType === 'textarea' ? 'col-span-full space-y-1.5' : 'space-y-1.5'}>
            <dt className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {cv.field.label}
              {cv.field.onDemand ? <span className="ml-1.5 normal-case tracking-normal text-[10px] text-[hsl(var(--muted-foreground))]">(de este activo)</span> : null}
            </dt>
            <dd className="whitespace-pre-wrap break-words text-sm font-semibold text-[hsl(var(--foreground))]">
              {isLink ? <a href={value} target="_blank" rel="noreferrer" className="text-(--brand-primary) hover:underline">{value}</a> : value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
