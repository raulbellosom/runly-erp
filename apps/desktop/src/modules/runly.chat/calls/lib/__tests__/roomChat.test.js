import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRoomMessages, groupConsecutiveBySender } from "../roomChat.js";

describe("mergeRoomMessages", () => {
  it("dedupes by id and sorts by time", () => {
    const db = [
      { id: "b", body: "2", createdAt: "2026-09-06T10:00:02Z" },
      { id: "a", body: "1", createdAt: "2026-09-06T10:00:01Z" },
    ];
    const out = mergeRoomMessages(db, [{ id: "a", body: "1", createdAt: "2026-09-06T10:00:01Z" }]);
    assert.deepEqual(out.map((m) => m.id), ["a", "b"]);
  });

  it("keeps an optimistic live message until a matching db row lands", () => {
    const live = [{ body: "hola", senderName: "Ana", createdAt: "2026-09-06T10:00:05Z" }];
    const before = mergeRoomMessages([], live);
    assert.equal(before.length, 1);
    const after = mergeRoomMessages(
      [{ id: "x", body: "hola", senderName: "Ana", createdAt: "2026-09-06T10:00:06Z" }],
      live,
    );
    assert.deepEqual(after.map((m) => m.id), ["x"]);
  });

  it("tolerates empty inputs", () => {
    assert.deepEqual(mergeRoomMessages(), []);
    assert.deepEqual(mergeRoomMessages(undefined, undefined), []);
  });
});

describe("groupConsecutiveBySender", () => {
  it("marks only the ends of a run of the same sender", () => {
    const msgs = [
      { id: "1", senderName: "Ana", senderKind: "guest" },
      { id: "2", senderName: "Ana", senderKind: "guest" },
      { id: "3", senderName: "Ana", senderKind: "guest" },
    ];
    const out = groupConsecutiveBySender(msgs);
    assert.deepEqual(out.map((m) => [m.isFirst, m.isLast]), [
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it("breaks the group on a sender-kind change even with the same name", () => {
    const msgs = [
      { id: "1", senderName: "Ana", senderKind: "guest" },
      { id: "2", senderName: "Ana", senderKind: "user" },
    ];
    const out = groupConsecutiveBySender(msgs);
    assert.deepEqual(out.map((m) => [m.isFirst, m.isLast]), [
      [true, true],
      [true, true],
    ]);
  });

  it("a lone message with different neighbors on both sides is first and last", () => {
    const msgs = [
      { id: "1", senderName: "Ana", senderKind: "guest" },
      { id: "2", senderName: "Bea", senderKind: "guest" },
      { id: "3", senderName: "Ana", senderKind: "guest" },
    ];
    const out = groupConsecutiveBySender(msgs);
    assert.deepEqual(out[1], { ...msgs[1], isFirst: true, isLast: true });
  });

  it("tolerates empty input", () => {
    assert.deepEqual(groupConsecutiveBySender(), []);
  });
});
