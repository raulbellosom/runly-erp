import { ParticipantTile } from "./ParticipantTile";
import { stripRowCount } from "./lib/callLayout";
import { useSpeakingOrder } from "./hooks/useSpeakingOrder";

// Teams-style spotlight: the main entry (a manual pin, or an active screen
// share when there's no pin — see resolveSpotlightMain in lib/callLayout.js)
// fills the main area, everyone else sits in a strip — vertical on the right
// on lg+, horizontal on top on narrow screens (2 rows past a tile-count
// threshold so a bigger call doesn't force one long scroll). A screen share
// that isn't the main entry becomes a strip tile.
export function SpotlightLayout({ mainEntry, others, screenShareEntry, isMobile, raisedHands, myHandRaised, myLocalIdentity, mirrorLocalCamera, onPin, speakingIds = new Set() }) {
  const mainId = mainEntry.participant?.identity;
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  const showScreenTile = Boolean(screenShareEntry) && !mainIsSharing;
  const orderedOthers = useSpeakingOrder(others, speakingIds);
  const tileCls = isMobile ? "relative aspect-video h-full shrink-0" : "relative aspect-video w-full shrink-0";
  const handFor = (id) => (id === myLocalIdentity ? myHandRaised : raisedHands.has(id));
  const stripTileCount = others.length + (showScreenTile ? 1 : 0);
  const stripRows = isMobile ? stripRowCount(stripTileCount) : 1;
  const stripContainerCls = isMobile
    ? stripRows === 2
      ? "order-first grid h-44 grid-flow-col grid-rows-2 gap-2 overflow-x-auto"
      : "order-first flex h-24 flex-row gap-2 overflow-x-auto"
    : "flex w-44 flex-col gap-2 overflow-y-auto";
  return (
    <div className={`flex h-full gap-2 ${isMobile ? "flex-col" : "flex-row"}`}>
      <div className="relative min-h-0 flex-1">
        <ParticipantTile
          participant={mainEntry.participant}
          isLocal={mainEntry.isLocal}
          handRaised={handFor(mainId)}
          preferSource={mainIsSharing ? "screen" : "auto"}
          pinned
          onPin={onPin}
          mirrorLocalCamera={mirrorLocalCamera}
          className="rounded-[1.5rem]"
          fit="contain"
          speaking={!mainIsSharing && speakingIds.has(mainId)}
        />
      </div>
      <div className={`shrink-0 ${stripContainerCls}`}>
        {showScreenTile && (
          <div className={tileCls}>
            <ParticipantTile
              participant={screenShareEntry.participant}
              isLocal={screenShareEntry.isLocal}
              preferSource="screen"
              onPin={onPin}
              className="rounded-xl bg-black"
              fit="contain"
            />
          </div>
        )}
        {orderedOthers.map(({ participant, isLocal }) => (
          <div key={participant.sid || participant.identity} className={tileCls}>
            <ParticipantTile
              participant={participant}
              isLocal={isLocal}
              handRaised={handFor(participant?.identity)}
              preferSource="camera"
              onPin={onPin}
              mirrorLocalCamera={mirrorLocalCamera}
              className="rounded-xl"
              speaking={speakingIds.has(participant?.identity)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
