// "Crear con IA" (spec 2026-10-03-rme3-module-platform-v2 §5 goal 9, plan
// Task 5.2): MirAI turns a plain-language description into a Builder
// ModuleDefinition. The model answers a small JSON contract; the compiler
// validates it and, on diagnostics, the model gets one repair round. The
// result is a draft for the user to review — nothing is created here.
import { FIELD_TYPES, MODULE_ICON_NAMES } from '@runly/module-engine'
import { EXTERNAL_RELATION_TARGETS, normalizeModuleDefinition, validateModuleDefinition } from '@runly/module-compiler'
import { createAiRouter } from './ai/ai-router.js'
import { isLocalEnabled } from './ai/ai-providers.js'

export class BuilderAiDraftError extends Error {
  constructor(message, status = 502, code = 'ai_draft_failed') {
    super(message)
    this.status = status
    this.code = code
  }
}

const FIELD_TYPE_LIST = Object.values(FIELD_TYPES).filter((type) => !['json', 'file'].includes(type))
const SYSTEM_TARGETS = Object.entries(EXTERNAL_RELATION_TARGETS).map(([type, target]) => `${type} (${target.moduleName} · ${target.label})`)
const MAX_DESCRIPTION = 2000

export function buildSystemPrompt() {
  return [
    'You design data modules for Runly ERP. Answer ONLY a JSON object with this exact shape:',
    '{"name": string, "description": string, "icon": string, "entities": [{"key": string, "label": string, "pluralLabel": string,',
    '  "fields": [{"key": string, "label": string, "type": string, "required"?: boolean, "options"?: [{"value": string, "label": string}],',
    '  "targetEntity"?: string, "targetExternal"?: string}]}], "kanban"?: {"entity": string, "groupBy": string}}',
    'Rules:',
    '- All user-facing text (name, labels, option labels, description) in Spanish. Keys in lowercase snake_case ASCII, starting with a letter.',
    '- 1 to 4 entities, 3 to 12 fields each. Never use the keys id, company_id, enabled, created_at, updated_at.',
    `- Field types: ${FIELD_TYPE_LIST.join(', ')}. Use "select" with 2-8 options for states/categories (option values snake_case).`,
    '- Relations: type "relation" with targetEntity = another entity key of THIS module, or targetExternal = one of these system entities:',
    `  ${SYSTEM_TARGETS.join('; ')}. Prefer system entities for people, customers, equipment and projects instead of duplicating them.`,
    '- Mark as required only what is essential (usually the name/title and key relations).',
    `- icon: one of ${MODULE_ICON_NAMES.slice(0, 120).join(', ')}.`,
    '- kanban (optional): only when an entity has a status-like select field; groupBy is that field key.',
  ].join('\n')
}

function moduleKeyFor(name) {
  const slug = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'modulo'
  return `custom.${/^[a-z]/.test(slug) ? slug : `m${slug}`}`
}

