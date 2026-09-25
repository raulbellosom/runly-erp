# MirAI Transcript Analysis (Etapa 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user with the right permission ask MirAI to analyze a `READY` call transcript, get back a persisted draft (summary, decisions, proposed action items, proposed calendar events), review/edit it in the UI, and selectively commit accepted items into real `Task`/`CalendarEvent` rows — mirroring the `recognize`/`commit` pattern `runly.ledger` already uses for AI statement import.

**Architecture:** New Prisma model `CallTranscriptAnalysis` (one row per transcript, replaced on re-analyze). New `call-transcript-analysis-service.js` calls Groq (same HTTP/retry/JSON-mode pattern as `ai-import-extraction.js`) to produce the draft, signs a proof token over it (generalized from `runly.ledger`'s `ai-import-token.js` into a shared `apps/api/src/lib/ai-proof-token.js`), and on commit verifies that token before writing `Task`/`CalendarEvent` rows via the existing `tasks-service.js`/`calendar-event-service.js`. Two new routes in `apps/api/src/routes/calls/index.js`, two new SDK methods, and a new review dialog in `runly.chat`'s desktop UI.

**Tech Stack:** Node.js (Hono API), Prisma, Groq (OpenAI-compatible `/openai/v1/chat/completions`, JSON mode), React + `@runly/ui` + TanStack Query.

**Spec:** `docs/TRANSCRIPTION_SPEC.md` §7 (revision 4). Two deliberate elaborations of that spec, called out because the spec left them unspecified rather than resolving them:
1. `acceptedEvents` items carry a `calendarId` (not just `index`) — `CalendarEvent.calendarId` is a required, non-null column (`calendar-event-service.js:221`), so committing an event needs a target calendar the same way committing a task needs a `projectId`.
2. The exact Groq system prompt in Task 5 is an explicit **first draft**, clearly labeled as such in the code comment — the spec (§7.4) is explicit that the real prompt needs iteration against real transcripts, which this plan cannot do from a sandbox with no real meeting transcripts. Ship it working end-to-end; tune the wording later against real usage.

---

### Task 1: `CallTranscriptAnalysis` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260924010000_call_transcript_analysis/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Find the existing `model CallTranscript` block and add this new model directly after it (and after `CallTranscriptSegment` if that's how the file orders them — match whatever order the two existing models are already in):

```prisma
// MirAI Etapa 5 (docs/TRANSCRIPTION_SPEC.md §7.1) — persisted analysis draft.
// One row per transcript (unique on transcriptId), not a version history:
// re-analyzing REPLACES the draft (same "reuse the row" principle as
// CallTranscript.regenerateTranscript). committedTaskIds/committedEventIds
// survive a re-analyze even though committedAt is reset to null, so the
// history of what was already created is never lost.
model CallTranscriptAnalysis {
  id                String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  transcriptId      String    @unique @db.Uuid @map("transcript_id")
  companyId         String    @db.Uuid @map("company_id")
  summary           String    @map("summary")
  decisions         Json      @map("decisions")        // string[]
  actionItems       Json      @map("action_items")      // [{ text: string }]
  proposedEvents    Json      @map("proposed_events")   // [{ title, startsAt, endsAt?, description? }]
  model             String    @map("model")
  generatedByUserId String    @db.Uuid @map("generated_by_user_id")
  generatedAt       DateTime  @default(now()) @map("generated_at")
  committedTaskIds  Json?     @map("committed_task_ids")  // uuid[]
  committedEventIds Json?     @map("committed_event_ids") // uuid[]
  committedAt       DateTime? @map("committed_at")

  transcript CallTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)

  @@index([companyId])
  @@map("call_transcript_analysis")
}
```

Also add the reverse relation field on `model CallTranscript` (find its `segments  CallTranscriptSegment[]` line and add directly after it):

```prisma
  analysis  CallTranscriptAnalysis?
```

- [ ] **Step 2: Validate the schema parses**

Run: `cd D:/RacoonDevs/runly && npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 3: Write the migration SQL by hand**

Same profile as the two existing `call_transcript*` migrations — purely additive, no changes to existing tables. Create `prisma/migrations/20260924010000_call_transcript_analysis/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "call_transcript_analysis" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transcript_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "decisions" JSONB NOT NULL,
    "action_items" JSONB NOT NULL,
    "proposed_events" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generated_by_user_id" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_task_ids" JSONB,
    "committed_event_ids" JSONB,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "call_transcript_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_transcript_analysis_transcript_id_key" ON "call_transcript_analysis"("transcript_id");

-- CreateIndex
CREATE INDEX "call_transcript_analysis_company_id_idx" ON "call_transcript_analysis"("company_id");

-- AddForeignKey
ALTER TABLE "call_transcript_analysis" ADD CONSTRAINT "call_transcript_analysis_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "call_transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply the migration against the real dev DB**

Run: `cd D:/RacoonDevs/runly && npx prisma migrate deploy`
Expected: `1 migration found... Applying migration \`20260924010000_call_transcript_analysis\`... All migrations have been successfully applied.`

Then regenerate the client: `pnpm db:generate`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260924010000_call_transcript_analysis
git commit -m "feat(chat): add CallTranscriptAnalysis model for MirAI transcript analysis"
```

---

### Task 2: Generalize the signed-proof-token mechanism out of `runly.ledger`

**Files:**
- Create: `apps/api/src/lib/ai-proof-token.js`
- Modify: `apps/api/src/routes/ledger/ai-import-token.js`
- Test: `apps/api/src/lib/__tests__/ai-proof-token.test.js` (new — copy of the existing ledger test, retargeted)

This is a pure move, per spec §7.2 — zero behavior change for `runly.ledger`.

- [ ] **Step 1: Create the generalized module**

Copy `apps/api/src/routes/ledger/ai-import-token.js` verbatim to `apps/api/src/lib/ai-proof-token.js`, renaming only the exported error class and functions to generic names, and generalizing the config env var names (kept backward compatible by checking both):

```js
import crypto from 'node:crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2h

export class AiProofTokenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AiProofTokenError'
    this.status = 403
  }
}

