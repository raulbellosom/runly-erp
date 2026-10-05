import { RME3_ENGINE_CONTRACT, SERVICE_KEYS, SERVICE_CONTRACTS, DOMAIN_EVENTS } from '@runly/module-engine/contracts'
import { EXTERNAL_RELATION_TARGETS } from './external-relations.js'
import runtimeCatalog from './runtime-catalog.json' with { type: 'json' }

export const COMPILER_CONTRACT_VERSION = 1
export const COMPILER_VERSION = '0.1.0'
export const CAPABILITIES_VERSION = 1
export const RUNTIME_CONTRACT_VERSION = 1
export const RUNTIME_ID = 'rme3-erp-0.1.0-contract1'

export const COMPILER_CONTRACT = Object.freeze({
  schemaVersion: COMPILER_CONTRACT_VERSION, compilerVersion: COMPILER_VERSION,
  definitionSchemaVersions: Object.freeze([1]),
  compileEntry: '@runly/module-compiler/compile', archiveEntry: '@runly/module-compiler/archive',
  hashFormat: 'sha256-length-prefixed-utf8-files-v1', zipFormat: 'rme3-zip-v1',
  unsupportedDefinitionKeys: Object.freeze(['consumes', 'events']),
})

// ERP inventory and bounded preview availability; no backend execution in Hub.
export const RUNTIME_CONTRACT = Object.freeze({
  schemaVersion: RUNTIME_CONTRACT_VERSION, runtimeId: RUNTIME_ID,
  previewAvailable: true, previewScope: 'trusted-declarative-fixtures', previewContractVersion: 2, backendExecutionInHub: false,
  packageVersions: Object.freeze({ engine: '0.1.0', compiler: '0.1.0', ui: '0.1.0', sdk: '0.1.0', validators: '0.1.0' }),
  libraries: Object.freeze(runtimeCatalog.libraries.map((library) => Object.freeze({ ...library }))),
  sharedExternals: Object.freeze([
    'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime',
    '@tanstack/react-query', 'zustand', '@runly/ui', '@runly/sdk', '@runly/validators',
    '@atlas/ui', '@atlas/sdk', '@atlas/validators', 'react-router-dom', 'sonner',
    'lucide-react', 'recharts', 'qrcode', '@zxing/browser',
  ]),
  themeExport: '@runly/ui/theme.css',
  publicComponents: Object.freeze(['runly.public:RecordPage']),
  aliases: Object.freeze({ '@atlas/ui': '@runly/ui', '@atlas/sdk': '@runly/sdk', '@atlas/validators': '@runly/validators' }),
})

export const RME3_CAPABILITIES = Object.freeze({
  schemaVersion: CAPABILITIES_VERSION,
  engine: RME3_ENGINE_CONTRACT, compiler: COMPILER_CONTRACT, runtime: RUNTIME_CONTRACT,
  services: SERVICE_KEYS, serviceContracts: SERVICE_CONTRACTS, events: Object.freeze(Object.keys(DOMAIN_EVENTS)),
  connectionTargets: Object.freeze(Object.keys(EXTERNAL_RELATION_TARGETS)),
  inspection: Object.freeze({ executesUserCode: false, evidence: 'static', declarationFormat: 'rme3-js-literals-v1' }),
})
