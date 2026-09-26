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

// Default fixtures below assume companyId "c1" and profileId "u1" (the
// values every test but the cross-company one uses), so existing tests keep
// passing without repeating this boilerplate: "proj-1" belongs to "c1" and
// "u1" is a real (non-owner) ProjectMember on it.
function basePrisma({
  transcript,
  segments,
  analysis = null,
  projects = [{ id: "proj-1", companyId: "c1", ownerId: "someone-else" }],
  projectMembers = [{ projectId: "proj-1", userId: "u1", role: "MEMBER" }],
}) {
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
    taskStatus: {
      findFirst: async ({ where }) => (where.projectId ? { id: "status-default" } : null),
    },
    project: {
      findFirst: async ({ where }) => projects.find((p) => p.id === where.id) ?? null,
    },
    projectMember: {
      findFirst: async ({ where }) =>
        projectMembers.find((m) => m.projectId === where.projectId && m.userId === where.userId) ?? null,
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

  it("includes a module's proposals (runly.contacts) in the saved analysis when the module is available and Groq returned some", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const prisma = {
      ...basePrisma({ transcript, segments: [{ startMs: 0, text: "hola" }] }),
      runlyModule: { findUnique: async () => ({ id: "mod-contacts", status: "INSTALLED", enabled: true }) },
      companyModule: { findMany: async () => [] },
      contact: { findMany: async () => [] }, // no existing match -> "create"
    };
    const draft = {
      summary: "s", decisions: [], actionItems: [], proposedEvents: [],
      proposedContacts: [{ name: "Juan Pérez", suggestedType: "customer", email: "juan@acme.com" }],
    };
    const fetchImpl = mock.fn(async () => fakeGroqResponse(draft));
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, fetchImpl, tasksService: {}, calendarService: {} });

    const result = await service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" });

    const contactsBucket = result.analysis.moduleProposals?.["runly.contacts"];
    assert.ok(contactsBucket, "expected a runly.contacts bucket in moduleProposals");
    assert.equal(contactsBucket.proposed.length, 1);
    assert.equal(contactsBucket.proposed[0].name, "Juan Pérez");
    assert.equal(contactsBucket.proposed[0].matchedContactId, null);
  });

  it("never includes runly.contacts in moduleProposals when the module isn't available for this company", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const prisma = {
      ...basePrisma({ transcript, segments: [{ startMs: 0, text: "hola" }] }),
      runlyModule: { findUnique: async () => ({ id: "mod-contacts", status: "INSTALLED", enabled: true }) },
      // Explicitly disabled for THIS company (CompanyModule override).
      companyModule: { findMany: async () => [{ moduleId: "mod-contacts" }] },
    };
    const draft = {
      summary: "s", decisions: [], actionItems: [], proposedEvents: [],
      proposedContacts: [{ name: "Juan Pérez", suggestedType: "customer" }],
    };
    const fetchImpl = mock.fn(async () => fakeGroqResponse(draft));
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, fetchImpl, tasksService: {}, calendarService: {} });

    const result = await service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" });

    assert.equal(result.analysis.moduleProposals?.["runly.contacts"], undefined);
  });

  it("passes the call's real startedAt as a reference date, so Groq can resolve relative expressions ('la proxima semana')", async () => {
    const transcript = { id: "t1", status: "READY", companyId: "c1", call: { startedAt: new Date("2026-09-24T15:00:00.000Z") } };
    const segments = [{ startMs: 0, text: "Nos vemos la proxima semana." }];
    const prisma = basePrisma({ transcript, segments });
    const draft = { summary: "s", decisions: [], actionItems: [], proposedEvents: [] };
    let capturedBody;
    const fetchImpl = mock.fn(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return fakeGroqResponse(draft);
    });
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, fetchImpl, tasksService: {}, calendarService: {} });

    await service.analyzeTranscript({ transcriptId: "t1", profileId: "u1" });

    const systemMessage = capturedBody.messages.find((m) => m.role === "system");
    assert.match(systemMessage.content, /2026-09-24T15:00:00\.000Z/);
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
    assert.equal(createdTasks[0].statusId, "status-default");
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0].title, "Seguimiento");
    assert.equal(createdEvents[0].sourceModule, "runly.chat");
    assert.equal(createdEvents[0].sourceEntityId, "t1");
    assert.equal(result.createdTasks.length, 1);
    assert.equal(result.createdEvents.length, 1);
    assert.deepEqual(result.skippedActionItems, []);
    assert.deepEqual(result.skippedEvents, []);
  });

  it("commits an accepted contact proposal, creating a Contact and recording its id under moduleProposals.committedIds", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [], proposedEvents: [],
      moduleProposals: {
        "runly.contacts": {
          proposed: [{ name: "Juan Pérez", suggestedType: "customer", email: "juan@acme.com", phone: null, company: null, matchedContactId: null }],
          committedIds: [],
        },
      },
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    let createdContact = null;
    const prisma = {
      ...basePrisma({ transcript, segments: [], analysis }),
      contact: {
        create: async ({ data }) => { createdContact = { id: "new-contact-1", ...data }; return createdContact; },
      },
      membership: {
        findFirst: async () => ({ role: { key: "member", permissions: [{ permission: { key: "contacts.contacts.create", active: true } }] } }),
        findMany: async () => [],
      },
      userPermissionGrant: { findMany: async () => [] },
    };
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService: {}, calendarService: {} });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [], acceptedEvents: [],
      acceptedModuleProposals: [{ moduleKey: "runly.contacts", index: 0, decision: { type: "customer" } }],
    });

    assert.equal(createdContact.companyId, "c1");
    assert.equal(createdContact.name, "Juan Pérez");
    assert.equal(result.createdModuleRecords.length, 1);
    assert.equal(result.createdModuleRecords[0].recordId, "new-contact-1");
    assert.deepEqual(result.skippedModuleProposals, []);
    assert.deepEqual(result.analysis.moduleProposals["runly.contacts"].committedIds, ["new-contact-1"]);
  });

  it("rejects an accepted contact proposal when the caller lacks contacts write permission, without affecting other accepted items", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [{ text: "Enviar propuesta" }], proposedEvents: [],
      moduleProposals: {
        "runly.contacts": {
          proposed: [{ name: "Juan Pérez", suggestedType: "customer", email: null, phone: null, company: null, matchedContactId: null }],
          committedIds: [],
        },
      },
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    const createdTasks = [];
    const prisma = {
      ...basePrisma({ transcript, segments: [], analysis }),
      membership: { findFirst: async () => null, findMany: async () => [] }, // no membership -> no permission at all
      userPermissionGrant: { findMany: async () => [] },
    };
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const tasksService = {
      createTask: async (projectId, createdBy, data) => {
        const task = { id: `task-${createdTasks.length}`, projectId, createdBy, ...data };
        createdTasks.push(task);
        return task;
      },
    };
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService, calendarService: {} });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [{ index: 0, projectId: "proj-1" }], acceptedEvents: [],
      acceptedModuleProposals: [{ moduleKey: "runly.contacts", index: 0, decision: { type: "customer" } }],
    });

    assert.equal(result.createdTasks.length, 1, "the task must still commit even though the contact was rejected");
    assert.equal(result.createdModuleRecords.length, 0);
    assert.equal(result.skippedModuleProposals.length, 1);
    assert.match(result.skippedModuleProposals[0].reason, /permiso/i);
  });

  it("skips an out-of-range accepted index instead of throwing, and still commits what succeeded", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [{ text: "Enviar propuesta" }],
      proposedEvents: [],
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    const prisma = basePrisma({ transcript, segments: [], analysis });
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const createdTasks = [];
    const tasksService = {
      createTask: async (projectId, createdBy, data) => {
        const task = { id: `task-${createdTasks.length}`, projectId, createdBy, ...data };
        createdTasks.push(task);
        return task;
      },
    };
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService, calendarService: {} });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [
        { index: 0, projectId: "proj-1" },
        { index: 5, projectId: "proj-1" }, // out of range: analysis only has index 0
      ],
      acceptedEvents: [],
    });

    assert.equal(createdTasks.length, 1);
    assert.equal(result.createdTasks.length, 1);
    assert.equal(result.skippedActionItems.length, 1);
    assert.equal(result.skippedActionItems[0].index, 5);
    assert.match(result.skippedActionItems[0].reason, /indice/);
    assert.ok(result.analysis.committedAt, "still records the commit for the item that did succeed");
  });

  it("rejects an accepted action item whose project belongs to a different company, but still commits a same-company item", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [{ text: "Tarea del proyecto propio" }, { text: "Tarea de otra empresa" }],
      proposedEvents: [],
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    // "proj-1" is in the caller's own company ("c1") and "u1" is a real
    // ProjectMember on it. "proj-2" belongs to a different company ("c2")
    // entirely — this is the cross-tenant task-injection path the fix closes.
    const prisma = basePrisma({
      transcript, segments: [], analysis,
      projects: [
        { id: "proj-1", companyId: "c1", ownerId: "someone-else" },
        { id: "proj-2", companyId: "c2", ownerId: "someone-else" },
      ],
      projectMembers: [{ projectId: "proj-1", userId: "u1", role: "MEMBER" }],
    });
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const createdTasks = [];
    const tasksService = {
      createTask: async (projectId, createdBy, data) => {
        const task = { id: `task-${createdTasks.length}`, projectId, createdBy, ...data };
        createdTasks.push(task);
        return task;
      },
    };
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService, calendarService: {} });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [
        { index: 0, projectId: "proj-1" },
        { index: 1, projectId: "proj-2" }, // different company — must be rejected
      ],
      acceptedEvents: [],
    });

    assert.equal(createdTasks.length, 1);
    assert.equal(createdTasks[0].projectId, "proj-1");
    assert.equal(result.createdTasks.length, 1);
    assert.equal(result.skippedActionItems.length, 1);
    assert.equal(result.skippedActionItems[0].index, 1);
    assert.match(result.skippedActionItems[0].reason, /no encontrado|acceso/i);
    assert.equal(createdTasks.some((t) => t.projectId === "proj-2"), false);
  });

  it("rejects a same-company action item when the caller is only a VIEWER on that project", async () => {
    const { signAiProof } = await import("../../../lib/ai-proof-token.js");
    const transcript = { id: "t1", status: "READY", companyId: "c1" };
    const analysis = {
      id: "an-1", transcriptId: "t1", companyId: "c1",
      actionItems: [{ text: "Tarea que un viewer no deberia poder crear" }],
      proposedEvents: [],
      committedAt: null, committedTaskIds: null, committedEventIds: null,
    };
    const prisma = basePrisma({
      transcript, segments: [], analysis,
      projects: [{ id: "proj-1", companyId: "c1", ownerId: "someone-else" }],
      // "u1" is a real ProjectMember, but only VIEWER — same as a real
      // requireProjectAccess('MEMBER') rejection on the normal task route.
      projectMembers: [{ projectId: "proj-1", userId: "u1", role: "VIEWER" }],
    });
    const proofToken = signAiProof({ transcriptId: "t1", companyId: "c1", actorId: "u1" }, ENV);
    const createdTasks = [];
    const tasksService = {
      createTask: async (projectId, createdBy, data) => {
        const task = { id: `task-${createdTasks.length}`, projectId, createdBy, ...data };
        createdTasks.push(task);
        return task;
      },
    };
    const service = createCallTranscriptAnalysisService({ prisma, env: ENV, tasksService, calendarService: {} });

    const result = await service.commitProposals({
      transcriptId: "t1", profileId: "u1", proofToken,
      acceptedActionItems: [{ index: 0, projectId: "proj-1" }],
      acceptedEvents: [],
    });

    assert.equal(createdTasks.length, 0);
    assert.equal(result.skippedActionItems.length, 1);
    assert.match(result.skippedActionItems[0].reason, /acceso suficiente/i);
  });
});
