import { useEffect, useRef, useState } from "react";
import { useCoarsePointer } from "@runly/ui";
import { Hand, MicOff, Pin, PinOff } from "lucide-react";
import { Track } from "livekit-client";

// A caller-requested "auto" fit means cover for camera, contain for screen
// (see the `fit` prop doc on ParticipantTile below). But a portrait phone
// camera forced to `cover` in a landscape tile crops so aggressively it reads
// as distorted — so for camera tracks specifically, "auto" is resolved at
// render time from the track's own decoded dimensions instead of a fixed
// default. See
// docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.1.
function resolveAutoFit(isPortrait) {
  return isPortrait ? "contain" : "cover";
}

function TrackRenderer({ participant, source, muted = false, mirror = false, fit = "cover" }) {
  const elementRef = useRef(null);
  const publication = participant?.getTrackPublication?.(source);
  const track = publication?.track;
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!track || !element) return undefined;
    track.attach(element);
    const checkOrientation = () => {
      if (element.videoWidth && element.videoHeight) {
        setIsPortrait(element.videoHeight > element.videoWidth);
      }
    };
    checkOrientation();
    element.addEventListener("loadedmetadata", checkOrientation);
    element.addEventListener("resize", checkOrientation);
    return () => {
      element.removeEventListener("loadedmetadata", checkOrientation);
      element.removeEventListener("resize", checkOrientation);
      track.detach(element);
    };
  }, [track]);

  if (!track || publication?.isMuted) return null;
  const effectiveFit = fit === "auto" ? resolveAutoFit(isPortrait) : fit;
  return (
    // react-doctor-disable-next-line media-has-caption -- LiveKit attaches a video-only WebRTC track; remote audio is rendered separately.
    <video
      ref={elementRef}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full ${effectiveFit === "contain" ? "object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
}

export function ParticipantTile({
  participant,
  isLocal,
  handRaised = false,
  pinned = false,
  onPin = null,
  mirrorLocalCamera = true,
  className = "",
  preferSource = "auto",
  // "auto" = contain for screen-share, cover-or-contain for camera depending
  // on its decoded orientation (see resolveAutoFit above). Pass "contain" to
  // force letterboxing regardless of orientation (used by the main spotlight
  // tile).
  fit = "auto",
  // Whether this participant is a currently active speaker (LiveKit
  // room.activeSpeakers) — shows a subtle ring, Teams/Meet-style.
  speaking = false,
}) {
  const coarse = useCoarsePointer();
  const screen = participant?.getTrackPublication?.(Track.Source.ScreenShare);
  const camera = participant?.getTrackPublication?.(Track.Source.Camera);
  const screenLive = Boolean(screen?.track && !screen.isMuted);
  const cameraLive = Boolean(camera?.track && !camera.isMuted);
  const source =
    preferSource === "screen"
      ? Track.Source.ScreenShare
      : preferSource === "camera"
        ? Track.Source.Camera
        : screenLive
          ? Track.Source.ScreenShare
          : Track.Source.Camera;
  const hasVideo =
    source === Track.Source.ScreenShare ? screenLive : cameraLive || (preferSource === "auto" && screenLive);
  const isScreen = source === Track.Source.ScreenShare;
  const name = participant?.name || (isLocal ? "Tu" : participant?.identity) || "Participante";

  return (
    // The speaking ring lives on this outer box (no overflow-hidden here) —
    // putting overflow-hidden and an outer ring/box-shadow on the SAME
    // element clips the shadow to the element's own clip region in every
    // major browser, so the emerald ring got cut off at the tile edges.
    // overflow-hidden + rounded corners move to the inner box instead.
    <div className={`group/tile h-full min-h-0 rounded-2xl transition-shadow ${speaking ? "ring-2 ring-emerald-400" : "ring-1 ring-white/10"} ${className}`}>
      <div className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-slate-900">
        {hasVideo ? (
          <TrackRenderer
            participant={participant}
            source={source}
            muted={isLocal}
            fit={fit === "contain" || isScreen ? "contain" : "auto"}
            mirror={isLocal && source === Track.Source.Camera && mirrorLocalCamera}
          />
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-500/20 text-3xl font-semibold text-violet-100 ring-1 ring-violet-400/30">
              {name.slice(0, 1).toUpperCase()}
            </div>
          </div>
        )}
        {handRaised && (
          <div className="absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 shadow-lg backdrop-blur-sm">
            <Hand className="h-5 w-5 text-amber-300" />
          </div>
        )}
        {onPin && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPin(participant?.identity); }}
            title={pinned ? "Quitar de destacado" : "Destacar"}
            className={[
              "absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white/90 shadow-lg backdrop-blur-sm transition hover:bg-black/65",
              pinned || coarse ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100",
            ].join(" ")}
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8">
          <span className="truncate text-sm font-medium text-white">
            {isLocal ? `${name} (tu)` : name}
          </span>
          {!participant?.isMicrophoneEnabled && <MicOff className="h-4 w-4 text-white/70" />}
        </div>
      </div>
    </div>
  );
}