function getSecret(env) {
  // LEDGER_IMPORT_SIGNING_SECRET kept first for zero behavior change on
  // existing runly.ledger installs; AI_PROOF_SIGNING_SECRET is the new,
  // module-agnostic name for anything else that adopts this (this plan's
  // transcript analysis included).
  const secret = env.LEDGER_IMPORT_SIGNING_SECRET || env.AI_PROOF_SIGNING_SECRET || env.GROQ_API_KEY
  if (!secret) throw new AiProofTokenError('Prueba de IA no configurada.')
  return secret
}

// Signs an arbitrary payload object with HMAC + a short TTL. The payload is
// never a lock on content integrity by itself (see docs/TRANSCRIPTION_SPEC.md
// §7 for why rowsHash in the ledger's original use was never a real hash) —
// its real job is proving the caller recently paid the cost/latency of an AI
// call before being allowed to run the endpoint that writes real data.
export function signAiProof(payload, env = process.env, { nowMs = Date.now() } = {}) {
  const secret = getSecret(env)
  const body = { ...payload, iat: nowMs }
  const json = JSON.stringify(body)
  const b64 = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyAiProof(token, env = process.env) {
  const secret = getSecret(env)
  const [b64, sig] = String(token ?? '').split('.')
  if (!b64 || !sig) throw new AiProofTokenError('Token de prueba invalido.')
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new AiProofTokenError('Token de prueba invalido.')
  }
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  if (Date.now() - payload.iat > TOKEN_TTL_MS) throw new AiProofTokenError('El token de prueba expiro, vuelve a analizar primero.')
  return payload
}
```

- [ ] **Step 2: Turn `ai-import-token.js` into a re-export, zero behavior change**

Replace the entire contents of `apps/api/src/routes/ledger/ai-import-token.js` with:

```js
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
```

- [ ] **Step 3: Run the existing ledger token test to confirm zero regression**

Run: `cd D:/RacoonDevs/runly && node --test apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`
Expected: all existing tests still pass unchanged (they import `signImportProof`/`verifyImportProof`/`ImportTokenError` from the old path, which now resolve through the re-export).

- [ ] **Step 4: Write a focused test for the new generalized module**

Create `apps/api/src/lib/__tests__/ai-proof-token.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signAiProof, verifyAiProof, AiProofTokenError } from "../ai-proof-token.js";

const env = { AI_PROOF_SIGNING_SECRET: "test-secret" };

