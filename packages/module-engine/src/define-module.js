import { MODULE_KINDS } from './constants.js'
import { ModuleEngineError } from './errors.js'
import { isModuleIconName } from './module-icons.js'
import { validateAiManifest } from './ai-manifest.js'
import { validatePublicResources } from './public-resources-manifest.js'
import { validateConnections } from './manifest-connections.js'

const VALID_KINDS = new Set(Object.values(MODULE_KINDS))
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const SAFE_START_PATH_RE = /^\/(?:[a-zA-Z0-9._~-]+\/?)*$/

const MANIFEST_DEFAULTS = {
  kind:        'FEATURE',
  description: '',
  icon:        'Box',
  color:       null,
  pwa:         null,
  category:    'general',
  dependencies: [],
  migrations:   [],
  permissions:  [],
  navigation:   [],
  acl: {
    module:  null,
    actions: {},
    models:  {},
  },
  lifecycle: {
    installable:            true,
    uninstallable:          true,
    resettable:             false,
    supportsDataPurge:      false,
    defaultUninstallPolicy: 'preserve-data',
    ownedEntities:          [],
    sharedEntities:         [],
  },
}

function validateMigrations(migrations, errors) {
  if (migrations === undefined) return
  if (!Array.isArray(migrations)) {
    errors.push('migrations must be an array')
    return
  }

  for (let i = 0; i < migrations.length; i += 1) {
    const entry = migrations[i]
    const label = `migrations[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`)
      continue
    }

    if (!entry.path || typeof entry.path !== 'string' || !entry.path.trim()) {
      errors.push(`${label}.path is required`)
    }

    if (!entry.checksum || typeof entry.checksum !== 'string' || !entry.checksum.trim()) {
      errors.push(`${label}.checksum is required`)
    } else if (!/^[a-fA-F0-9]{64}$/.test(entry.checksum.trim())) {
      errors.push(`${label}.checksum must be a SHA-256 hex string`)
    }
  }
}

// Returns { valid: boolean, errors: string[] }. Never throws.
function validatePwaIdentity(manifest, errors, { allowLegacyPwa = false } = {}) {
  const hasExplicitIcon = typeof manifest.icon === 'string' && manifest.icon.trim()
  const hasExplicitColor = typeof manifest.color === 'string' && manifest.color.trim()
  const pwa = manifest.pwa
  const hasCompleteIdentity = Boolean(
    hasExplicitIcon &&
    hasExplicitColor &&
    pwa &&
    typeof pwa === 'object' &&
    !Array.isArray(pwa) &&
    pwa.shortName &&
    pwa.startPath,
  )

  if (allowLegacyPwa && !hasCompleteIdentity) return

  if (!hasExplicitIcon) {
    if (!allowLegacyPwa) errors.push('icon is required for module PWA identity')
  } else if (!isModuleIconName(manifest.icon.trim())) {
    errors.push(`icon must be a supported module icon: ${manifest.icon}`)
  }

  if (!hasExplicitColor) {
    if (!allowLegacyPwa) errors.push('color is required for module PWA identity')
  } else if (!HEX_COLOR_RE.test(manifest.color.trim())) {
    errors.push('color must be a 6-digit hexadecimal value (e.g. #6366f1)')
  }

  if (!pwa || typeof pwa !== 'object' || Array.isArray(pwa)) {
    if (!allowLegacyPwa) {
      errors.push('pwa.shortName is required')
      errors.push('pwa.startPath is required')
    }
    return
  }

  if (!pwa.shortName || typeof pwa.shortName !== 'string' || !pwa.shortName.trim()) {
    errors.push('pwa.shortName is required')
  } else if (pwa.shortName.trim().length > 14) {
    errors.push('pwa.shortName must be 14 characters or fewer')
  }

  if (!pwa.startPath || typeof pwa.startPath !== 'string') {
    errors.push('pwa.startPath is required')
  } else {
    const startPath = pwa.startPath.trim()
    if (
      !SAFE_START_PATH_RE.test(startPath) ||
      startPath.includes('..') ||
      startPath.includes('?') ||
      startPath.includes('#') ||
      startPath === '/app' ||
      startPath.startsWith('/app/')
    ) {
      errors.push('pwa.startPath must be a safe internal path starting with /')
    }
  }
}

export function validateModulePwaIdentity(manifest, options = {}) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['manifest must be a plain object'] }
  }
  validatePwaIdentity(manifest, errors, options)
  return { valid: errors.length === 0, errors }
}

