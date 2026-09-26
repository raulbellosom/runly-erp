# Unified AI Provider Router (Groq + local Ollama)

Date: 2026-09-26
Status: Draft
Author: Claude Code (agent)
Spec file: docs/superpowers/specs/2026-09-26-unified-ai-provider-router-design.md
Plan file: docs/superpowers/plans/2026-09-26-unified-ai-provider-router.md (created after spec approval)

---

## 1. Feature title

Unified AI Provider Router — a shared client + deterministic router that lets Runly alternate between local Ollama models (qwen3:4b / qwen3:8b) and Groq, and removes the duplicated Groq-calling code currently copy-pasted across services.

## 2. Status

Draft

## 3. Context

Another Runly instance being set up can run local models via Ollama (qwen3:4b and qwen3:8b) alongside Groq. Today every AI-backed feature (MirAI, the PFM assistant sidebar, module help, receipt OCR, inventory photo intake, meeting-transcript analysis, the ledger AI statement import) talks to Groq directly and independently. There is no shared client and no concept of "provider" — each service hardcodes `https://api.groq.com` and reads `env.GROQ_API_KEY` itself. Before local models can be added as a second provider, this duplication has to be resolved, otherwise "add Ollama" would mean copy-pasting a second client six more times.

## 4. Problem

1. Six independent services (`mirai-service.js`, `help-assistant-service.js`, `pfm/assistant-service.js`, `vision-service.js`, `call-transcript-analysis-service.js`, `ledger/ai-import-extraction.js`) each reimplement the same Groq HTTP call: reading `GROQ_API_KEY`/`GROQ_BASE_URL`, building the same `https://api.groq.com` fallback, handling `reasoning_format: "hidden"` for reasoning models, and their own retry logic. This is the redundancy the user flagged as "no me agrada" — six copies of the same base URL / API key plumbing.
2. There is no way to point any of these services at a different provider (a local Ollama server) without duplicating that plumbing a second time, once per service, per provider.
3. There is no mechanism to pick a cheaper/faster local model for simple tasks (turn classification, help Q&A) and reserve a bigger local model or Groq for heavier reasoning tasks — every task uses one fixed model.

## 5. Goals

