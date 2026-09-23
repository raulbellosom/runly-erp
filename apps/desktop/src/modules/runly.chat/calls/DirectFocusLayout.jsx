import { ParticipantTile } from "./ParticipantTile";
import { DraggablePip } from "./DraggablePip";

// WhatsApp-style 1:1 layout: one big tile + one small draggable camera in a
// corner. `swapped`/`onToggleSwap` let mobile tap the small pip to invert
// who's big — desktop leaves this untouched (onToggleSwap stays null there,
// see CallRoomLayout.jsx) and keeps its own focus/50-50 toggle button.
export function DirectFocusLayout({ localEntry, remoteEntry, raisedHands, myHandRaised, mirrorLocalCamera, swapped = false, onToggleSwap = null }) {
  const mainEntry = swapped ? localEntry : remoteEntry;
  const pipEntry = swapped ? remoteEntry : localEntry;
  const mainIsLocal = swapped;
  const pipName = pipEntry.participant?.name || (pipEntry.isLocal ? "Tú" : "Participante");

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
      <DraggablePip label={pipName} initial={pipName.slice(0, 1).toUpperCase()} onTap={onToggleSwap}>
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
