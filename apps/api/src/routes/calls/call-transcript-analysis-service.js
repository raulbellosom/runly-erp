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

  // SECURITY: neither this function nor commitProposals below checks
  // participant/requester access on its own (no assertMember/
  // wasParticipantOrRequester call) — that check is enforced exclusively by
  // the caller. Today the only sanctioned caller is
  // apps/api/src/routes/calls/index.js's /analyze and /commit-proposals
  // routes, which both call transcriptService.getTranscript(...) first and
  // discard the result purely for its access-check side effect. Any new
  // caller (a script, another route, a queue worker) MUST perform that same
  // check before invoking this service, or it will silently bypass
  // docs/TRANSCRIPTION_SPEC.md §5.1/§7.3's access rule.
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

  // Mirrors requireProjectAccess's real authorization shape (see
  // projects-routes.js) since commitProposals calls tasksService.createTask
  // directly, bypassing that HTTP middleware entirely: tasksService's own
  // validateTargets only confirms the project *exists*, with no companyId or
  // membership check, so without this the transcript-analysis permission
  // alone would let a caller create a Task in any project in any company by
  // supplying an arbitrary projectId in acceptedActionItems.
  async function assertProjectAccess(projectId, profileId, companyId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId },
      select: { id: true, companyId: true, ownerId: true },
    });
    if (!project || project.companyId !== companyId) {
      throw new CallTranscriptAnalysisError("Proyecto no encontrado.", 404);
    }
    if (project.ownerId === profileId) return;
    const member = await prisma.projectMember.findFirst({ where: { projectId, userId: profileId }, select: { role: true } });
    // Same minimum as the real task-creation route, requireProjectAccess('MEMBER')
    // in projects-routes.js — a project VIEWER can read but not create tasks
    // through the normal API, so this path must not let them do it either.
    const PROJECT_ROLE_RANK = { VIEWER: 1, MEMBER: 2, OWNER: 3 };
    if (!member || (PROJECT_ROLE_RANK[member.role] ?? 0) < PROJECT_ROLE_RANK.MEMBER) {
      throw new CallTranscriptAnalysisError("No tienes acceso suficiente en ese proyecto.", 403);
    }
  }

  // Known V1 limitations (not implemented in this pass, no hecho a proposito):
  // - No idempotency/dedup guard against double-submitting the same accepted
  //   items — would need tracking committed indices, not just the resulting
  //   row IDs, which is a real schema/design question left for a follow-up.
  // - No shared Groq-JSON-client extraction with ai-import-extraction.js's
  //   near-identical callGroqText — pre-existing duplication pattern in this
  //   codebase, not a regression introduced here.
  // - The persisted analysis is not currently read back anywhere (no GET
  //   route/query includes the `analysis` relation) — reopening a transcript
  //   re-runs Groq instead of showing the stored draft, which is the
  //   opposite of what spec §7.1 says persistence is for. A real gap, not by
  //   design — deferred here for scope, not forgotten.
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
    const skippedActionItems = []; // { index, reason }
    for (const item of acceptedActionItems ?? []) {
      const source = analysis.actionItems?.[item.index];
      if (!source) {
        skippedActionItems.push({ index: item.index, reason: "No existe una propuesta con ese indice." });
        continue;
      }
      try {
        await assertProjectAccess(item.projectId, profileId, transcript.companyId);
        const statusId = await getDefaultStatusId(item.projectId);
        const task = await tasksService.createTask(item.projectId, profileId, {
          title: source.text,
          assigneeId: item.assigneeUserId ?? null,
          dueDate: item.dueDate ?? null,
          statusId,
        });
        createdTasks.push(task);
      } catch (err) {
        skippedActionItems.push({ index: item.index, reason: err?.message ?? String(err) });
      }
    }

    const createdEvents = [];
    const skippedEvents = []; // { index, reason }
    for (const item of acceptedEvents ?? []) {
      const source = analysis.proposedEvents?.[item.index];
      if (!source) {
        skippedEvents.push({ index: item.index, reason: "No existe una propuesta con ese indice." });
        continue;
      }
      try {
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
      } catch (err) {
        skippedEvents.push({ index: item.index, reason: err?.message ?? String(err) });
      }
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

    return { analysis: updated, createdTasks, createdEvents, skippedActionItems, skippedEvents };
  }

  return { analyzeTranscript, commitProposals };
}
