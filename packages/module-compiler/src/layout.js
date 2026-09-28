// Entity layout contract (tabs -> sections -> fields, detail hero/KPIs, open
// mode) and file field options for Builder-made modules. See
// docs/superpowers/specs/2026-09-27-rme3-builder-layout-media-design.md.

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const UNSAFE_SOURCE_TEXT = /['\\\r\n]/
const LAYOUT_MODES = new Set(['auto', 'page', 'sheet'])
const FILE_ACCEPT = new Set(['image', 'document', 'any'])
const KPI_TYPES = new Set(['number', 'decimal', 'date', 'datetime', 'select'])
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

export function validateEntityLayout(entity, basePath, errors, warnings) {
  const layout = entity.layout
  if (layout === undefined || layout === null) return
  const path = `${basePath}.layout`
  if (typeof layout !== 'object' || Array.isArray(layout)) { errors.push(diagnostic(path, 'LAYOUT_INVALID', 'Layout must be an object.')); return }
  const fields = new Map((entity.fields ?? []).map((field) => [field.key ?? field.name, field]))
  if (layout.mode !== undefined && !LAYOUT_MODES.has(layout.mode)) errors.push(diagnostic(`${path}.mode`, 'LAYOUT_INVALID_MODE', 'Layout mode must be auto, page or sheet.'))
  const tabs = layout.tabs
  if (!Array.isArray(tabs) || tabs.length < 1 || tabs.length > MAX_TABS) {
    errors.push(diagnostic(`${path}.tabs`, 'LAYOUT_INVALID_TABS', `Layout requires between 1 and ${MAX_TABS} tabs.`))
    return
  }
  const placed = new Set()
  const keys = new Set()
  let attachments = 0
  tabs.forEach((tab, tabIndex) => {
    const tabPath = `${path}.tabs[${tabIndex}]`
    if (!IDENTIFIER.test(tab?.key ?? '') || keys.has(tab.key)) errors.push(diagnostic(`${tabPath}.key`, 'LAYOUT_INVALID_KEY', 'Tab key must be a unique snake_case identifier.'))
    keys.add(tab?.key)
    checkLabel(tab?.label, `${tabPath}.label`, errors)
    if (!Array.isArray(tab?.sections)) { errors.push(diagnostic(`${tabPath}.sections`, 'LAYOUT_INVALID_SECTIONS', 'Tab sections must be an array.')); return }
    tab.sections.forEach((section, sectionIndex) => {
      const sectionPath = `${tabPath}.sections[${sectionIndex}]`
      if (!IDENTIFIER.test(section?.key ?? '') || keys.has(section.key)) errors.push(diagnostic(`${sectionPath}.key`, 'LAYOUT_INVALID_KEY', 'Section key must be a unique snake_case identifier.'))
      keys.add(section?.key)
      checkLabel(section?.label, `${sectionPath}.label`, errors)
      const type = section?.type ?? 'fields'
      if (type === 'attachments') {
        attachments += 1
        if (attachments > 1) errors.push(diagnostic(sectionPath, 'LAYOUT_MULTIPLE_ATTACHMENTS', 'Only one attachments section is allowed per entity.'))
        if (section.placement !== undefined && !['embedded', 'aside'].includes(section.placement)) errors.push(diagnostic(`${sectionPath}.placement`, 'LAYOUT_INVALID_PLACEMENT', 'Placement must be embedded or aside.'))
        return
      }
      if (type !== 'fields') { errors.push(diagnostic(`${sectionPath}.type`, 'LAYOUT_INVALID_SECTION_TYPE', 'Section type must be fields or attachments.')); return }
      if (section.columns !== undefined && ![1, 2, 3].includes(section.columns)) errors.push(diagnostic(`${sectionPath}.columns`, 'LAYOUT_INVALID_COLUMNS', 'Section columns must be 1, 2 or 3.'))
      for (const fieldKey of section.fields ?? []) {
        if (!fields.has(fieldKey)) errors.push(diagnostic(`${sectionPath}.fields`, 'LAYOUT_FIELD_NOT_FOUND', `Layout field "${fieldKey}" does not exist.`))
        else if (placed.has(fieldKey)) errors.push(diagnostic(`${sectionPath}.fields`, 'LAYOUT_DUPLICATE_FIELD', `Field "${fieldKey}" is placed more than once.`))
        placed.add(fieldKey)
      }
    })
  })
  const unplaced = [...fields.keys()].filter((key) => !placed.has(key))
  if (unplaced.length) warnings.push(diagnostic(path, 'LAYOUT_UNPLACED_FIELDS', `Fields not placed in the layout go to "Otros datos": ${unplaced.join(', ')}.`, 'warning'))
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

// Returns the layout with every entity field placed: fields missing from the
// layout are appended to an "Otros datos" section in the last tab.
export function resolveEntityLayout(entity) {
  if (!entity?.layout?.tabs?.length) return null
  const layout = structuredClone(entity.layout)
  const placed = new Set(layout.tabs.flatMap((tab) => tab.sections.flatMap((section) => section.fields ?? [])))
  const unplaced = (entity.fields ?? []).map((field) => field.key ?? field.name).filter((key) => !placed.has(key))
  if (unplaced.length) layout.tabs.at(-1).sections.push({ key: OTHER_SECTION_KEY, label: 'Otros datos', columns: 2, fields: unplaced })
  return layout
}
