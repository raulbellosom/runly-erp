import { useState } from 'react'
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { getApiUrl } from '../../lib/runtimeConfig.js'
import { Card } from '@runly/ui'
import { toast } from 'sonner'

function useCopy(text) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar')
    }
  }
  return { copied, copy }
}

function CodePanel({ code, language = 'json' }) {
  const { copied, copy } = useCopy(code)
  return (
    <div className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] overflow-hidden">
      <button
        type="button"
        onClick={copy}
        title="Copiar"
        className="absolute top-2 right-2 p-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
      >
        {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
      </button>
      <pre className="text-xs font-mono text-[hsl(var(--foreground))] p-4 pr-10 overflow-x-auto leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.5)] transition-colors"
      >
        {title}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

function fieldValueComment(f) {
  const req = f.required ? 'requerido' : 'opcional'
  if (f.fieldType === 'select' || f.fieldType === 'radio') {
    const opts = (f.options ?? []).map(o => typeof o === 'string' ? `"${o}"` : `"${o.label}"`).join(' | ')
    return `${opts}  // ${req}`
  }
  if (f.fieldType === 'card_select') {
    const opts = (f.options ?? []).map(o => `"${o.value ?? o.label}"`).join(' | ')
    return `${opts}  // ${req}`
  }
  if (f.fieldType === 'chip_multi') {
    const opts = (f.options ?? []).join(', ')
    return `"opcion1,opcion2"  // multi-select, separado por comas — ${req}`
  }
  if (f.fieldType === 'checkbox') return `"true" | "false"  // ${req}`
  if (f.fieldType === 'number') return `"123"  // ${req}`
  if (f.fieldType === 'date') return `"2025-01-31"  // ${req}`
  return `"..."  // ${f.fieldType}, ${req}`
}

export default function FormApiPanel({ form }) {
  if (!form) return null

  const base = getApiUrl()
  const fields = [...(form.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  const getUrl  = `${base}/public/storefront/v1/forms/${form.id}`
  const postUrl = `${base}/public/storefront/v1/forms/${form.id}/submissions`

  const valuesLines = fields.map(f => `    "${f.name}": ${fieldValueComment(f)}`).join(',\n')

  const payloadExample = `{
  "values": {
${valuesLines}
  },
  "honeypot": ""
}`

  const responseGetExample = `{
  "data": {
    "id": "${form.id}",
    "name": "${form.name}",
    "submitLabel": "${form.submitLabel ?? 'Enviar'}",
    "wizardMode": ${Boolean(form.wizardMode)},
    "fields": [
      /* cada campo tiene: id, name, label, fieldType, required, options, sortOrder, stepNumber */
    ]
  }
}`

  const fetchExample = `const BASE = '${base}'
const FORM_ID = '${form.id}'

// 1. Obtener definición del formulario
const def = await fetch(\`\${BASE}/public/storefront/v1/forms/\${FORM_ID}\`)
  .then(r => r.json())

// 2. Enviar respuestas
const res = await fetch(\`\${BASE}/public/storefront/v1/forms/\${FORM_ID}/submissions\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({
    values: {
${fields.map(f => `      ${f.name}: ''  // ${f.fieldType}`).join(',\n')}
    },
    honeypot: '',
  }),
})

const data = await res.json()
// { data: { id, replayed, leadId? }, ok: true }`

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-[hsl(var(--foreground))] mb-0.5">Referencia de API</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Usa estos endpoints para construir una UI personalizada que envíe datos a este formulario.
        </p>
      </div>

      {/* Endpoints */}
      <Section title="Endpoints">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono">GET</span>
            <code className="text-xs font-mono text-[hsl(var(--foreground))] break-all">{getUrl}</code>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] pl-10">Devuelve la definición del formulario con todos sus campos.</p>

          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-mono">POST</span>
            <code className="text-xs font-mono text-[hsl(var(--foreground))] break-all">{postUrl}</code>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] pl-10">Envía las respuestas del formulario. Requiere <code className="font-mono">Idempotency-Key</code> header.</p>
        </div>
      </Section>

      {/* Campos definidos */}
      <Section title={`Campos (${fields.length})`}>
        {fields.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Este formulario no tiene campos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[hsl(var(--muted-foreground))] text-left">
                  <th className="pb-2 pr-4 font-semibold">name</th>
                  <th className="pb-2 pr-4 font-semibold">tipo</th>
                  <th className="pb-2 pr-4 font-semibold">req.</th>
                  {form.wizardMode && <th className="pb-2 pr-4 font-semibold">paso</th>}
                  <th className="pb-2 font-semibold">opciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {fields.map(f => {
                  const opts = f.options
                    ? Array.isArray(f.options)
                      ? f.options.map(o => typeof o === 'string' ? o : o.label).join(', ')
                      : ''
                    : '—'
                  return (
                    <tr key={f.id}>
                      <td className="py-1.5 pr-4 font-mono text-[hsl(var(--foreground))]">{f.name}</td>
                      <td className="py-1.5 pr-4 text-violet-500 font-mono">{f.fieldType}</td>
                      <td className="py-1.5 pr-4">{f.required ? <span className="text-red-400">sí</span> : <span className="text-[hsl(var(--muted-foreground))]">no</span>}</td>
                      {form.wizardMode && <td className="py-1.5 pr-4 text-[hsl(var(--muted-foreground))]">{f.stepNumber}</td>}
                      <td className="py-1.5 text-[hsl(var(--muted-foreground))] truncate max-w-[180px]">{opts}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Payload */}
      <Section title="Payload (POST body)">
        <CodePanel code={payloadExample} />
      </Section>

      {/* Respuesta GET */}
      <Section title="Respuesta GET" defaultOpen={false}>
        <CodePanel code={responseGetExample} />
      </Section>

      {/* Ejemplo fetch */}
      <Section title="Ejemplo completo (fetch)" defaultOpen={false}>
        <CodePanel code={fetchExample} language="js" />
      </Section>
    </Card>
  )
}