describe("ai-proof-token", () => {
  it("round-trips a signed payload", () => {
    const token = signAiProof({ companyId: "c1", actorId: "u1" }, env);
    const payload = verifyAiProof(token, env);
    assert.equal(payload.companyId, "c1");
    assert.equal(payload.actorId, "u1");
  });

  it("rejects a tampered token", () => {
    const token = signAiProof({ companyId: "c1" }, env);
    const tampered = token.slice(0, -2) + "xx";
    assert.throws(() => verifyAiProof(tampered, env), AiProofTokenError);
  });

  it("rejects an expired token", () => {
    const token = signAiProof({ companyId: "c1" }, env, { nowMs: Date.now() - (3 * 60 * 60 * 1000) });
    assert.throws(() => verifyAiProof(token, env), /expiro/);
  });

  it("throws when no secret is configured", () => {
    assert.throws(() => signAiProof({ companyId: "c1" }, {}), AiProofTokenError);
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd D:/RacoonDevs/runly && node --test apps/api/src/lib/__tests__/ai-proof-token.test.js apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`
Expected: all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/ai-proof-token.js apps/api/src/lib/__tests__/ai-proof-token.test.js apps/api/src/routes/ledger/ai-import-token.js
git commit -m "refactor(api): generalize ledger's signed proof-token into a shared ai-proof-token lib"
```

---

### Task 3: Permission `chat.calls.transcript.analyze`

**Files:**
- Modify: `apps/api/src/permission-catalog.js`
- Modify: `apps/api/src/manifests/official/feature-modules.js`

- [ ] **Step 1: Add the permission to the catalog**

In `apps/api/src/permission-catalog.js`, find the `"chat.calls.transcript.manage"` entry (currently `order: 62`) and add directly after it:

```js
  "chat.calls.transcript.analyze": {
    displayNameEs: "Analizar transcripciones con MirAI",
    descriptionEs: "Permite pedirle a MirAI un resumen/minuta de una transcripción y confirmar tareas o eventos propuestos a partir de ella.",
    groupKey: "chat",
    order: 63,
  },
```

- [ ] **Step 2: Add it to the `runly.chat` manifest**

In `apps/api/src/manifests/official/feature-modules.js`, find the `permissions:` array entry for `chat.calls.transcript.manage` and add directly after it:

```js
    { key: 'chat.calls.transcript.analyze', name: 'Analizar transcripciones con MirAI' },
```

And in the `acl.actions` object, find `'chat.calls.transcript.manage':  'chat.calls.transcript.manage',` and add directly after it:

```js
      'chat.calls.transcript.analyze': 'chat.calls.transcript.analyze',
```

- [ ] **Step 3: Seed it into the real dev DB and verify**

Run: `cd D:/RacoonDevs/runly && pnpm db:seed`
Then verify with a read-only query (no secrets printed):

Run: `cd D:/RacoonDevs/runly && node -e "import('./apps/api/src/services/prisma.js').then(async ({default: prisma}) => { const p = await prisma.permission.findUnique({where:{key:'chat.calls.transcript.analyze'}}); console.log(p ? {key:p.key, active:p.active} : 'NOT FOUND'); process.exit(0); })"`

Expected: `{ key: 'chat.calls.transcript.analyze', active: true }`. (If the import path for the shared Prisma client differs from `apps/api/src/services/prisma.js`, check `apps/api/src/index.js` for how it imports `prisma` and adjust this one-off verification command accordingly — do not guess a wrong path silently.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/permission-catalog.js apps/api/src/manifests/official/feature-modules.js
git commit -m "feat(chat): add chat.calls.transcript.analyze permission"
```

---

### Task 4: Commit-proposals request schema

**Files:**
- Modify: `packages/validators/src/calls.js`

- [ ] **Step 1: Add the schema**

Append to `packages/validators/src/calls.js`:

```js
export const callTranscriptCommitProposalsSchema = z.object({
  proofToken: z.string().min(1),
  acceptedActionItems: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        projectId: z.string().uuid(),
        assigneeUserId: z.string().uuid().nullish(),
        dueDate: z.string().nullish(),
      }),
    )
    .default([]),
  // calendarId is a deliberate elaboration of TRANSCRIPTION_SPEC.md §7.3's
  // `{ index }`-only shape — CalendarEvent.calendarId is NOT NULL
  // (calendar-event-service.js createEvent), so an accepted event needs a
  // target calendar the same way an accepted task needs a projectId.
  acceptedEvents: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        calendarId: z.string().uuid(),
      }),
    )
    .default([]),
});
```

- [ ] **Step 2: Verify it loads**

Run: `cd D:/RacoonDevs/runly && node -e "import('@runly/validators').then(m => console.log(typeof m.callTranscriptCommitProposalsSchema))"`
Expected: `object` (a `ZodObject` instance — every schema export in this file is `typeof === "object"`, not `"function"`)

- [ ] **Step 3: Commit**

```bash
git add packages/validators/src/calls.js
git commit -m "feat(validators): add callTranscriptCommitProposalsSchema"
```

---

### Task 5: `call-transcript-analysis-service.js` — analyze + commit logic

**Files:**
- Create: `apps/api/src/routes/calls/call-transcript-analysis-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js`

This is a new file, not an addition to `call-transcript-service.js` — same single-responsibility split CLAUDE.md already asks for elsewhere in this codebase (e.g. `chat-message-send-service.js` next to `chat-service.js`).

- [ ] **Step 1: Write the failing tests first**

Create `apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js`:

```js
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createCallTranscriptAnalysisService, CallTranscriptAnalysisError } from "../call-transcript-analysis-service.js";
import { verifyAiProof } from "../../../lib/ai-proof-token.js";

const ENV = { GROQ_API_KEY: "test-key", AI_PROOF_SIGNING_SECRET: "test-secret" };

function fakeGroqResponse(obj) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ model: "openai/gpt-oss-120b", choices: [{ message: { content: JSON.stringify(obj) } }] }),
  };
}

function basePrisma({ transcript, segments, analysis = null }) {
  let savedAnalysis = analysis;
  return {
    callTranscript: {
      findUnique: async ({ where }) => (where.id === transcript.id ? { ...transcript, segments } : null),
    },
    callTranscriptAnalysis: {
      findUnique: async ({ where }) => (where.transcriptId === transcript.id ? savedAnalysis : null),
      upsert: async ({ create, update }) => {
        savedAnalysis = savedAnalysis ? { ...savedAnalysis, ...update } : { id: "an-1", ...create };
        return savedAnalysis;
      },
      update: async ({ data }) => {
        savedAnalysis = { ...savedAnalysis, ...data };
        return savedAnalysis;
      },
    },
  };
}

describe("call-transcript-analysis-service.analyzeTranscript", () => {
  it("requires the transcript to be READY", async () => {
    const prisma = basePrisma({ transcript: { id: "t1", status: "PENDING", companyId: "c1" }, segments: [] });
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService: {}, calendarService: {} });
    await assert.rejects(
      () => service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" }),
      (err) => err instanceof CallTranscriptAnalysisError && err.status === 409,
    );
  });

  it("calls Groq with the joined segment text and persists the draft", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const segments = [
      { startMs: 0, text: "Hola equipo, empecemos." },
      { startMs: 5000, text: "Quedamos en enviar la propuesta el viernes." },
    ];
    const prisma = basePrisma({ transcript, segments });
    const draft = {
      summary: "Reunion de seguimiento.",
      decisions: ["Enviar la propuesta el viernes."],
      actionItems: [{ text: "Enviar la propuesta al cliente" }],
      proposedEvents: [],
    };
    const fetchImpl = mock.fn(async () => fakeGroqResponse(draft));
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, fetchImpl, tasksService: {}, calendarService: {} });

    const result = await service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" });

    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.equal(result.analysis.summary, draft.summary);
    assert.deepEqual(result.analysis.actionItems, draft.actionItems);
    const proof = verifyAiProof(result.proofToken, ENV);
    assert.equal(proof.transcriptId, "t1");
    assert.equal(proof.companyId, "c1");
  });

  it("wraps an unreadable Groq response", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const prisma = basePrisma({ transcript, segments: [{ startMs: 0, text: "hola" }] });
    const fetchImpl = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "no es json" } }] }) }));
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, fetchImpl, tasksService: {}, calendarService: {} });
    await assert.rejects(() => service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" }), CallTranscriptAnalysisError);
  });
});

