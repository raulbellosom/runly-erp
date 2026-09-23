# Plan: Call spotlight/pin UX overhaul (live)

Spec: `docs/superpowers/specs/2026-09-22-call-spotlight-pin-overhaul-design.md`

## Steps

1. **`calls/lib/callLayout.js`** — extend the pure helpers:
   - `STRIP_TWO_ROW_THRESHOLD = 5` (named constant).
   - `stripRowCount(tileCount)` → `1` or `2`.
   - `resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry)` →
     pinned entry if still present, else `screenShareEntry`, else `null`.
   - Rewrite `spotlightStrip({ participants, pinnedIdentity, screenShareEntry })`
     to build on `resolveSpotlightMain` (same return shape: `{ mainEntry, others, showScreenTile }`).
   - Keep `resolvePinnedEntry` (still used for the "did my pin survive" check).
   - Extend `calls/lib/__tests__/callLayout.test.js`: `resolveSpotlightMain`
     (pin wins over share, share wins when no pin, null when neither),
     `stripRowCount` (4→1, 5→2).

2. **`calls/lib/callChat.js`** — drop `"screen"` from `CALL_VIEWS` (→
   `["video", "chat"]`), delete `shouldShowScreenSegment` (no longer called
   anywhere after step 6), simplify `nextCallView` (no screen-collapse case
   needed once "screen" isn't a valid view). Update
   `calls/lib/__tests__/callChat.test.js` accordingly.

3. **`calls/DraggablePip.jsx`** — add an optional `onTap` prop. On the
   expanded (non-collapsed) root `<div>`, change `onPointerUp={endDrag}` to
   `onPointerUp={(e) => { if (!wasDrag()) onTap?.(); endDrag(e); }}`. No
   change to the collapse button (already stops propagation).

4. **`calls/ParticipantTile.jsx`** (new file) — move `TrackRenderer` and
   `ParticipantTile` out of `CallRoomLayout.jsx` verbatim; export
   `ParticipantTile`. `CallRoomLayout.jsx` imports it.

5. **`calls/SpotlightLayout.jsx`** (new file) — move the existing
   `SpotlightLayout` function out of `CallRoomLayout.jsx`. Update its strip
   container to use `stripRowCount(tileCount)`: on mobile, `flex-row overflow-x-auto`
   when 1 row, `grid grid-flow-col grid-rows-2 overflow-x-auto` when 2 rows
   (tile count = `others.length + (showScreenTile ? 1 : 0)`). Desktop strip
   unchanged (`w-44 flex-col overflow-y-auto`). Imports `ParticipantTile` from
   step 4.

6. **`calls/DirectFocusLayout.jsx`** (new file) — extract the current
   `useFocusLayout` JSX block (remote big + local `DraggablePip`) from
   `CallRoomLayout.jsx` into a component:
   ```jsx
   export function DirectFocusLayout({ localEntry, remoteEntry, raisedHands, myHandRaised, mirrorLocalCamera, swapped = false, onToggleSwap = null }) {
     const mainEntry = swapped ? localEntry : remoteEntry;
     const pipEntry = swapped ? remoteEntry : localEntry;
     const mainIsLocal = swapped;
     return (
       <div className="relative mx-auto h-full max-w-6xl">
         <ParticipantTile
           participant={mainEntry.participant}
           isLocal={mainIsLocal}
           handRaised={mainIsLocal ? myHandRaised : raisedHands.has(remoteEntry.participant?.identity)}
           mirrorLocalCamera={mirrorLocalCamera}
           className="rounded-[1.5rem]"
           fit="contain"
         />
         <DraggablePip
           label={pipEntry.participant?.name || (pipEntry.isLocal ? "Tú" : "Participante")}
           initial={(pipEntry.participant?.name || (pipEntry.isLocal ? "T" : pipEntry.participant?.identity) || "?").slice(0, 1).toUpperCase()}
           onTap={onToggleSwap}
         >
           <ParticipantTile
             participant={pipEntry.participant}
             isLocal={pipEntry.isLocal}
             handRaised={pipEntry.isLocal ? myHandRaised : raisedHands.has(pipEntry.participant?.identity)}
             mirrorLocalCamera={mirrorLocalCamera}
             className="rounded-2xl"
           />
         </DraggablePip>
       </div>
     );
   }
   ```
   `onToggleSwap` is only passed truthy by the caller when `isMobile` (desktop
   keeps its existing `layoutMode` button untouched and never swaps).

7. **`CallRoomLayout.jsx`** — rewire `<main>`'s branching:
   - Remove the inlined `ParticipantTile`/`SpotlightLayout` definitions
     (now imported).
   - Remove the old "no pin, screen share" floating-pip branch entirely
     (the `cameraPips`/`DraggablePip` block for screen-share mode).
   - New branch order:
     ```
     effectiveMain = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry)
     effectiveMain
       ? <SpotlightLayout mainEntry={effectiveMain} others={...} screenShareEntry={screenShareEntry} ... />
       : useFocusLayout   // i.e. 2 participants, no share
         ? <DirectFocusLayout localEntry={localEntry} remoteEntry={remoteEntries[0]} swapped={directSwapped} onToggleSwap={isMobile ? actions.toggleDirectSwap : null} ... />
         : <grid classic /* unchanged */>
     ```
   - `others` for `SpotlightLayout` = `participants.filter(p => p.participant?.identity !== effectiveMain.participant?.identity)`.
   - Drop the `mobileView === "screen"` special case entirely (view prop no
     longer has a "screen" mode after step 2); `mobileChatOpen`'s own
     "alguien está compartiendo, ver" banner button in the chat view stays
     (still useful — jumps back to the merged video view, unrelated to the
     removed tab).
   - Remove the `hasScreenShare` prop passed into `CallViewSwitcher` screen
     segment (switcher itself changes in step 9).

8. **`CallRoom.jsx`**:
   - Add `const [directSwapped, setDirectSwapped] = useState(false);` and
     `const toggleDirectSwap = useCallback(() => setDirectSwapped(v => !v), []);`.
   - Reset effect: `useEffect(() => { if (participants.length !== 2 || screenShareEntry) setDirectSwapped(false); }, [participants.length, screenShareEntry]);`
   - Auto-clear pin on new/changed screen-sharer:
     ```js
     const screenSharerIdRef = useRef(null);
     useEffect(() => {
       const id = screenShareEntry?.participant?.identity ?? null;
       if (id !== screenSharerIdRef.current) {
         screenSharerIdRef.current = id;
         if (id) setPinnedIdentity(null); // a share just started/switched — let it take the spotlight
       }
     }, [screenShareEntry]);
     ```
   - Pass `directSwapped` into `view`, `toggleDirectSwap` into `actions`.

9. **`CallViewSwitcher.jsx`** — drop the `"screen"` tab and `hasScreenShare`
   prop; `TABS` becomes just `video`/`chat`.

10. **`GuestCallRoom.jsx`** — replace the internal `Tile` component and flat
    grid with the shared pieces:
    - Local state: `pinnedIdentity`/`setPinned` (same toggle logic as
      `CallRoom.jsx`), `directSwapped`/`toggleDirectSwap`, and the same
      screen-sharer-change auto-clear effect.
    - Compute `participants`, `screenShareEntry` the same way `CallRoom.jsx`
      does (local + remote entries, `screen:`-prefixed identities filtered
      into `screenShareEntry` same as today's `Tile`'s own screen detection,
      generalized).
    - Render: `resolveSpotlightMain(...)` → `SpotlightLayout` branch, else
      2-participant → `DirectFocusLayout` (swap enabled — guests are always
      on a phone-first flow, so always allow tap-swap here, no desktop
      special-case needed since guests don't get the `layoutMode` button
      today either), else classic grid (unchanged `tiles.map` block, now
      using `ParticipantTile` instead of the local `Tile`).
    - `RemoteAudio` stays as-is (already generic).

11. **Verification**: `pnpm build`; `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/`;
    manual QA per spec §26 (1:1 swap on mobile viewport, group pin, share
    auto-spotlight + override + un-pin, strip row threshold at 4 vs 5, guest
    room parity, switcher only shows Video/Chat).

## Files touched

| File | Change |
|---|---|
| `calls/lib/callLayout.js` | new `resolveSpotlightMain`, `stripRowCount`, `STRIP_TWO_ROW_THRESHOLD`; `spotlightStrip` rebuilt on top |
| `calls/lib/__tests__/callLayout.test.js` | new tests for the above |
| `calls/lib/callChat.js` | drop `"screen"` view + `shouldShowScreenSegment` |
| `calls/lib/__tests__/callChat.test.js` | updated |
| `calls/DraggablePip.jsx` | `onTap` prop |
| `calls/ParticipantTile.jsx` | **new** — extracted from `CallRoomLayout.jsx` |
| `calls/SpotlightLayout.jsx` | **new** — extracted + row-aware strip |
| `calls/DirectFocusLayout.jsx` | **new** — extracted + swap support |
| `calls/CallRoomLayout.jsx` | rewired branching, removed floating-pip screen-share mode |
| `calls/CallRoom.jsx` | `directSwapped` state + auto-clear-pin-on-share effect |
| `calls/CallViewSwitcher.jsx` | drop "Pantalla" tab |
| `calls/guest/GuestCallRoom.jsx` | adopt shared components + pin/swap state |
