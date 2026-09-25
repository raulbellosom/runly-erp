// Generalized to apps/api/src/lib/ai-proof-token.js (docs/TRANSCRIPTION_SPEC.md
// §7.2) — this file is kept as a re-export so every existing runly.ledger
// import site (ai-import-service.js, ai-import-routes.js, their tests) keeps
// working unchanged. Never add ledger-specific logic here again; add it to
// ai-import-service.js instead.
export {
  AiProofTokenError as ImportTokenError,
  signAiProof as signImportProof,
  verifyAiProof as verifyImportProof,
} from '../../lib/ai-proof-token.js'