describe("call-transcript-analysis-service.commitProposals", () => {
  it("rejects an invalid proof token", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = { id: "an-1", transcriptId: "t1", companyId: "c1", actionItems: [], proposedEvents: [], committedAt: null };
    const prisma = basePrisma({ transcript, segments: [], analysis });
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService: {}, calendarService: {} });
    await assert.rejects(
      () => service.commitProposals({ transcriptId: "t1", profileId: "u1", proofToken: "garbage", acceptedActionItems: [], acceptedEvents: [] }),
      (err) => err instanceof CallTranscriptAnalysisError && err.status === 409,
    );
  });

  it("creates a Task per accepted action item and a CalendarEvent per accepted event, then marks committed", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [{ text: "Enviar propuesta" }],
      proposedEvents: [{ title: "Seguimiento", startsAt: "2026-10-01T15:00:00.000Z" }],
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    const prisma = basePrisma({ transcript, segments: [], analysis });
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const createdTasks = [];
    const createdEvents = [];
    const tasksService = {
      createTask: async (projectId, createdBy, data) => {
        const task = { id: `task-${createdTasks.length}`, projectId, createdBy, ...data };
        createdTasks.push(task);
        return task;
      },
    };
    const calendarService = {
      createEvent: async (userId, data) => {
        const event = { id: `event-${createdEvents.length}`, userId, ...data };
        createdEvents.push(event);
        return event;
      },
    };
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService, calendarService });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [{ index: 0, projectId: "proj-1" }],
      acceptedEvents: [{ index: 0, calendarId: "cal-1" }],
    });

    assert.equal(createdTasks.length, 1);
    assert.equal(createdTasks[0].title, "Enviar propuesta");
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0].title, "Seguimiento");
    assert.equal(createdEvents[0].sourceModule, "runly.chat");
    assert.equal(createdEvents[0].sourceEntityId, "t1");
    assert.equal(result.createdTasks.length, 1);
    assert.equal(result.createdEvents.length, 1);
  });
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `cd D:/RacoonDevs/runly && node --test apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js`
Expected: FAIL — `Cannot find module '../call-transcript-analysis-service.js'`

- [ ] **Step 3: Implement `call-transcript-analysis-service.js`**