// Model JSON -> Builder ModuleDefinition (only the contract's properties survive).
export function draftToDefinition(draft, { moduleKey } = {}) {
  const name = String(draft?.name ?? '').trim() || 'Módulo nuevo'
  const key = moduleKey || moduleKeyFor(name)
  const entities = (Array.isArray(draft?.entities) ? draft.entities : []).slice(0, 6).map((entity) => ({
    key: String(entity?.key ?? ''),
    label: String(entity?.label ?? entity?.key ?? ''),
    pluralLabel: String(entity?.pluralLabel ?? `${entity?.label ?? entity?.key ?? ''}s`),
    companyScoped: true,
    softDelete: true,
    fields: (Array.isArray(entity?.fields) ? entity.fields : []).slice(0, 30).map((field) => ({
      key: String(field?.key ?? ''),
      label: String(field?.label ?? field?.key ?? ''),
      type: String(field?.type ?? 'text'),
      ...(field?.required ? { required: true } : {}),
      ...(Array.isArray(field?.options) ? { options: field.options.map((option) => (typeof option === 'string' ? { value: option, label: option } : { value: String(option?.value ?? ''), label: String(option?.label ?? option?.value ?? '') })) } : {}),
      ...(field?.targetEntity ? { targetEntity: String(field.targetEntity) } : {}),
      ...(field?.targetExternal ? { targetExternal: String(field.targetExternal) } : {}),
    })),
  }))
  const slug = key.split('.').pop()
  const kanbanEntity = entities.find((entity) => entity.key === draft?.kanban?.entity)
  const groupBy = draft?.kanban?.groupBy
  // Card title: first readable field; without one the Kanban is skipped.
  const titleField = kanbanEntity?.fields.find((field) => ['text', 'textarea', 'markdown', 'email', 'phone'].includes(field.type))
    ?? kanbanEntity?.fields.find((field) => !['relation', 'file', 'json', 'boolean'].includes(field.type) && field.key !== groupBy)
  const views = kanbanEntity && titleField && kanbanEntity.fields.some((field) => field.key === groupBy && field.type === 'select')
    ? [{ key: `${slug}.${kanbanEntity.key}.kanban`, kind: 'KANBAN', entity: kanbanEntity.key, title: `${kanbanEntity.pluralLabel} por estado`, groupBy, card: { titleField: titleField.key } }]
    : []
  return {
    schemaVersion: 1,
    key,
    name,
    version: '0.1.0',
    description: String(draft?.description ?? ''),
    icon: MODULE_ICON_NAMES.includes(draft?.icon) ? draft.icon : 'Boxes',
    color: '#2563EB',
    pwa: { shortName: name.slice(0, 14), startPath: `/${slug}` },
    preset: 'crud',
    entities,
    ...(views.length ? { views } : {}),
  }
}

export function definitionErrors(definition) {
  try {
    return validateModuleDefinition(normalizeModuleDefinition(definition)).errors
  } catch (error) {
    return [{ path: '', code: 'INVALID', message: error.message }]
  }
}

function parseJson(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    return JSON.parse(raw)
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw)
    if (match) return JSON.parse(match[0])
    throw new BuilderAiDraftError('La IA no devolvió una definición válida. Intenta describirlo de otra forma.', 502)
  }
}

export function createBuilderAiDraftService({ env = process.env, fetchImpl, aiRouter = null } = {}) {
  const router = aiRouter ?? createAiRouter({ env, fetchImpl })
  const isConfigured = () => Boolean(env.GROQ_API_KEY) || isLocalEnabled(env)

  async function ask(messages) {
    const { message } = await router.runTask({ task: 'builder_draft', messages, jsonMode: true, maxTokens: 4000, temperature: 0.2, timeoutMs: 60_000 })
    return parseJson(message?.content ?? message)
  }

  async function draft({ description, moduleKey = null }) {
    if (!isConfigured()) throw new BuilderAiDraftError('La IA no está configurada en esta instancia.', 503, 'ai_unavailable')
    const text = String(description ?? '').trim()
    if (text.length < 10) throw new BuilderAiDraftError('Describe el módulo con un poco más de detalle.', 422, 'description_too_short')
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text.slice(0, MAX_DESCRIPTION) },
    ]
    let answer = await ask(messages)
    let definition = draftToDefinition(answer, { moduleKey })
    let errors = definitionErrors(definition)
    let attempts = 1
    if (errors.length) {
      attempts = 2
      answer = await ask([
        ...messages,
        { role: 'assistant', content: JSON.stringify(answer) },
        { role: 'user', content: `The Runly compiler rejected it. Fix ONLY these problems and answer the full JSON again:\n${errors.slice(0, 20).map((error) => `- ${error.path}: ${error.message}`).join('\n')}` },
      ])
      definition = draftToDefinition(answer, { moduleKey })
      errors = definitionErrors(definition)
    }
    return { definition, errors, attempts }
  }

  return { isConfigured, draft }
}