1. A single shared HTTP client (`ai-client.js`) replaces the six duplicated Groq-calling code paths, with one place that builds `baseUrl`/`apiKey`/headers per provider.
2. A deterministic router (`ai-router.js`) decides, per declared task, whether to call local Ollama (qwen3:4b for light tasks, qwen3:8b for heavy tasks) or Groq, based on fixed rules — no LLM is used to make the routing decision.
3. Tasks that require vision (receipt OCR, inventory photo intake, scanned bank-statement pages) always route to Groq, since qwen3:4b/8b have no vision capability.
4. If Ollama is enabled but unreachable or fails, the router automatically falls back to Groq for that request and temporarily stops trying local calls (circuit breaker), instead of adding latency to every request while local is down.
5. All 6 services above (plus the 2 services that already compose them — `inventory-assistant-service.js` via MirAI's tool loop, `inventory-intake-service.js` via `vision-service.js`) are migrated to call the router instead of `fetch` directly.
6. Existing instances that only use Groq see zero behavior change: local routing is opt-in via `AI_LOCAL_ENABLED` (default `false`), and every existing model-override env var (`CHAT_MIRAI_MODEL`, `PFM_ASSISTANT_MODEL`, etc.) keeps working exactly as it does today.

### Task profile table (`ai-task-profiles.js`)

Fixed at implementation time — not configurable at runtime (see Non-goal 1):

| Task key | Source service | weight | localCapable | Existing Groq model override (unchanged) |
|---|---|---|---|---|
| `mirai_classify` | `mirai-service.js` (turn classifier) | light | yes | `CHAT_MIRAI_ROUTER_MODEL` |
| `mirai_chat` | `mirai-service.js` (chat/mention/panel loop; also used by `inventory-assistant-service.js` via `answerWithTools`) | heavy | yes | `CHAT_MIRAI_MODEL` |
| `mirai_web` | `mirai-service.js` (Tavily/compound live-search turn) | heavy | no (see Non-goal 3) | `CHAT_MIRAI_WEB_MODEL` |
| `help_assistant` | `help-assistant-service.js` | light | yes | `HELP_ASSISTANT_MODEL` |
| `pfm_assistant` | `pfm/assistant-service.js` | heavy | yes | `PFM_ASSISTANT_MODEL` |
| `pfm_vision` | `vision-service.js` (OCR + describeImage; also used by `inventory-intake-service.js`, `pfm/receipts-service.js`, and the ledger import's scanned-page path) | n/a | no (vision) | `PFM_VISION_MODEL` |
| `transcript_analysis` | `call-transcript-analysis-service.js` | heavy | yes | `CHAT_TRANSCRIPT_ANALYSIS_MODEL` |
| `ledger_import_text` | `ledger/ai-import-extraction.js` (text pages only) | heavy | yes | `LEDGER_IMPORT_MODEL` / `LEDGER_IMPORT_BASE_URL` |

`weight: light` → `OLLAMA_MODEL_LIGHT` (qwen3:4b) when routed locally. `weight: heavy` → `OLLAMA_MODEL_HEAVY` (qwen3:8b) when routed locally. `localCapable: no` always resolves to Groq regardless of `AI_LOCAL_ENABLED`.

## 6. Non-goals

1. Building a configurable/DB-editable rules engine for routing (approach C, rejected during brainstorming) — routing rules are fixed in code for this version.
2. Adding vision support to local models. Vision-dependent tasks stay on Groq in this version.
3. Making the Tavily-backed "live web" answer-phrasing step local-capable (deferred — see Future enhancements). The whole `mirai_web` task stays on Groq in this version to avoid branching the compound-model vs. Tavily-result-phrasing paths.
4. Any UI, navigation, or user-facing screen. This is a backend/infrastructure change only; no screen shows "which model answered."
5. Installer auto-detection of a running Ollama server (e.g., pinging `localhost:11434` during setup). The installer only writes the env vars; the app decides availability at request time.
6. Changing any existing Groq model default. Defaults stay exactly as they are today (`DEFAULT_MIRAI_MODEL`, `DEFAULT_ASSISTANT_MODEL`, etc.) when local routing is off or a task isn't local-capable.

## 7. User stories

- As the operator of a self-hosted Runly instance with a GPU box running Ollama, I want MirAI's turn classification and simple Q&A (module help) to run on a local qwen3:4b so those calls are free and don't leave the network, while heavier reasoning (chat replies, PFM analysis, transcript analysis) can use qwen3:8b or fall back to Groq automatically if the local server is unavailable.
- As a developer maintaining Runly, I want one place that knows how to call an LLM provider, so adding or debugging a provider doesn't mean touching six files.
- As the operator of an instance without Ollama, I want the exact same behavior as today (Groq only) with no configuration required, so this change is safe to deploy everywhere.

## 8. UX requirements

N/A — no UI surface. No user-visible label changes. (If a future enhancement surfaces "answered by: local/cloud" in the MirAI panel, that would be a separate spec.)

## 9. Routes/screens

N/A — no new frontend routes or screens. No existing route's contract changes.

## 10. Data model

N/A — no new or modified Prisma/RME3 entities. This feature is a service-layer refactor plus new environment configuration; it introduces no persisted rows. (The existing `inventory.ai.query` audit metadata already stores which `model` answered a request — see Section 22 — and gains a `provider` field as a non-breaking addition.)

### New models

N/A

### Modified models

N/A

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

N/A — no new or modified HTTP endpoints. All 6 migrated services keep their existing routes, request/response shapes, and permission guards unchanged; only their internal implementation (how they call an LLM) changes.

## 13. SDK contract

N/A — this is server-internal (`apps/api/src/services/ai/*`). Nothing is exposed through `@runly/sdk`.

## 14. Validator contract

N/A — no new Zod schemas. No request/response shape changes for any existing endpoint.

## 15. Module manifest impact

N/A — not an RME3 module. This lives under `apps/api/src/services/ai/`, alongside the other shared services (`vision-service.js`, `groq-model-helpers.js`), not under `modules/custom/`.

## 16. Navigation impact

N/A

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — no new permission keys. Every migrated endpoint keeps whatever `requirePermission` guard it already has; the router runs after permission checks, inside the same service functions.

## 19. Multi-company behavior

N/A change. Every one of the 6 services already builds its `messages`/context from company-scoped data before calling the LLM (unchanged). The router only decides which provider/model receives that already-scoped payload; it has no knowledge of `companyId` and enforces no scoping itself — scoping remains the calling service's responsibility, exactly as today.

## 20. Files/storage impact

N/A — no Supabase Storage interaction. Image bytes for vision tasks already flow from the calling service (e.g., `vision-image.js`) straight into the client's request body, as they do today.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

No new `AuditLog` action keys. One existing metadata shape gains a field:

| Action key | Trigger | Payload change |
|---|---|---|
| `inventory.ai.query` (existing) | inventory assistant tool loop | `metadata.provider` added alongside the existing `metadata.model` |

No other migrated service currently writes to `AuditLog` for its AI calls, and this feature does not add new audit logging beyond the one-field addition above.

## 23. Edge cases

1. `AI_LOCAL_ENABLED=true` but `OLLAMA_BASE_URL` unset — router uses the documented default (`http://localhost:11434`); if that's also unreachable, behaves like case 2.
2. Ollama configured but the local server is down/unreachable at request time — router catches the transport error, retries once against Groq with that task's Groq model, and opens the circuit breaker so subsequent requests within the cooldown window skip straight to Groq.
3. A task marked `localCapable: false` (vision, `mirai_web`) — router always resolves to Groq, regardless of `AI_LOCAL_ENABLED`.
4. An explicit per-task model override env var is set (e.g., `PFM_ASSISTANT_MODEL`) — router honors it and routes to Groq with that model, exactly like today; local routing never overrides an explicit operator choice.
5. `AI_LOCAL_ENABLED=true` and `GROQ_API_KEY` is absent — local-capable tasks still work (routed to Ollama); vision and other `localCapable: false` tasks report "not configured," same as today when `GROQ_API_KEY` is missing.
6. Ollama responds but with malformed/non-JSON content for a task that requires `jsonMode` (e.g., `ledger_import_text`) — treated as a failed local attempt: falls back to Groq for that request (does not surface a parse error to the end user).
7. Circuit breaker cooldown expires — the very next request is allowed to try Ollama again (single probe), so recovery is automatic without a restart.
8. `inventory-assistant-service.js` and `inventory-intake-service.js` don't need their own task-profile changes: they inherit whatever `mirai_chat` / `pfm_vision` resolve to, since they call into `mirai-service.js` / `vision-service.js` internals rather than calling Groq themselves.

## 24. Risks

1. Risk: Existing unit tests for the 6 services mock `fetchImpl` and assert on raw Groq request/response shapes; migrating to the router changes the call shape these tests exercise. Mitigation: update each service's existing tests to inject `fetchImpl` at the router/client boundary (same DI pattern already used, no new test infrastructure), keep the assertions on outcome (final `content`, error codes) rather than growing coverage.
2. Risk: qwen3:4b/8b may not honor `jsonMode`/tool-calling as reliably as Groq's models, causing extraction tasks (`ledger_import_text`) to silently return worse data instead of erroring loudly. Mitigation: treat invalid/unparsable local JSON output as a failure that triggers the Groq fallback (edge case 6), never as a "successful" degraded answer.
3. Risk: the circuit breaker could mask a persistently broken local server, silently sending 100% of traffic to Groq (defeating the purpose) without any operator-visible signal. Mitigation: log a single warning line when the circuit opens and when it closes again (`console.error`/`console.warn`, matching the existing logging style in `mirai-service.js`); no new alerting/dashboard is in scope.
4. Risk: cold-start latency the first time a local model is invoked (Ollama loading qwen3:8b from disk into memory) could make the first heavy-task request in a while noticeably slow. Mitigation: accepted as documented behavior for v1 (no pre-warming); noted in Future enhancements.

## 25. Acceptance criteria

1. Given `AI_LOCAL_ENABLED` unset (or `false`) on an instance, when any of the 6 migrated services handles a request, then the outgoing HTTP call target, model, and behavior are identical to today's Groq-only behavior (verified via existing test suites passing unchanged in assertions).
2. Given `AI_LOCAL_ENABLED=true` and a reachable Ollama server, when `mirai_classify` (a light, local-capable task) runs, then the router calls Ollama with `OLLAMA_MODEL_LIGHT`.
3. Given `AI_LOCAL_ENABLED=true`, when a vision task (`pfm_vision`, or the ledger import's scanned-page path) runs, then the router always resolves to Groq, never Ollama.
4. Given `AI_LOCAL_ENABLED=true` and Ollama returning a transport error (connection refused), when a local-capable task runs, then the router falls back to Groq for that same request and the caller receives a normal successful response (not an error), assuming Groq is configured.
5. Given the circuit breaker is open after repeated Ollama failures, when a new local-capable request arrives within the cooldown window, then the router calls Groq directly without attempting Ollama first.
6. Given an operator has set an existing model-override env var (e.g., `CHAT_MIRAI_MODEL`), when that task runs with `AI_LOCAL_ENABLED=true`, then the router still routes to Groq with the overridden model (explicit override wins over automatic local routing).
7. Given no `GROQ_API_KEY` and `AI_LOCAL_ENABLED=true`, when a local-capable task (e.g., `help_assistant`) runs, then it succeeds via Ollama; when a vision task runs, then it reports "not configured" exactly as it does today without `GROQ_API_KEY`.

## 26. Verification plan

- `node --test apps/api/src/services/ai/__tests__/` — new `ai-client.test.js` and `ai-router.test.js` (routing rules, vision-forces-Groq, fallback on transport error, circuit breaker open/close).
- `node --test apps/api/src/routes/chat/__tests__/` — existing MirAI suites updated for the router call shape, still passing.
- `node --test apps/api/src/routes/help/__tests__/`, `apps/api/src/routes/pfm/__tests__/`, `apps/api/src/services/__tests__/` (vision, inventory), `apps/api/src/routes/calls/__tests__/`, `apps/api/src/routes/ledger/__tests__/` — all existing suites for the 6 migrated services, updated and passing.
- Full suite: `node --test` across `apps/api/src` — confirm no regression in unrelated tests (matching the precedent set by the `index.js` decomposition noted in `CLAUDE.md`).
- `pnpm lint` — no new lint violations.
- Manual/local: boot the API (`pnpm dev:api`) with `AI_LOCAL_ENABLED` unset and confirm MirAI/help/PFM assistant behave as before (Groq only) via a couple of smoke requests.
- Real end-to-end validation against an actual Ollama server happens on the target instance (outside this repo's test environment, per the earlier discussion) — not part of this repo's automated verification.

## 27. Rollback plan

No database migration is involved, so rollback is a plain code revert. Because `AI_LOCAL_ENABLED` defaults to `false` and every existing env var keeps its current meaning, an instance can also "roll back" behavior instantly by unsetting `AI_LOCAL_ENABLED` (or leaving it unset) without reverting any code — local routing simply stops being used and every task falls back to the existing Groq-only path.

## 28. Future enhancements

1. Make the Tavily-result-phrasing half of `mirai_web` local-capable (only the Groq "compound" browsing fallback path would remain Groq-only).
2. Surface which provider/model answered in the MirAI panel or admin diagnostics (currently only written to `inventory.ai.query` audit metadata).
3. Pre-warm/keep-alive the local "heavy" model to avoid first-request cold-start latency.
4. Health-check endpoint (`GET /internal/ai/status` or similar) reporting circuit-breaker state and configured providers, for ops visibility.
5. Support additional local providers/models beyond qwen3:4b/8b if the target instance's hardware changes.