```js
// MirAI transcript analysis (Etapa 5, docs/TRANSCRIPTION_SPEC.md §7). Separate
// file from call-transcript-service.js on purpose — this is a distinct
// responsibility (calling Groq, signing/verifying a proof token, writing
// Task/CalendarEvent rows) with its own dependencies, same split principle
// CLAUDE.md already asks for elsewhere (e.g. chat-message-send-service.js
// next to chat-service.js).
import { signAiProof, verifyAiProof, AiProofTokenError } from "../../lib/ai-proof-token.js";
import { isReasoningModel } from "../../services/groq-model-helpers.js";

const LOG_PREFIX = "[runly.calls/transcript-analysis]";

export class CallTranscriptAnalysisError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallTranscriptAnalysisError";
    this.status = status;
  }
}

function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

// FIRST DRAFT — per docs/TRANSCRIPTION_SPEC.md §7.4, the real prompt needs
// iterating against real meeting transcripts, which cannot happen from this
// sandbox. This is a working starting point, not a calibrated final version:
// expect to revise the wording (and possibly add few-shot examples) once
// there is real usage to look at.
const SYSTEM_PROMPT = [
  "Eres un asistente que analiza la transcripcion de una llamada o reunion de trabajo.",
  "Devuelve SOLO un objeto JSON (sin texto fuera del JSON) con esta forma exacta:",
  '{"summary": string, "decisions": string[], "actionItems": [{"text": string}], "proposedEvents": [{"title": string, "startsAt": string ISO 8601, "endsAt": string ISO 8601 opcional, "description": string opcional}]}',
  "summary: minuta breve en espanol, 3-6 oraciones, en tono neutral.",
  "decisions: acuerdos concretos ya tomados en la reunion, cada uno una oracion corta.",
  "actionItems: tareas pendientes que alguien debe hacer despues de la reunion, en infinitivo (ej. 'Enviar la propuesta al cliente'). No inventes tareas que no se mencionaron.",
  "proposedEvents: solo si se menciono explicitamente una fecha/hora concreta para una proxima reunion o entrega; si no se menciono ninguna fecha concreta, devuelve un arreglo vacio. Nunca inventes una fecha.",
  "Si la transcripcion no tiene contenido suficiente para alguna de estas listas, devuelve un arreglo vacio en vez de inventar contenido.",
].join(" ");

export function createCallTranscriptAnalysisService({
  prisma,
  tasksService,
  calendarService,
  env = process.env,
  fetchImpl = null,
  logAudit = null,
}) {
  async function callGroq(transcriptText) {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) throw new CallTranscriptAnalysisError("Analisis con IA no configurado (falta GROQ_API_KEY).", 503);
    const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
    const model = env.CHAT_TRANSCRIPT_ANALYSIS_MODEL || env.CHAT_MIRAI_MODEL || "openai/gpt-oss-120b";
    const fetchFn = fetchImpl ?? globalThis.fetch;
    const body = {
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      ...(isReasoningModel(model) ? { reasoning_format: "hidden", reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcriptText.slice(0, 60000) },
      ],
    };
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastErr = new CallTranscriptAnalysisError(`No se pudo contactar al servicio de IA: ${err.message}`, 502);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new CallTranscriptAnalysisError(`El servicio de IA respondio ${res.status}.`, 502);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new CallTranscriptAnalysisError(`El servicio de IA rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`);
      }
      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content;
      const obj = extractJsonObject(content);
      if (!obj) throw new CallTranscriptAnalysisError("El servicio de IA no devolvio un JSON legible.");
      return { obj, model: payload.model ?? model };
    }
    throw lastErr ?? new CallTranscriptAnalysisError("El servicio de IA no respondio.", 502);
  }

  function normalizeDraft(obj) {
    return {
      summary: String(obj.summary ?? ""),
      decisions: Array.isArray(obj.decisions) ? obj.decisions.map(String) : [],
      actionItems: Array.isArray(obj.actionItems)
        ? obj.actionItems.map((it) => ({ text: String(it?.text ?? "") })).filter((it) => it.text)
        : [],
      proposedEvents: Array.isArray(obj.proposedEvents)
        ? obj.proposedEvents
          .map((ev) => ({
            title: String(ev?.title ?? ""),
            startsAt: ev?.startsAt ?? null,
            endsAt: ev?.endsAt ?? null,
            description: ev?.description ?? null,
          }))
          .filter((ev) => ev.title && ev.startsAt)
        : [],
    };
  }

  async function analyzeTranscript({ transcriptId, profileId }) {
    const transcript = await prisma.callTranscript.findUnique({
      where: { id: transcriptId },
      include: { segments: { orderBy: { startMs: "asc" } } },
    });
    if (!transcript) throw new CallTranscriptAnalysisError("Transcripción no encontrada.", 404);
    if (transcript.status !== "READY") {
      throw new CallTranscriptAnalysisError("La transcripción todavía no está lista.", 409);
    }
    const segments = transcript.segments ?? [];
    if (!segments.length) throw new CallTranscriptAnalysisError("La transcripción no tiene contenido para analizar.", 422);

    const transcriptText = segments
      .map((s) => (s.speakerLabel ? `${s.speakerLabel}: ${s.text}` : s.text))
      .join("\n");

    const { obj, model } = await callGroq(transcriptText);
    const draft = normalizeDraft(obj);

    const saved = await prisma.callTranscriptAnalysis.upsert({
      where: { transcriptId },
      create: {
        transcriptId,
        companyId: transcript.companyId,
        summary: draft.summary,
        decisions: draft.decisions,
        actionItems: draft.actionItems,
        proposedEvents: draft.proposedEvents,
        model,
        generatedByUserId: profileId,
      },
      update: {
        summary: draft.summary,
        decisions: draft.decisions,
        actionItems: draft.actionItems,
        proposedEvents: draft.proposedEvents,
        model,
        generatedByUserId: profileId,
        generatedAt: new Date(),
        committedAt: null,
      },
    });

    const proofToken = signAiProof({ transcriptId, companyId: transcript.companyId, actorId: profileId }, env);

    if (logAudit) {
      await logAudit({
        companyId: transcript.companyId,
        actorId: profileId,
        entityType: "CallTranscriptAnalysis",
        entityId: saved.id,
        action: "chat.call_transcript.analyze",
        after: { transcriptId },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { analysis: saved, proofToken };
  }

  async function getDefaultStatusId(projectId) {
    // Same fallback chain as projects-recurring-service.js's defaultStatus
    // resolution: prefer the project's own isDefault status, fall back to
    // its first status by position.
    const defaultStatus = await prisma.taskStatus.findFirst({ where: { projectId, isDefault: true } })
      ?? await prisma.taskStatus.findFirst({ where: { projectId }, orderBy: { position: "asc" } });
    if (!defaultStatus) throw new CallTranscriptAnalysisError("El proyecto elegido no tiene un estado de tarea configurado.", 422);
    return defaultStatus.id;
  }

  async function commitProposals({ transcriptId, profileId, proofToken, acceptedActionItems, acceptedEvents }) {
    const transcript = await prisma.callTranscript.findUnique({ where: { id: transcriptId } });
    if (!transcript) throw new CallTranscriptAnalysisError("Transcripción no encontrada.", 404);
    const analysis = await prisma.callTranscriptAnalysis.findUnique({ where: { transcriptId } });
    if (!analysis) throw new CallTranscriptAnalysisError("No hay un análisis pendiente para esta transcripción.", 409);

    let proof;
    try {
      proof = verifyAiProof(proofToken, env);
    } catch (err) {
      if (err instanceof AiProofTokenError) throw new CallTranscriptAnalysisError(err.message, 409);
      throw err;
    }
    if (proof.transcriptId !== transcriptId || proof.companyId !== transcript.companyId) {
      throw new CallTranscriptAnalysisError("El token de prueba no corresponde a esta transcripción.", 409);
    }

    const createdTasks = [];
    for (const item of acceptedActionItems ?? []) {
      const source = analysis.actionItems?.[item.index];
      if (!source) continue;
      const statusId = await getDefaultStatusId(item.projectId);
      const task = await tasksService.createTask(item.projectId, profileId, {
        title: source.text,
        assigneeId: item.assigneeUserId ?? null,
        dueDate: item.dueDate ?? null,
        statusId,
      });
      createdTasks.push(task);
    }

    const createdEvents = [];
    for (const item of acceptedEvents ?? []) {
      const source = analysis.proposedEvents?.[item.index];
      if (!source) continue;
      const event = await calendarService.createEvent(profileId, {
        calendarId: item.calendarId,
        title: source.title,
        description: source.description ?? null,
        startAt: source.startsAt,
        endAt: source.endsAt ?? null,
        sourceModule: "runly.chat",
        sourceEntityId: transcriptId,
      }, transcript.companyId);
      createdEvents.push(event);
    }

    const updated = await prisma.callTranscriptAnalysis.update({
      where: { transcriptId },
      data: {
        committedTaskIds: [...(analysis.committedTaskIds ?? []), ...createdTasks.map((t) => t.id)],
        committedEventIds: [...(analysis.committedEventIds ?? []), ...createdEvents.map((e) => e.id)],
        committedAt: new Date(),
      },
    });

    if (logAudit) {
      await logAudit({
        companyId: transcript.companyId,
        actorId: profileId,
        entityType: "CallTranscriptAnalysis",
        entityId: analysis.id,
        action: "chat.call_transcript.commit_proposals",
        after: { taskIds: createdTasks.map((t) => t.id), eventIds: createdEvents.map((e) => e.id) },
      }).catch((error) => console.warn(`${LOG_PREFIX} No se pudo escribir el audit log:`, error?.message ?? error));
    }

    return { analysis: updated, createdTasks, createdEvents };
  }

  return { analyzeTranscript, commitProposals };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:/RacoonDevs/runly && node --test apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js`
