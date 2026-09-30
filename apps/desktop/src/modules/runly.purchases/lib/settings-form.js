import { z } from 'zod'
import { STAGES, STAGE_ORDER } from './purchases-constants.js'

// Settings form model: { preset, capabilities, modes: { STAGE: mode }, policies }.
// A stage is part of the flow when its capability is on (CLOSE always).
export const stageEnabled = (type, capabilities) => {
  const cap = STAGES[type]?.capability
  return !cap || Boolean(capabilities?.[cap])
}

export function toFormValues(workflow) {
  const modes = Object.fromEntries((workflow?.stages ?? []).map((s) => [s.type, s.mode]))
  return {
    preset: workflow?.preset ?? 'BASIC',
    capabilities: { ...(workflow?.capabilities ?? {}) },
    modes,
    policies: (workflow?.policies ?? []).map((p, i) => ({
      id: p.id ?? `p${i + 1}`,
      label: p.label ?? '',
      metric: p.when?.metric ?? 'total',
      op: p.when?.op ?? 'gt',
      value: p.when?.metric === 'hasGoods' ? String(Boolean(p.when?.value)) : Number(p.when?.value ?? 0),
      stage: p.require?.stage ?? 'APPROVAL',
      min: p.require?.min ?? '',
    })),
  }
}

export function presetValues(preset) {
  return {
    capabilities: { ...(preset?.capabilities ?? {}) },
    modes: Object.fromEntries((preset?.stages ?? []).map((s) => [s.type, s.mode])),
  }
}

// Stages to show/send, in canonical order, only the enabled ones.
export function flowStages(capabilities, modes) {
  return STAGE_ORDER
    .filter((type) => stageEnabled(type, capabilities) && (type !== 'RELATE' || modes?.RELATE))
    .map((type) => ({ type, mode: modes?.[type] ?? (type === 'CLOSE' ? 'REQUIRED' : 'OPTIONAL') }))
    .filter((s) => s.mode !== 'DISABLED')
}

export function toPayload(values) {
  return {
    preset: values.preset,
    capabilities: values.capabilities,
    stages: flowStages(values.capabilities, values.modes),
    policies: values.policies.map((p) => ({
      id: p.id,
      label: p.label.trim(),
      when: { metric: p.metric, op: p.metric === 'hasGoods' ? 'eq' : p.op, value: p.metric === 'hasGoods' ? p.value === 'true' : Number(p.value) },
      require: { stage: p.stage, ...(p.stage === 'QUOTES' && p.min !== '' && p.min != null ? { min: Number(p.min) } : {}) },
    })),
  }
}

export const settingsSchema = z.object({
  preset: z.string(),
  capabilities: z.record(z.string(), z.boolean()),
  modes: z.record(z.string(), z.string()),
  policies: z.array(z.object({
    id: z.string(),
    label: z.string().trim().min(3, 'Describe la regla').max(160),
    metric: z.enum(['total', 'hasGoods']),
    op: z.enum(['gt', 'gte', 'lt', 'eq']),
    value: z.union([z.number(), z.string()]),
    stage: z.string().min(1, 'Elige la etapa'),
    min: z.union([z.coerce.number().int().min(1).max(10), z.literal('')]).optional(),
  })),
})
