// apps/api/src/routes/notes/__tests__/notes-access.test.js
//
// Access-control regression coverage for atlas.notes:
//   - note read/write requires ownership or an explicit share
//   - trash / permanent-delete are owner-only
//   - shareNote blocks cross-company and self targets (2026-08-30 hardening)
//   - the public endpoint never leaks internal identifiers
//   - the Yjs blob has a hard size ceiling and read-only collaborators can't write
//   - setNoteTags only accepts the acting user's own tags
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createNotesService, NotesServiceError } from "../notes-service.js";
import { createSharesService, SharesServiceError } from "../shares-service.js";
import { createYDocService, YDocServiceError } from "../ydoc-service.js";
import { createTagsService, TagsServiceError } from "../tags-service.js";

const OWNER = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const NOTE = "01900000-0000-7000-8000-0000000000aa";

function sql(strings) {
  return (Array.isArray(strings) ? strings.join(" ? ") : String(strings)).replace(/\s+/g, " ").trim();
}

// Build a prisma stub from a list of [substringMatcher, rowsOrFn] rules.
function fakePrisma(rules) {
  const run = (strings, ...values) => {
    const text = sql(strings);
    for (const [needle, out] of rules) {
      if (text.toLowerCase().includes(needle.toLowerCase())) {
        return Promise.resolve(typeof out === "function" ? out(values) : out);
      }
    }
    return Promise.resolve([]);
  };
  return { $queryRaw: run, $executeRaw: run };
}

describe("notes-service — read/write require access", () => {
  it("getNote throws 403 for a user who is neither owner nor sharee", async () => {
    const prisma = fakePrisma([
      ["from notes n left join note_shares", [{ id: NOTE, owner_user_id: OWNER, share_permission: null }]],
    ]);
    const svc = createNotesService({ prisma });
    await assert.rejects(
      () => svc.getNote(NOTE, OTHER),
      (e) => e instanceof NotesServiceError && e.status === 403,
    );
  });

  it("getNote allows an edit-sharee", async () => {
    const prisma = fakePrisma([
      ["from notes n left join note_shares", [{ id: NOTE, owner_user_id: OWNER, share_permission: "edit" }]],
      ["json_agg", [{ id: NOTE, title: "hi" }]],
    ]);
    const svc = createNotesService({ prisma });
    const note = await svc.getNote(NOTE, OTHER);
    assert.equal(note.id, NOTE);
  });

  it("updateNote throws 403 for a read-only sharee", async () => {
    const prisma = fakePrisma([
      ["from notes n left join note_shares", [{ id: NOTE, owner_user_id: OWNER, share_permission: "read" }]],
    ]);
    const svc = createNotesService({ prisma });
    await assert.rejects(
      () => svc.updateNote(NOTE, OTHER, { title: "x" }),
      (e) => e instanceof NotesServiceError && e.status === 403,
    );
  });

  it("trashNote is owner-only", async () => {
    const prisma = fakePrisma([
      ["select id, owner_user_id from notes", [{ id: NOTE, owner_user_id: OWNER }]],
    ]);
    const svc = createNotesService({ prisma });
    await assert.rejects(
      () => svc.trashNote(NOTE, OTHER),
      (e) => e instanceof NotesServiceError && e.status === 403,
    );
  });
});

describe("notes-service — updateNote paper_style", () => {
  it("includes paper_style in the CASE update and returns it", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        const text = sql(strings).toLowerCase();
        capturedSql = text;
        if (text.includes("from notes n left join note_shares")) {
          return Promise.resolve([{ id: NOTE, owner_user_id: OWNER, share_permission: null }]);
        }
        if (text.includes("update notes")) {
          return Promise.resolve([{ id: NOTE, paper_style: "lined" }]);
        }
        return Promise.resolve([]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createNotesService({ prisma });
    const note = await svc.updateNote(NOTE, OWNER, { paperStyle: "lined" });
    assert.equal(note.paper_style, "lined");
    assert.match(capturedSql, /paper_style/);
  });
});

