import { companyFetch } from '../../lib/companyFetch.js'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApiUrl } from '../../lib/runtimeConfig.js'
import {
  Card, TextField, ComboboxField, Button, SwitchField,
} from '@runly/ui'
import { toast } from 'sonner'

export default function FormSettingsPanel({ form, token, assignees, turnstileConfigured, onSaved, basePath = '/website' }) {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState({
    name:                   form.name                   ?? '',
    description:            form.description            ?? '',
    submitLabel:            form.submitLabel            ?? 'Enviar',
    successMessage:         form.successMessage         ?? '',
    notifyEmail:            form.notifyEmail            ?? '',
    createsLead:            form.createsLead            ?? true,
    defaultAssigneeUserId:  form.defaultAssigneeUserId  ?? '',
    honeypotEnabled:        form.honeypotEnabled        ?? true,
    turnstileRequired:      form.turnstileRequired      ?? false,
    wizardMode:             form.wizardMode             ?? false,
  })

  const set = (key, val) => setSettings(s => ({ ...s, [key]: val }))

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(`${getApiUrl()}${basePath}/forms/${form.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          description:           settings.description.trim()    || undefined,
          successMessage:        settings.successMessage.trim() || undefined,
          notifyEmail:           settings.notifyEmail.trim()    || null,
          defaultAssigneeUserId: settings.defaultAssigneeUserId || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = typeof body.error === 'string' ? body.error : body.error?.message || `HTTP ${res.status}`
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Configuración guardada')
      queryClient.invalidateQueries({ queryKey: ['website-form-detail', form.id] })
      queryClient.invalidateQueries({ queryKey: ['website-forms'] })
      onSaved()
    },
    onError: err => toast.error(err.message),
  })

  const assigneeOptions = [
    { value: '', label: 'Sin responsable predeterminado' },
    ...assignees.map(a => ({ value: a.id, label: `${a.displayName} (${a.email})` })),
  ]

  return (
    <Card className="p-5">
      <form
        className="space-y-4"
        onSubmit={e => { e.preventDefault(); mutation.mutate() }}
      >
        <div className="grid md:grid-cols-2 gap-4">
          <TextField
            label="Nombre del formulario"
            value={settings.name}
            onChange={e => set('name', e.target.value)}
            required
          />
          <TextField
            label="Texto del botón de envío"
            value={settings.submitLabel}
            onChange={e => set('submitLabel', e.target.value)}
          />
        </div>

        <TextField
          label="Descripción (opcional)"
          value={settings.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Descripción breve que aparece sobre los campos"
        />

        <TextField
          label="Mensaje de éxito"
          value={settings.successMessage}
          onChange={e => set('successMessage', e.target.value)}
          placeholder="Gracias, te contactamos pronto."
        />

        <div className="grid md:grid-cols-2 gap-4">
          <TextField
            label="Notificar por email (opcional)"
            type="email"
            value={settings.notifyEmail}
            onChange={e => set('notifyEmail', e.target.value)}
            placeholder="tu@empresa.com"
          />
          <ComboboxField
            label="Responsable predeterminado"
            options={assigneeOptions}
            value={settings.defaultAssigneeUserId}
            onChange={v => set('defaultAssigneeUserId', v)}
            placeholder="Seleccionar responsable..."
            searchPlaceholder="Buscar usuario..."
          />
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-3">
          <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
            Comportamiento
          </p>
          <SwitchField
            id={`form-${form.id}-lead`}
            label="Crear lead automáticamente"
            description="Guarda cada envío como un lead en runly.growth"
            checked={settings.createsLead}
            onChange={checked => set('createsLead', checked)}
          />
          <SwitchField
            id={`form-${form.id}-honeypot`}
            label="Activar honeypot anti-spam"
            description="Campo oculto que atrapa bots sin molestar al usuario"
            checked={settings.honeypotEnabled}
            onChange={checked => set('honeypotEnabled', checked)}
          />
          <SwitchField
            id={`form-${form.id}-turnstile`}
            label="Requerir Turnstile (CAPTCHA)"
            description={
              turnstileConfigured
                ? 'Verificación anti-bot de Cloudflare'
                : 'Configura las claves de Turnstile en Ajustes primero'
            }
            checked={settings.turnstileRequired}
            disabled={!turnstileConfigured}
            onChange={checked => set('turnstileRequired', checked)}
          />
          <SwitchField
            id={`form-${form.id}-wizard`}
            label="Modo paso a paso (wizard)"
            description="Divide el formulario en pasos numerados. Configura el paso de cada campo en la pestaña Campos."
            checked={settings.wizardMode}
            onChange={checked => set('wizardMode', checked)}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !settings.name.trim()}>
            {mutation.isPending ? 'Guardando...' : 'Guardar configuración'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
