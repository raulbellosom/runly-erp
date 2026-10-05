import { getModuleKeyAliases } from '@runly/core';
import { createComponentRegistry } from '@runly/preview-runtime/custom-bundles';

// The registry semantics live in @runly/preview-runtime so the ERP shell and
// isolated preview hosts share one implementation; the ERP supplies its
// official atlas.*/runly.* alias catalog.
export function createModuleComponentRegistry(options = {}) {
  return createComponentRegistry({ aliases: getModuleKeyAliases, ...options });
}
