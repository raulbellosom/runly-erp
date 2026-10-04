// Builder automations (definition.automations): a trigger (this module's record
// saved, or a system domain event) plus one module-service call with argument
// mapping. Spec docs/superpowers/specs/2026-10-04-builder-automations-design.md.
// Validated against the shared service contract; the manifest's `consumes` and
// `events.subscribes` are derived from them (never written by hand).
import { DOMAIN_EVENTS, DOMAIN_EVENT_PAYLOADS, SERVICE_CONTRACTS, validateServiceArgs } from '@runly/module-engine/contracts'

export const MAX_AUTOMATIONS = 20
export const AUTOMATION_ARG_SOURCES = Object.freeze(['value', 'field', 'template', 'recordId', 'actor'])
export const RECORD_TRIGGER_ON = Object.freeze(['create', 'update', 'save'])
export const CONDITION_OPS = Object.freeze(['equals', 'changed', 'filled'])
// Filled in by the runtime, never required from the Builder user.
export const AUTOMATIC_ARGS = Object.freeze(['sourceEntityId', 'idempotencyKey'])

const KEY = /^[a-z][a-z0-9_]{1,40}$/
const UNSAFE_TEXT = /[\r\n`]/
const fieldKey = (field) => field.key ?? field.name
const entityKey = (entity) => entity.key ?? entity.name

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

// Services an automation can call (writes only); event triggers need system ones.
export function automationServices({ trigger = 'record' } = {}) {
  return Object.entries(SERVICE_CONTRACTS)
    .filter(([, contract]) => contract.mutates && (trigger !== 'event' || contract.system))
    .map(([key, contract]) => ({ key, label: contract.label, args: contract.args, system: Boolean(contract.system) }))
}

export function automationEvents() {
  return Object.entries(DOMAIN_EVENTS).map(([key, label]) => ({ key, label, payload: [...(DOMAIN_EVENT_PAYLOADS[key] ?? [])] }))
}

// { 'runly.calendar': ['events.create'], ... } from the automations' services.
export function automationConsumes(definition) {
  const consumes = {}
  for (const automation of definition.automations ?? []) {
    const [owner, name] = String(automation?.action?.service ?? '').split(':')
    if (!Object.hasOwn(SERVICE_CONTRACTS, automation?.action?.service ?? '')) throw new Error('AUTOMATION_SERVICE_UNKNOWN')
    consumes[owner] ??= []
    if (!consumes[owner].includes(name)) consumes[owner].push(name)
  }
  return consumes
}

export function automationServiceKeys(definition) {
  return [...new Set((definition.automations ?? []).map((automation) => automation?.action?.service).filter(Boolean))]
}

export function automationEventKeys(definition) {
  return [...new Set((definition.automations ?? []).filter((a) => a?.trigger?.type === 'event').map((a) => a.trigger.event))]
}

function validateCondition(when, { base, fieldNames, trigger, errors }) {
  if (when === undefined || when === null) return
  if (typeof when !== 'object' || Array.isArray(when)) { errors.push(diagnostic(`${base}.trigger.when`, 'AUTOMATION_CONDITION_INVALID', 'Condition must be an object.')); return }
  if (!fieldNames.has(when.field)) errors.push(diagnostic(`${base}.trigger.when.field`, 'AUTOMATION_FIELD_NOT_FOUND', `Field "${when.field}" is not available for this trigger.`))
  if (!CONDITION_OPS.includes(when.op)) errors.push(diagnostic(`${base}.trigger.when.op`, 'AUTOMATION_CONDITION_INVALID', `Condition must be one of ${CONDITION_OPS.join(', ')}.`))
  if (when.op === 'changed' && (trigger.type !== 'record' || trigger.on === 'create')) {
    errors.push(diagnostic(`${base}.trigger.when.op`, 'AUTOMATION_CONDITION_INVALID', '"changed" only applies when a record is updated.'))
  }
  if (when.op === 'equals' && !['string', 'number', 'boolean'].includes(typeof when.value)) {
    errors.push(diagnostic(`${base}.trigger.when.value`, 'AUTOMATION_CONDITION_INVALID', '"equals" needs a text, number or boolean value.'))
  }
}

function validateArgs(automation, { base, fieldNames, trigger, contract, errors }) {
  const args = automation.action?.args === undefined ? {} : automation.action.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) { errors.push(diagnostic(`${base}.action.args`, 'AUTOMATION_ARGS_INVALID', 'Args must be an object.')); return }
  for (const [name, source] of Object.entries(args)) {
    const path = `${base}.action.args.${name}`
    if (!contract.args[name] || name === 'idempotencyKey') { errors.push(diagnostic(path, 'AUTOMATION_ARG_UNKNOWN', `The service does not accept "${name}".`)); continue }
    if (!source || !AUTOMATION_ARG_SOURCES.includes(source.from)) { errors.push(diagnostic(path, 'AUTOMATION_ARG_INVALID', `Source must be one of ${AUTOMATION_ARG_SOURCES.join(', ')}.`)); continue }
    if (source.from === 'field' && !fieldNames.has(source.field)) errors.push(diagnostic(path, 'AUTOMATION_FIELD_NOT_FOUND', `Field "${source.field}" is not available for this trigger.`))
    if (source.from === 'template') {
      if (typeof source.template !== 'string' || !source.template.trim() || source.template.length > 1000 || UNSAFE_TEXT.test(source.template)) {
        errors.push(diagnostic(path, 'AUTOMATION_ARG_INVALID', 'Template must be a single line of text (max 1000).'))
      } else {
        for (const [, ref] of source.template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
          if (!fieldNames.has(ref) && ref !== 'id') errors.push(diagnostic(path, 'AUTOMATION_FIELD_NOT_FOUND', `Template field "${ref}" is not available for this trigger.`))
        }
      }
    }
    if (source.from === 'actor' && trigger.type !== 'record') errors.push(diagnostic(path, 'AUTOMATION_ARG_INVALID', 'The current user is only known when a record is saved.'))
    if (source.from === 'value') {
      const checked = validateServiceArgs(automation.action.service, { [name]: source.value })
      if (checked.errors[name]) errors.push(diagnostic(path, 'AUTOMATION_ARG_INVALID', `Value: ${checked.errors[name]}.`))
    }
  }
  for (const [name, spec] of Object.entries(contract.args)) {
    if (spec.required && !AUTOMATIC_ARGS.includes(name) && !args[name]) {
      errors.push(diagnostic(`${base}.action.args.${name}`, 'AUTOMATION_ARG_REQUIRED', `"${name}" is required by the service.`))
    }
  }
}

export function validateDefinitionAutomations(definition, errors) {
  const list = definition.automations
  if (list === undefined || list === null) return
  if (!Array.isArray(list)) { errors.push(diagnostic('automations', 'AUTOMATIONS_INVALID', 'automations must be an array.')); return }
  if (list.length > MAX_AUTOMATIONS) errors.push(diagnostic('automations', 'AUTOMATIONS_LIMIT', `At most ${MAX_AUTOMATIONS} automations.`))
  const entities = new Map((definition.entities ?? []).map((entity) => [entityKey(entity), entity]))
  const keys = new Set()
  list.forEach((automation, index) => {
    const base = `automations[${index}]`
    if (!automation || typeof automation !== 'object') { errors.push(diagnostic(base, 'AUTOMATIONS_INVALID', 'Automation must be an object.')); return }
    if (!KEY.test(automation.key ?? '')) errors.push(diagnostic(`${base}.key`, 'AUTOMATION_KEY_INVALID', 'Key must be lowercase snake_case (2-41 chars).'))
    if (keys.has(automation.key)) errors.push(diagnostic(`${base}.key`, 'AUTOMATION_KEY_DUPLICATE', `Duplicate automation key "${automation.key}".`))
    keys.add(automation.key)
    if (typeof automation.label !== 'string' || !automation.label.trim() || automation.label.length > 120 || UNSAFE_TEXT.test(automation.label)) errors.push(diagnostic(`${base}.label`, 'AUTOMATION_LABEL_INVALID', 'Label is required (one line, max 120).'))
    if (automation.enabled !== undefined && typeof automation.enabled !== 'boolean') errors.push(diagnostic(`${base}.enabled`, 'AUTOMATIONS_INVALID', 'enabled must be boolean.'))

    const trigger = automation.trigger ?? {}
    let fieldNames = new Set()
    if (trigger.type === 'record') {
      const entity = entities.get(trigger.entity)
      if (!entity) errors.push(diagnostic(`${base}.trigger.entity`, 'AUTOMATION_ENTITY_NOT_FOUND', `Entity "${trigger.entity}" does not exist.`))
      else fieldNames = new Set((entity.fields ?? []).map(fieldKey))
      if (!RECORD_TRIGGER_ON.includes(trigger.on)) errors.push(diagnostic(`${base}.trigger.on`, 'AUTOMATION_TRIGGER_INVALID', `on must be one of ${RECORD_TRIGGER_ON.join(', ')}.`))
    } else if (trigger.type === 'event') {
      if (!DOMAIN_EVENTS[trigger.event]) errors.push(diagnostic(`${base}.trigger.event`, 'AUTOMATION_EVENT_UNKNOWN', `Unknown event "${trigger.event}".`))
      fieldNames = new Set(DOMAIN_EVENT_PAYLOADS[trigger.event] ?? [])
    } else {
      errors.push(diagnostic(`${base}.trigger.type`, 'AUTOMATION_TRIGGER_INVALID', 'Trigger type must be record or event.'))
    }
    validateCondition(trigger.when, { base, fieldNames, trigger, errors })

    const contract = Object.hasOwn(SERVICE_CONTRACTS, automation.action?.service ?? '') ? SERVICE_CONTRACTS[automation.action.service] : null
    if (!contract) { errors.push(diagnostic(`${base}.action.service`, 'AUTOMATION_SERVICE_UNKNOWN', `Unknown service "${automation.action?.service}".`)); return }
    if (!contract.mutates) errors.push(diagnostic(`${base}.action.service`, 'AUTOMATION_SERVICE_READONLY', 'Automations can only call services that create or change records.'))
    if (trigger.type === 'event' && !contract.system) {
      errors.push(diagnostic(`${base}.action.service`, 'AUTOMATION_SERVICE_NEEDS_USER', `"${contract.label}" needs a person and cannot run from a system event.`))
    }
    validateArgs(automation, { base, fieldNames, trigger, contract, errors })
  })
}

export function normalizeAutomations(list) {
  return list.map((automation) => ({
    key: automation.key,
    label: automation.label.trim(),
    enabled: automation.enabled !== false,
    trigger: automation.trigger.type === 'record'
      ? { type: 'record', entity: automation.trigger.entity, on: automation.trigger.on, ...(automation.trigger.when ? { when: automation.trigger.when } : {}) }
      : { type: 'event', event: automation.trigger.event, ...(automation.trigger.when ? { when: automation.trigger.when } : {}) },
    action: { service: automation.action.service, args: automation.action.args ?? {} },
  }))
}