describe("shares-service — shareNote target validation", () => {
  const base = [
    ["from notes where id = ? and owner_user_id", [{ id: NOTE }]], // _verifyOwner ok
  ];

  it("rejects sharing with yourself", async () => {
    const svc = createSharesService({ prisma: fakePrisma(base), broadcaster: null });
    await assert.rejects(
      () => svc.shareNote(NOTE, OWNER, { targetUserId: OWNER, permission: "read" }),
      (e) => e instanceof SharesServiceError && e.status === 400,
    );
  });

  it("rejects a target that shares no company with the owner", async () => {
    const prisma = fakePrisma([
      ...base,
      ["from membership m_owner", []], // no shared company
    ]);
    const svc = createSharesService({ prisma, broadcaster: null });
    await assert.rejects(
      () => svc.shareNote(NOTE, OWNER, { targetUserId: OTHER, permission: "read" }),
      (e) => e instanceof SharesServiceError && e.status === 403,
    );
  });

  it("allows a same-company target", async () => {
    const prisma = fakePrisma([
      ...base,
      ["p.key = 'notes.notes.read'", [{ "?column?": 1 }]], // _assertTargetHasNotesAccess ok
      ["from membership m_owner", [{ "?column?": 1 }]],     // _assertShareableTarget ok
      ["insert into note_shares", [{ id: "share-1", note_id: NOTE, shared_with_user_id: OTHER, permission: "read" }]],
    ]);
    const svc = createSharesService({ prisma, broadcaster: null });
    const share = await svc.shareNote(NOTE, OWNER, { targetUserId: OTHER, permission: "read" });
    assert.equal(share.shared_with_user_id, OTHER);
  });

  it("rejects a target without notes-module access", async () => {
    const prisma = fakePrisma([
      ...base,
      ["p.key = 'notes.notes.read'", []],               // no notes-granting / admin role
      ["from membership m_owner", [{ "?column?": 1 }]],  // same company, though
    ]);
    const svc = createSharesService({ prisma, broadcaster: null });
    await assert.rejects(
      () => svc.shareNote(NOTE, OWNER, { targetUserId: OTHER, permission: "read" }),
      (e) => e instanceof SharesServiceError && e.status === 403,
    );
  });
});

