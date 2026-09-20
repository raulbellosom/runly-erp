// apps/desktop/src/modules/runly.ledger/components/CategoryOptions.jsx

// is_system may be absent on some data sources (e.g. the offline cache) —
// treat anything that isn't explicitly true as a personal category so no
// row is ever silently dropped from the dropdown.
export default function CategoryOptions({ categories }) {
  const system = categories.filter((c) => c.is_system === true)
  const personal = categories.filter((c) => c.is_system !== true)
  return (
    <>
      <option value="">Sin categoria</option>
      {system.length > 0 && (
        <optgroup label="Sistema">
          {system.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
      {personal.length > 0 && (
        <optgroup label="Mis categorias">
          {personal.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
    </>
  )
}
