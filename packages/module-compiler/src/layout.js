// Entity layout contract (tabs -> sections -> fields, detail hero/KPIs, open
// mode, visibility rules, optional independent detail tree) and file field
// options for Builder-made modules. See
// docs/superpowers/specs/2026-09-27-rme3-builder-layout-media-design.md and
// docs/superpowers/specs/2026-09-28-rme3-builder-conditional-layout-design.md.

import { validateRelatedSource } from './relations.js'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const UNSAFE_SOURCE_TEXT = /['\\\r\n]/
const LAYOUT_MODES = new Set(['auto', 'page', 'sheet'])
const FILE_ACCEPT = new Set(['image', 'document', 'any'])
const KPI_TYPES = new Set(['number', 'decimal', 'date', 'datetime', 'select'])
const RULE_OPERATORS = ['equals', 'notEquals', 'in', 'truthy']
const RULE_FIELD_TYPES = new Set(['select', 'boolean'])
const MAX_TABS = 8
const MAX_KPIS = 4
export const FILE_MAX_SIZE_MB = 10
export const OTHER_SECTION_KEY = 'otros_datos'

function diagnostic(path, code, message, severity = 'error') {
  return { path, code, message, severity }
}

export function isImageFileField(field) {
  return field?.type === 'file' && field.accept === 'image'
}

export function validateFileFieldOptions(field, path, errors) {
  if (field.type !== 'file') return
  if (field.accept !== undefined && !FILE_ACCEPT.has(field.accept)) errors.push(diagnostic(`${path}.accept`, 'FILE_INVALID_ACCEPT', 'accept must be image, document or any.'))
  if (field.camera && field.accept !== 'image') errors.push(diagnostic(`${path}.camera`, 'FILE_CAMERA_REQUIRES_IMAGE', 'Camera capture requires accept: image.'))
  if (field.maxSizeMB !== undefined && !(Number.isInteger(field.maxSizeMB) && field.maxSizeMB >= 1 && field.maxSizeMB <= FILE_MAX_SIZE_MB)) {
    errors.push(diagnostic(`${path}.maxSizeMB`, 'FILE_MAX_SIZE_OUT_OF_RANGE', `maxSizeMB must be an integer between 1 and ${FILE_MAX_SIZE_MB}.`))
  }
}

function checkLabel(value, path, errors) {
  if (!String(value ?? '').trim()) errors.push(diagnostic(path, 'REQUIRED', `${path} is required.`))
  else if (UNSAFE_SOURCE_TEXT.test(value)) errors.push(diagnostic(path, 'UNSAFE_SOURCE_TEXT', `${path} contains characters that cannot be emitted safely.`))
}

function optionValues(field) {
  if (field.type === 'boolean') return [true, false]
  return (field.options ?? []).map((option) => (typeof option === 'object' ? option.value : option))
}

// Validates one visibility rule `{ field, equals | notEquals | in | truthy }`.
// `ownFields` are the fields inside the element the rule controls.
export function validateRule(rule, fields, path, errors, ownFields = []) {
  if (rule === undefined || rule === null) return
  if (typeof rule !== 'object' || Array.isArray(rule)) { errors.push(diagnostic(path, 'LAYOUT_RULE_INVALID', 'Visibility rule must be an object.')); return }
  const field = fields.get(rule.field)
  if (!field) { errors.push(diagnostic(`${path}.field`, 'LAYOUT_RULE_FIELD_NOT_FOUND', `Rule field "${rule.field}" does not exist.`)); return }
  if (!RULE_FIELD_TYPES.has(field.type)) errors.push(diagnostic(`${path}.field`, 'LAYOUT_RULE_FIELD_TYPE', 'Rule field must be a select or boolean field.'))
  if (ownFields.includes(rule.field)) errors.push(diagnostic(`${path}.field`, 'LAYOUT_RULE_SELF_HIDING', `"${rule.field}" cannot control an element that contains it.`))
  const operators = RULE_OPERATORS.filter((operator) => Object.prototype.hasOwnProperty.call(rule, operator))
  if (operators.length !== 1) { errors.push(diagnostic(path, 'LAYOUT_RULE_INVALID', 'Rule needs exactly one of equals, notEquals, in, truthy.')); return }
  const [operator] = operators
  if (operator === 'truthy') {
    if (typeof rule.truthy !== 'boolean') errors.push(diagnostic(`${path}.truthy`, 'LAYOUT_RULE_INVALID', 'truthy must be true or false.'))
    return
  }
  const values = operator === 'in' ? rule.in : [rule[operator]]
  if (!Array.isArray(values) || !values.length) { errors.push(diagnostic(`${path}.in`, 'LAYOUT_RULE_INVALID', 'in must be a non-empty array.')); return }
  const allowed = optionValues(field)
  for (const value of values) if (!allowed.includes(value)) errors.push(diagnostic(path, 'LAYOUT_RULE_UNKNOWN_OPTION', `Value "${value}" is not an option of "${rule.field}".`))
}

// Structural + rule validation of one tabs tree (form or detail).
function validateTree(tabs, fields, path, errors, warnings, context) {
  if (!Array.isArray(tabs) || tabs.length < 1 || tabs.length > MAX_TABS) {
    errors.push(diagnostic(path, 'LAYOUT_INVALID_TABS', `Layout requires between 1 and ${MAX_TABS} tabs.`))
    return
  }
  const placed = new Set()
  const keys = new Set()
  let attachments = 0
  tabs.forEach((tab, tabIndex) => {
    const tabPath = `${path}[${tabIndex}]`
    if (!IDENTIFIER.test(tab?.key ?? '') || keys.has(tab.key)) errors.push(diagnostic(`${tabPath}.key`, 'LAYOUT_INVALID_KEY', 'Tab key must be a unique snake_case identifier.'))
    keys.add(tab?.key)
    checkLabel(tab?.label, `${tabPath}.label`, errors)
    if (!Array.isArray(tab?.sections)) { errors.push(diagnostic(`${tabPath}.sections`, 'LAYOUT_INVALID_SECTIONS', 'Tab sections must be an array.')); return }
    validateRule(tab.visibleWhen, fields, `${tabPath}.visibleWhen`, errors, tab.sections.flatMap((section) => section?.fields ?? []))
    tab.sections.forEach((section, sectionIndex) => {
      const sectionPath = `${tabPath}.sections[${sectionIndex}]`
      if (!IDENTIFIER.test(section?.key ?? '') || keys.has(section.key)) errors.push(diagnostic(`${sectionPath}.key`, 'LAYOUT_INVALID_KEY', 'Section key must be a unique snake_case identifier.'))
      keys.add(section?.key)
      checkLabel(section?.label, `${sectionPath}.label`, errors)
      validateRule(section?.visibleWhen, fields, `${sectionPath}.visibleWhen`, errors, section?.fields ?? [])
      const type = section?.type ?? 'fields'
      if (type === 'attachments') {
        attachments += 1
        if (attachments > 1) errors.push(diagnostic(sectionPath, 'LAYOUT_MULTIPLE_ATTACHMENTS', 'Only one attachments section is allowed per entity.'))
        if (section.placement !== undefined && !['embedded', 'aside'].includes(section.placement)) errors.push(diagnostic(`${sectionPath}.placement`, 'LAYOUT_INVALID_PLACEMENT', 'Placement must be embedded or aside.'))
        return
      }
      if (type === 'related') {
        validateRelatedSource(section, context.entityKey, context.entities, sectionPath, errors)
        return
      }
      if (type !== 'fields') { errors.push(diagnostic(`${sectionPath}.type`, 'LAYOUT_INVALID_SECTION_TYPE', 'Section type must be fields, attachments or related.')); return }
      if (section.columns !== undefined && ![1, 2, 3].includes(section.columns)) errors.push(diagnostic(`${sectionPath}.columns`, 'LAYOUT_INVALID_COLUMNS', 'Section columns must be 1, 2 or 3.'))
      for (const fieldKey of section.fields ?? []) {
        if (!fields.has(fieldKey)) errors.push(diagnostic(`${sectionPath}.fields`, 'LAYOUT_FIELD_NOT_FOUND', `Layout field "${fieldKey}" does not exist.`))
        else if (placed.has(fieldKey)) errors.push(diagnostic(`${sectionPath}.fields`, 'LAYOUT_DUPLICATE_FIELD', `Field "${fieldKey}" is placed more than once.`))
        placed.add(fieldKey)
      }
      for (const [fieldKey, rule] of Object.entries(section.fieldRules ?? {})) {
        if (!(section.fields ?? []).includes(fieldKey)) errors.push(diagnostic(`${sectionPath}.fieldRules.${fieldKey}`, 'LAYOUT_RULE_FIELD_NOT_PLACED', `"${fieldKey}" has a rule but is not in this section.`))
        validateRule(rule, fields, `${sectionPath}.fieldRules.${fieldKey}`, errors, [fieldKey])
      }
    })
  })
  const unplaced = [...fields.keys()].filter((key) => !placed.has(key))
  if (unplaced.length) warnings.push(diagnostic(path, 'LAYOUT_UNPLACED_FIELDS', `Fields not placed in the layout go to "Otros datos": ${unplaced.join(', ')}.`, 'warning'))
}

export function validateEntityLayout(entity, basePath, errors, warnings, entities = []) {
  const layout = entity.layout
  if (layout === undefined || layout === null) return
  const path = `${basePath}.layout`
  if (typeof layout !== 'object' || Array.isArray(layout)) { errors.push(diagnostic(path, 'LAYOUT_INVALID', 'Layout must be an object.')); return }
  const fields = new Map((entity.fields ?? []).map((field) => [field.key ?? field.name, field]))
  if (layout.mode !== undefined && !LAYOUT_MODES.has(layout.mode)) errors.push(diagnostic(`${path}.mode`, 'LAYOUT_INVALID_MODE', 'Layout mode must be auto, page or sheet.'))
  const context = { entityKey: entity.key ?? entity.name, entities }
  validateTree(layout.tabs, fields, `${path}.tabs`, errors, warnings, context)
  if (layout.detail?.tabs !== undefined) validateTree(layout.detail.tabs, fields, `${path}.detail.tabs`, errors, warnings, context)
  validateDetail(layout.detail, fields, `${path}.detail`, errors)
}

function validateDetail(detail, fields, path, errors) {
  if (detail === undefined || detail === null) return
  const hero = detail.hero
  if (hero) {
    if (!fields.has(hero.titleField)) errors.push(diagnostic(`${path}.hero.titleField`, 'LAYOUT_FIELD_NOT_FOUND', 'Hero titleField must be an entity field.'))
    for (const key of hero.subtitleFields ?? []) if (!fields.has(key)) errors.push(diagnostic(`${path}.hero.subtitleFields`, 'LAYOUT_FIELD_NOT_FOUND', `Hero subtitle field "${key}" does not exist.`))
    if (hero.statusField && fields.get(hero.statusField)?.type !== 'select') errors.push(diagnostic(`${path}.hero.statusField`, 'LAYOUT_HERO_STATUS_NOT_SELECT', 'Hero statusField must be a select field.'))
    if (hero.imageField && !isImageFileField(fields.get(hero.imageField))) errors.push(diagnostic(`${path}.hero.imageField`, 'LAYOUT_HERO_IMAGE_NOT_IMAGE', 'Hero imageField must be a file field with accept: image.'))
  }
  const kpis = detail.kpis ?? []
  if (!Array.isArray(kpis) || kpis.length > MAX_KPIS) errors.push(diagnostic(`${path}.kpis`, 'LAYOUT_TOO_MANY_KPIS', `At most ${MAX_KPIS} KPIs are allowed.`))
  else kpis.forEach((kpi, index) => {
    if (!KPI_TYPES.has(fields.get(kpi?.field)?.type)) errors.push(diagnostic(`${path}.kpis[${index}].field`, 'LAYOUT_KPI_INVALID_TYPE', 'KPI field must be number, decimal, date, datetime or select.'))
    checkLabel(kpi?.label, `${path}.kpis[${index}].label`, errors)
  })
}

// Returns the form (or detail) tree with every entity field placed: fields
// missing from it are appended to an "Otros datos" section in the last tab.
// The detail uses `layout.detail.tabs` when present, else the form tree.
export function resolveEntityLayout(entity, target = 'form') {
  if (!entity?.layout?.tabs?.length) return null
  const layout = structuredClone(entity.layout)
  if (target === 'detail' && layout.detail?.tabs?.length) layout.tabs = layout.detail.tabs
  const placed = new Set(layout.tabs.flatMap((tab) => tab.sections.flatMap((section) => section.fields ?? [])))
  const unplaced = (entity.fields ?? []).map((field) => field.key ?? field.name).filter((key) => !placed.has(key))
  if (unplaced.length) layout.tabs.at(-1).sections.push({ key: OTHER_SECTION_KEY, label: 'Otros datos', columns: 2, fields: unplaced })
  return layout
}

// Required fields that may be hidden in the form (by their own rule, their
// section's or their tab's), with every rule that must hold for them to show.
// These are required only while visible (enforced by generated routes).
export function conditionalRequiredFields(entity) {
  const layout = entity?.layout
  if (!layout?.tabs?.length) return []
  const required = new Map((entity.fields ?? []).filter((field) => field.required).map((field) => [field.key ?? field.name, field]))
  const result = []
  // A lone tab renders without a tab bar, so its rule is never applied.
  const tabRules = layout.tabs.length > 1
  for (const tab of layout.tabs) {
    for (const section of tab.sections ?? []) {
      for (const fieldKey of section.fields ?? []) {
        const field = required.get(fieldKey)
        if (!field) continue
        const rules = [tabRules ? tab.visibleWhen : null, section.visibleWhen, section.fieldRules?.[fieldKey]].filter(Boolean)
        if (rules.length) result.push({ field: fieldKey, label: field.label ?? fieldKey, rules })
      }
    }
  }
  return result
}