Expected: all pass, 0 fail.

- [ ] **Step 5: Syntax check**

Run: `cd D:/RacoonDevs/runly && node --check apps/api/src/routes/calls/call-transcript-analysis-service.js`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calls/call-transcript-analysis-service.js apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js
git commit -m "feat(chat): add call-transcript-analysis-service (MirAI Etapa 5 backend)"
```

---

### Task 6: Wire the two new routes + SDK methods

**Files:**
- Modify: `apps/api/src/routes/calls/index.js`
- Modify: `packages/sdk/src/domains/calls.js`
- Test: `apps/api/src/routes/calls/__tests__/call-routes.test.js` (existing file — add cases, don't create a new one; check its actual name/location first with `ls apps/api/src/routes/calls/__tests__/` since this plan assumes but does not re-verify the exact existing route-test filename)

- [ ] **Step 1: Wire the service into the router factory**

In `apps/api/src/routes/calls/index.js`, add the import next to the other transcript-related imports:

```js
import { createCallTranscriptAnalysisService, CallTranscriptAnalysisError } from "./call-transcript-analysis-service.js";
import { createTasksService } from "../projects/tasks-service.js";
import { createCalendarEventService } from "../calendar/calendar-event-service.js";
import { callTranscriptCommitProposalsSchema } from "@runly/validators";
```

Add `CallTranscriptAnalysisError` to the `handleError` instanceof chain (find the existing chain ending in `|| error instanceof CallTranscriptError` and extend it):

```js
    || error instanceof CallTranscriptError
    || error instanceof CallTranscriptAnalysisError
```

Inside `createCallsRouter({...})`, next to where `transcriptService` is built, add:

```js
  const analysisService = createCallTranscriptAnalysisService({
    prisma,
    tasksService: createTasksService({ prisma }),
    calendarService: createCalendarEventService({ prisma }),
    logAudit,
  });
```

- [ ] **Step 2: Add the two routes**

Directly after the existing `internal.delete("/transcripts/:transcriptId", ...)` block (before the blank line that precedes `internal.get("/:id", ...)`), add:

```js
  internal.post(
    "/transcripts/:transcriptId/analyze",
    requirePermission("chat.calls.transcript.analyze"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const profileId = c.get("userId");
        // Same access bar as reading the transcript itself (spec §7.3): must
        // have participated in the call, requested it, or hold
        // chat.calls.transcript.manage — reuse getTranscript's own check by
        // calling it first and discarding the result, rather than
        // duplicating wasParticipantOrRequester here.
        await transcriptService.getTranscript({ transcriptId, profileId });
        const data = await analysisService.analyzeTranscript({ transcriptId, profileId });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error analizando la transcripción."); }
    },
  );
  internal.post(
    "/transcripts/:transcriptId/commit-proposals",
    requirePermission("chat.calls.transcript.analyze"),
    async (c) => {
      try {
        const transcriptId = transcriptIdSchema.parse(c.req.param("transcriptId"));
        const profileId = c.get("userId");
        await transcriptService.getTranscript({ transcriptId, profileId });
        const body = callTranscriptCommitProposalsSchema.parse(await c.req.json());
        const data = await analysisService.commitProposals({ transcriptId, profileId, ...body });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error confirmando las propuestas."); }
    },
  );
```

- [ ] **Step 3: Syntax check**

Run: `cd D:/RacoonDevs/runly && node --check apps/api/src/routes/calls/index.js`
Expected: no output (success).

- [ ] **Step 4: Add the two SDK methods**

In `packages/sdk/src/domains/calls.js`, directly after the existing `deleteTranscript` method, add:

```js
    analyzeTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/analyze`, "POST", {}, token),
    commitTranscriptProposals: (transcriptId, body, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/commit-proposals`, "POST", body, token),
```

- [ ] **Step 5: Run the existing calls test suite to confirm no regression**

Run: `cd D:/RacoonDevs/runly && node --test "apps/api/src/routes/calls/__tests__/*.test.js"`
Expected: all previously-passing tests still pass; no new failures.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calls/index.js packages/sdk/src/domains/calls.js
git commit -m "feat(chat): wire /transcripts/:id/analyze and /commit-proposals routes"
```

