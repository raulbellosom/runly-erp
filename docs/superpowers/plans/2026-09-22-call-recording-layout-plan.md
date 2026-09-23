# Plan: Recording composite layout fix

Spec: `docs/superpowers/specs/2026-09-22-call-recording-layout-design.md`

## Steps

1. **`apps/api/src/routes/calls/call-recording-service.js`** — in
   `startRecording`, pass a third argument to `startRoomCompositeEgress`:
   ```js
   info = await egressClient().startRoomCompositeEgress(
     call.livekitRoomName,
     { segments: output },
     { layout: "grid-dark" },
   );
   ```

2. **`apps/api/src/routes/calls/__tests__/call-recording-service.test.js`** —
   extend the existing "creates a STARTING row..." test with an assertion:
   `assert.equal(egress.started[0].opts.layout, "grid-dark");` (the
   `FakeEgress.startRoomCompositeEgress` fake already captures `opts` as its
   third positional arg, no fake changes needed).

3. **Verification**: `node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js`;
   `pnpm build`.

## Files touched

| File | Change |
|---|---|
| `apps/api/src/routes/calls/call-recording-service.js` | pass `{ layout: "grid-dark" }` to `startRoomCompositeEgress` |
| `apps/api/src/routes/calls/__tests__/call-recording-service.test.js` | assert the new `opts.layout` |