describe("shares-service — listShareableUsers", () => {
  it("restricts to notes-module users, excludes self, maps the shape", async () => {
    let captured = "";
    const prisma = {
      $queryRaw: (strings) => {
        captured = sql(strings).toLowerCase();
        return Promise.resolve([{ id: OTHER, display_name: "Dana", email: "d@x.com" }]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createSharesService({ prisma, broadcaster: null });
    const users = await svc.listShareableUsers(OWNER, null);

    assert.deepEqual(users, [{ id: OTHER, displayName: "Dana", email: "d@x.com", avatarUrl: null }]);
    assert.match(captured, /p\.key = 'notes\.notes\.read'/);
    assert.match(captured, /r\.key in \('runly\.admin', 'atlas\.admin', 'system\.admin'\)/);
    assert.match(captured, /m_target\.user_id <> /);
  });
});

describe("shares-service — getPublicNote projection", () => {
  it("selects only render-safe columns, never internal identifiers", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        capturedSql = sql(strings).toLowerCase();
        return Promise.resolve([{ id: NOTE, title: "Public", content: {}, author_name: "Ana" }]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createSharesService({ prisma, broadcaster: null });
    const note = await svc.getPublicNote("abc123");
    assert.equal(note.title, "Public");
    // Isolate the SELECT list (columns before the FROM clause).
    const selectList = capturedSql.slice(capturedSql.indexOf("select"), capturedSql.indexOf(" from "));
    assert.ok(!selectList.includes("owner_user_id"), "must not select owner_user_id");
    assert.ok(!selectList.includes("company_id"), "must not select company_id");
    assert.ok(!selectList.includes("folder_id"), "must not select folder_id");
    assert.ok(!selectList.includes("is_archived"), "must not select is_archived");
    assert.ok(!selectList.includes("is_public"), "must not select is_public");
    assert.ok(selectList.includes("notes.title") && selectList.includes("notes.content"));
  });
});

describe("ydoc-service — write guards", () => {
  it("rejects a state blob past the size ceiling", async () => {
    const svc = createYDocService({ prisma: fakePrisma([]) });
    const huge = "A".repeat(12 * 1024 * 1024); // > 8 MiB decoded and encoded
    await assert.rejects(
      () => svc.saveState(NOTE, OWNER, huge),
      (e) => e instanceof YDocServiceError && e.status === 413,
    );
  });

  it("rejects a read-only collaborator", async () => {
    const prisma = fakePrisma([
      ["from notes where id = ?::uuid and ( owner_user_id", []], // no edit access row
    ]);
    const svc = createYDocService({ prisma });
    await assert.rejects(
      () => svc.saveState(NOTE, OTHER, Buffer.from("hi").toString("base64")),
      (e) => e instanceof YDocServiceError && e.status === 403,
    );
  });
});

describe("tags-service — setNoteTags ownership", () => {
  it("rejects tag ids the acting user does not own", async () => {
    const prisma = fakePrisma([
      ["select id from notes where id = ?::uuid and deleted_at is null and ( owner_user_id", [{ id: NOTE }]],
      ["from note_tags where owner_user_id", []], // none of the requested tags are owned
    ]);
    const svc = createTagsService({ prisma });
    await assert.rejects(
      () => svc.setNoteTags(NOTE, OWNER, ["01900000-0000-7000-8000-0000000000bb"]),
      (e) => e instanceof TagsServiceError && e.status === 403,
    );
  });
});


describe('shared note notifications', () => {
  it('publishes all three channels using the shared company and note deep link', async () => {
    const published = [];
    const prisma = fakePrisma([
      ['from notes where id', [{ id: NOTE }]],
      ['from membership m_owner', [{ allowed: 1 }]],
      ['insert into note_shares', [{ id: 'share' }]],
      ['select n.title, m_target.company_id', [{ title: 'Plan', company_id: 'shared-company' }]],
    ]);
    const svc = createSharesService({ prisma, notificationService: { publish: async args => published.push(args) } });
    const result = await svc.shareNote(NOTE, OWNER, { targetUserId: OTHER, permission: 'edit' });
    assert.equal(result.id, 'share');
    assert.equal(published.length, 1);
    assert.equal(published[0].companyId, 'shared-company');
    assert.deepEqual(published[0].input.recipients.userIds, [OTHER]);
    assert.deepEqual(published[0].input.channels, ['in_app', 'email', 'web_push']);
    assert.equal(published[0].input.link, `/app/m/atlas.notes?note=${NOTE}`);
  });
  it('never publishes for a rejected share', async () => {
    const prisma = fakePrisma([['from notes where id', [{ id: NOTE }]]]);
    const svc = createSharesService({ prisma, notificationService: { publish: async () => assert.fail('must not publish') } });
    await assert.rejects(svc.shareNote(NOTE, OWNER, { targetUserId: OTHER, permission: 'edit' }), { status: 403 });
  });
});

describe("notes-service — listNotes search matches tags and folder name", () => {
  it("the q filter's SQL also checks tag names and the note's folder name", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        capturedSql = sql(strings).toLowerCase();
        return Promise.resolve([]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createNotesService({ prisma });
    await svc.listNotes({ userId: OWNER, q: "urgente" });
    // Anchor on the search clause's own aliases/predicates, not the bare
    // table names — listNotes already LEFT JOINs note_tag_assignments/
    // note_tags elsewhere (unrelated tag-enrichment for the response shape),
    // so asserting on the bare table names alone would pass even if the new
    // tag-search EXISTS block were deleted entirely.
    assert.match(capturedSql, /nta_q\.note_id/);
    assert.match(capturedSql, /nt_q\.name ilike/);
    assert.match(capturedSql, /nf_q\.name ilike/);
  });
});