---

### Task 7: Frontend hooks

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/hooks/useConversationTranscripts.js`

- [ ] **Step 1: Add `useAnalyzeTranscript`/`useCommitTranscriptProposals`**

Append to the file, following the exact same shape as the existing `useRetryTranscript`/`useRegenerateTranscript`:

```js
export function useAnalyzeTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptId) => runly.calls.analyzeTranscript(transcriptId, session.access_token),
    onSuccess: (_data, transcriptId) => {
      qc.invalidateQueries({ queryKey: ["chat-transcript-analysis", transcriptId] });
    },
  });
}

export function useCommitTranscriptProposals(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ transcriptId, ...body }) => runly.calls.commitTranscriptProposals(transcriptId, body, session.access_token),
    onSuccess: (_data, { transcriptId }) => {
      qc.invalidateQueries({ queryKey: ["chat-transcript-analysis", transcriptId] });
    },
  });
}
```

(Both mutations return the fresh analysis in their response, so this dialog reads directly off the mutation's own `data` rather than needing a dedicated `useQuery` — no new query key to wire into `getTranscript`'s response shape.)

- [ ] **Step 2: Syntax check**

Run: `cd D:/RacoonDevs/runly && node --check apps/desktop/src/modules/runly.chat/hooks/useConversationTranscripts.js`

Note: this is a `.js` file with no JSX, so `node --check` works directly; if it were `.jsx` this step would instead be "confirm `pnpm --filter @runly/desktop build:web` compiles it" (see Task 8).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/hooks/useConversationTranscripts.js
git commit -m "feat(chat): add useAnalyzeTranscript/useCommitTranscriptProposals hooks"
```

---

### Task 8: Review dialog UI

**Files:**
- Create: `apps/desktop/src/modules/runly.chat/components/TranscriptAnalysisDialog.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/TranscriptViewerDialog.jsx`

Per CLAUDE.md's UI-first policy: project/calendar pickers use `ComboboxField` (read-only option sets, no inline-create need here), never a native `<select>`.

- [ ] **Step 1: Create the dialog**

```jsx
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Skeleton, ErrorState, ComboboxField, Textarea,
} from "@runly/ui";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useAnalyzeTranscript, useCommitTranscriptProposals } from "../hooks/useConversationTranscripts";

function unwrap(r) { return r?.data ?? r; }

function useProjectOptions() {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["chat-transcript-analysis-projects"],
    enabled: Boolean(session?.access_token),
    queryFn: () => runly.projects.listProjects(session.access_token),
  });
  return (unwrap(data) ?? []).map((p) => ({ value: p.id, label: p.name }));
}

function useCalendarOptions() {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["chat-transcript-analysis-calendars"],
    enabled: Boolean(session?.access_token),
    queryFn: () => runly.calendar.listCalendars(session.access_token),
  });
  return (unwrap(data) ?? []).map((c) => ({ value: c.id, label: c.name }));
}

export function TranscriptAnalysisDialog({ transcriptId, open, onOpenChange }) {
  const analyze = useAnalyzeTranscript();
  const commit = useCommitTranscriptProposals();
  const projectOptions = useProjectOptions();
  const calendarOptions = useCalendarOptions();
  const [taskProjects, setTaskProjects] = useState({}); // { [index]: projectId }
  const [eventCalendars, setEventCalendars] = useState({}); // { [index]: calendarId }

  const analysis = unwrap(analyze.data)?.analysis ?? unwrap(commit.data)?.analysis;
  const proofToken = unwrap(analyze.data)?.proofToken;

  async function handleAnalyze() {
    try {
      await analyze.mutateAsync(transcriptId);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo analizar la transcripción.");
    }
  }

  async function handleCommit() {
    const acceptedActionItems = Object.entries(taskProjects)
      .filter(([, projectId]) => projectId)
      .map(([index, projectId]) => ({ index: Number(index), projectId }));
    const acceptedEvents = Object.entries(eventCalendars)
      .filter(([, calendarId]) => calendarId)
      .map(([index, calendarId]) => ({ index: Number(index), calendarId }));
    if (!acceptedActionItems.length && !acceptedEvents.length) {
      toast.error("Elige al menos una tarea o evento para confirmar.");
      return;
    }
    try {
      const result = await commit.mutateAsync({ transcriptId, proofToken, acceptedActionItems, acceptedEvents });
      const { createdTasks, createdEvents } = unwrap(result);
      toast.success(`Creadas ${createdTasks.length} tarea(s) y ${createdEvents.length} evento(s).`);
      setTaskProjects({});
      setEventCalendars({});
    } catch (err) {
      toast.error(err?.message ?? "No se pudo confirmar las propuestas.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Analisis de MirAI</DialogTitle>
          <DialogDescription>
            Resumen, acuerdos y tareas/eventos propuestos a partir de la transcripción.
          </DialogDescription>
        </DialogHeader>

        {!analysis && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Button onClick={handleAnalyze} disabled={analyze.isPending}>
              {analyze.isPending ? "Analizando..." : "Analizar con MirAI"}
            </Button>
          </div>
        )}

        {analyze.isPending && <Skeleton className="h-24 w-full" />}
        {analyze.isError && <ErrorState message="No se pudo analizar la transcripción." />}

        {analysis && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium">Resumen</h3>
              <Textarea readOnly value={analysis.summary} className="mt-1 resize-none" rows={3} />
            </div>

            {analysis.decisions?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Acuerdos</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {analysis.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}

            {analysis.actionItems?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Tareas propuestas</h3>
                <div className="mt-1 flex flex-col gap-2">
                  {analysis.actionItems.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">{item.text}</span>
                      <ComboboxField
                        className="w-48"
                        placeholder="Elegir proyecto..."
                        options={projectOptions}
                        value={taskProjects[index] ?? ""}
                        onChange={(value) => setTaskProjects((prev) => ({ ...prev, [index]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.proposedEvents?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Eventos propuestos</h3>
                <div className="mt-1 flex flex-col gap-2">
                  {analysis.proposedEvents.map((ev, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">
                        {ev.title} — {new Date(ev.startsAt).toLocaleString("es-MX")}
                      </span>
                      <ComboboxField
                        className="w-48"
                        placeholder="Elegir calendario..."
                        options={calendarOptions}
                        value={eventCalendars[index] ?? ""}
                        onChange={(value) => setEventCalendars((prev) => ({ ...prev, [index]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAnalyze} disabled={analyze.isPending}>
                Analizar de nuevo
              </Button>
              <Button onClick={handleCommit} disabled={commit.isPending}>
                {commit.isPending ? "Confirmando..." : "Confirmar seleccionadas"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Note for whoever executes this task:** `ComboboxField`'s exact prop names (`options`/`value`/`onChange` vs. something else) and whether it takes `{value,label}` pairs are assumed here by pattern, not re-verified against `packages/ui/src/components/ComboboxField.jsx` in this planning pass — **read that file first** before writing this step for real, and adjust the prop names to match if they differ. Same for `Textarea`'s `readOnly` support. This is the one place in this plan where the exact prop contract was not independently confirmed against the component source.

- [ ] **Step 2: Wire an "Analizar con MirAI" button into `TranscriptViewerDialog.jsx`**

In `apps/desktop/src/modules/runly.chat/components/TranscriptViewerDialog.jsx`:
- Add the import: `import { TranscriptAnalysisDialog } from "./TranscriptAnalysisDialog";`
- Add local state: `const [analysisOpen, setAnalysisOpen] = useState(false);` (next to the existing `confirmRegenerate` state)
- Add a button next to the existing Copy/Download/Retry buttons (find that button row and add one more, gated the same way the transcript actions already are — only when `transcript.status === "READY"`):

```jsx
<Button variant="outline" onClick={() => setAnalysisOpen(true)}>
  Analizar con MirAI