function deriveLegacyPwa(manifest) {
  const firstNavigationPath = Array.isArray(manifest.navigation)
    ? manifest.navigation.find((item) => typeof item?.path === 'string')?.path
    : null
  const modulePrefix = `/app/m/${manifest.key}`
  const startPath = firstNavigationPath === modulePrefix
    ? '/'
    : firstNavigationPath?.startsWith(`${modulePrefix}/`)
      ? firstNavigationPath.slice(modulePrefix.length)
      : firstNavigationPath?.startsWith('/')
        ? firstNavigationPath
        : '/'
  const name = typeof manifest.name === 'string' && manifest.name.trim()
    ? manifest.name.trim()
    : 'Runly'

  return {
    icon: isModuleIconName(manifest.icon?.trim())
      ? manifest.icon.trim()
      : MANIFEST_DEFAULTS.icon,
    color: HEX_COLOR_RE.test(manifest.color ?? '')
      ? manifest.color
      : '#6366f1',
    pwa: {
      shortName: name.slice(0, 14),
      startPath,
      legacyDerived: true,
    },
  }
}

export function validateManifest(manifest, options = {}) {
  const errors = []

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['manifest must be a plain object'] }
  }

  if (!manifest.key || typeof manifest.key !== 'string' || !manifest.key.trim()) {
    errors.push('key is required and must be a non-empty string')
  } else {
    const key = manifest.key.trim()
    if (key.includes('/') || key.includes('\\') || key.includes('..')) {
      errors.push('key must not contain path traversal characters (/, \\, ..)')
    }
    if (!key.includes('.')) {
      errors.push('key must contain at least one dot separator (e.g. custom.fleet)')
    }
    if (key.split('.').some((s) => s === '')) {
      errors.push('key must not have empty dot-separated segments (no leading/trailing dots)')
    }
  }

  if (!manifest.name || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    errors.push('name is required and must be a non-empty string')
  }

  if (!manifest.version || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    errors.push('version is required and must be a non-empty string')
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version.trim())) {
    errors.push('version must follow semver format (e.g. 0.1.0)')
  }

  if (manifest.kind !== undefined && !VALID_KINDS.has(manifest.kind)) {
    errors.push(`kind must be one of: ${[...VALID_KINDS].join(', ')}`)
  }

  validatePwaIdentity(manifest, errors, options)

  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      errors.push('permissions must be an array')
    } else {
      manifest.permissions.forEach((p, i) => {
        if (!p.key || typeof p.key !== 'string') {
          errors.push(`permissions[${i}].key is required`)
        }
        if (!p.name || typeof p.name !== 'string') {
          errors.push(`permissions[${i}].name is required`)
        }
      })
    }
  }

  validateMigrations(manifest.migrations, errors)
  validateAiManifest(manifest.ai, errors)
  validatePublicResources(manifest, errors)
  validateConnections(manifest, errors)

  if (manifest.navigation !== undefined) {
    if (!Array.isArray(manifest.navigation)) {
      errors.push('navigation must be an array')
    } else {
      manifest.navigation.forEach((n, i) => {
        if (!n.label || typeof n.label !== 'string') {
          errors.push(`navigation[${i}].label is required`)
        }
        if (!n.path || typeof n.path !== 'string' || !n.path.startsWith('/')) {
          errors.push(`navigation[${i}].path must be a string starting with /`)
        }
        if (!n.permissionKey || typeof n.permissionKey !== 'string') {
          errors.push(`navigation[${i}].permissionKey is required`)
        }
      })
    }
  }

  return { valid: errors.length === 0, errors }
}

// Validates and returns the manifest with defaults applied. Throws ModuleEngineError on invalid input.
export function defineRunlyModule(manifest) {
  const { valid, errors } = validateManifest(manifest, { allowLegacyPwa: true })
  if (!valid) {
    throw new ModuleEngineError(`Invalid module manifest: ${errors.join('; ')}`, 'AME_INVALID_MANIFEST')
  }
  const legacyPwa = deriveLegacyPwa(manifest)
  const hasExplicitPwa = Boolean(
    manifest.icon &&
    manifest.color &&
    manifest.pwa?.shortName &&
    manifest.pwa?.startPath,
  )

  return {
    ...MANIFEST_DEFAULTS,
    ...manifest,
    icon: hasExplicitPwa ? manifest.icon : legacyPwa.icon,
    color: hasExplicitPwa ? manifest.color : legacyPwa.color,
    pwa: hasExplicitPwa ? { ...manifest.pwa } : legacyPwa.pwa,
    acl: { ...MANIFEST_DEFAULTS.acl, ...(manifest.acl ?? {}) },
    lifecycle: { ...MANIFEST_DEFAULTS.lifecycle, ...(manifest.lifecycle ?? {}) },
  }
}
