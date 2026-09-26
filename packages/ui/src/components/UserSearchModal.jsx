// packages/ui/src/components/UserSearchModal.jsx
import { useState, useEffect, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from './Dialog.jsx'
import { Button } from './Button.jsx'
import { SelectField } from './FormFields.jsx'
import { SearchInput } from './SearchInput.jsx'
import { User, X } from 'lucide-react'
import { buildApiHeaders } from '../lib/apiHeaders.js'

export function UserSearchModal({ open, onClose, onConfirm, roles = [], excludeIds = [], apiBase, token, companyId = null }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState(null)
  const [role, setRole]         = useState(roles[0]?.value ?? '')
  const debounceRef             = useRef(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setSelected(null)
      setRole(roles[0]?.value ?? '')
    }
  }, [open, roles])

  useEffect(() => {
    // Once a user is selected, the picker list is hidden — no need to fetch.
    if (!open || selected) return
    const isSearching = query.length >= 2
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: isSearching ? '10' : '20' })
        if (isSearching) params.set('q', query)
        const res = await fetch(
          `${apiBase}/users/search?${params.toString()}`,
          { headers: buildApiHeaders(token, companyId) }
        )
        if (!res.ok) { setResults([]); return }
        const json = await res.json()
        setResults((json.data ?? []).filter((u) => !excludeIds.includes(u.id)))
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
      // No debounce needed for the default (no-query) listing fetched on open.
    }, isSearching ? 300 : 0)
    return () => clearTimeout(debounceRef.current)
  }, [open, selected, query, apiBase, token, companyId, excludeIds])

  function handleConfirm() {
    if (!selected || !role) return
    onConfirm(selected.id, role)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buscar usuario</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!selected && (
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery('')}
              placeholder="Nombre o correo electrónico..."
              autoFocus
            />
          )}

          {!selected && (
            <div className="max-h-52 overflow-y-auto rounded-md border border-[hsl(var(--border))]">
              {loading && (
                <div className="p-3 text-sm text-[hsl(var(--muted-foreground))]">Buscando...</div>
              )}
              {!loading && results.length === 0 && (
                <div className="p-3 text-sm text-[hsl(var(--muted-foreground))]">No se encontraron usuarios.</div>
              )}
              {!loading && results.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelected(user)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[hsl(var(--muted)/0.5)] transition-colors"
                >
                  <div className="shrink-0 w-7 h-7 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                    <User size={12} className="text-[hsl(var(--muted-foreground))]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{user.display_name}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{user.email}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2">
              <div className="shrink-0 w-7 h-7 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                <User size={12} className="text-[hsl(var(--muted-foreground))]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{selected.display_name}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{selected.email}</div>
              </div>
              <button
                type="button"
                onClick={() => { setSelected(null); setQuery('') }}
                className="shrink-0 rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                aria-label="Quitar usuario seleccionado"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {selected && roles.length > 0 && (
            <SelectField
              label="Rol"
              id="user-search-role"
              value={role}
              onValueChange={setRole}
              options={roles.map((r) => ({ value: r.value, label: r.label }))}
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={handleConfirm}
              disabled={!selected || !role}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