</Button>
```

- At the end of the component's JSX (as a sibling to the main `Dialog`, not nested inside it), render:

```jsx
<TranscriptAnalysisDialog transcriptId={transcriptId} open={analysisOpen} onOpenChange={setAnalysisOpen} />
```

- [ ] **Step 3: Build check**

Run: `cd D:/RacoonDevs/runly && pnpm --filter @runly/desktop build:web`
Expected: `✓ built in ...s` with no new errors (pre-existing "chunk larger than 500kB" warnings are fine, unrelated).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/components/TranscriptAnalysisDialog.jsx apps/desktop/src/modules/runly.chat/components/TranscriptViewerDialog.jsx
git commit -m "feat(chat): add MirAI transcript analysis review dialog"
```

---

### Task 9: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run every touched Node test file**

Run:
```bash
cd D:/RacoonDevs/runly && node --test \
  apps/api/src/lib/__tests__/ai-proof-token.test.js \
  apps/api/src/routes/ledger/__tests__/ai-import-token.test.js \
  apps/api/src/routes/calls/__tests__/*.test.js
```
Expected: all pass, 0 fail.

- [ ] **Step 2: Lint every touched JS/JSX file in one pass**

Run:
```bash
cd D:/RacoonDevs/runly && npx eslint \
  apps/api/src/lib/ai-proof-token.js \
  apps/api/src/routes/ledger/ai-import-token.js \
  apps/api/src/routes/calls/call-transcript-analysis-service.js \
  apps/api/src/routes/calls/index.js \
  apps/desktop/src/modules/runly.chat/hooks/useConversationTranscripts.js \
  apps/desktop/src/modules/runly.chat/components/TranscriptAnalysisDialog.jsx \
  apps/desktop/src/modules/runly.chat/components/TranscriptViewerDialog.jsx
```
Expected: exit code 0, no output.

- [ ] **Step 3: Full desktop web build**

Run: `cd D:/RacoonDevs/runly && pnpm --filter @runly/desktop build:web`
Expected: clean build.

- [ ] **Step 4: Report status to the user**

Summarize: which tests/lint/build passed automatically vs. what still needs the user's own environment — specifically, seeding/confirming the new permission against the real dev DB if Task 3 Step 3's command needed adjusting, and a real manual pass in the browser (analyze a real READY transcript, confirm at least one task and one event, check they appear in `runly.projects`/`runly.calendar`) since no automated test proves the full click-through UX. Also flag explicitly, per the plan header: the Groq prompt in Task 5 is a first draft and the user should expect to tune its wording after seeing real output against a real transcript.

---

## Post-implementation note for the user

This plan does not touch:
- The exact Groq prompt calibration — shipped as a labeled first draft (Task 5), per `docs/TRANSCRIPTION_SPEC.md` §7.4's explicit instruction not to invent a final prompt without real data.
- V2 (speaker-attributed transcripts, `CallTranscriptTrack`) — separate, still blocked on a real LiveKit call per the spec's revision 3.
- Any UI polish beyond the minimum review screen (no drag-reorder, no inline text editing of the summary before committing, no `.docx` export of the analysis) — not requested by the spec's §8 UI classification for this stage.
