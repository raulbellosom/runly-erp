export const INSPECTION_VERSION = 1
export const DEFAULT_INSPECTION_LIMITS = Object.freeze({
  zipBytes: 25 * 1024 * 1024, expandedBytes: 100 * 1024 * 1024,
  entries: 2000, entryBytes: 5 * 1024 * 1024, ratio: 100,
  ratioThreshold: 1024 * 1024, depth: 64, nodes: 100000, tokens: 100000,
})

export class InspectionError extends Error {
  constructor(code, path, message, details = {}) {
    super(message)
    this.diagnostic = { code, path, severity: 'error', message, details }
  }
}

export function fail(code, path, message, details) {
  throw new InspectionError(code, path, message, details)
}

// Caller limits may tighten budgets, never disable the shared hard ceilings.
export function inspectionLimits(input = {}) {
  const result = { ...DEFAULT_INSPECTION_LIMITS }
  for (const [key, value] of Object.entries(input)) {
    if (!(key in result) || !Number.isSafeInteger(value) || value < 1 || value > result[key]) {
      throw new TypeError(`Invalid inspection limit: ${key}`)
    }
    result[key] = value
  }
  return result
}
