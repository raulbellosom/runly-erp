import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Button, useIsMobile } from "@runly/ui";
import { Mic, MicOff, Camera, CameraOff, MonitorUp, PhoneOff, MessageSquare, Hand } from "lucide-react";
import { GuestRoomChat } from "./GuestRoomChat";
import { useCallEphemeral } from "../hooks/useCallEphemeral";
import { CallReactionsOverlay } from "../CallReactionsOverlay";
import { CallReactionButton } from "../CallReactionButton";
import { RecordingBanner } from "../RecordingBanner";
import { ParticipantTile } from "../ParticipantTile";
import { SpotlightLayout } from "../SpotlightLayout";
import { DirectFocusLayout } from "../DirectFocusLayout";
import { spotlightStrip } from "../lib/callLayout";

function RemoteAudio({ participant }) {
  const ref = useRef(null);
  const pub = participant?.getTrackPublication?.(Track.Source.Microphone);
  const track = pub?.track;
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => track.detach(el);
  }, [track]);
  // react-doctor-disable-next-line media-has-caption no-autoplay-without-muted -- live call audio after the guest joined.
  return <audio ref={ref} autoPlay />;
}

export function GuestCallRoom({ fetchLivekitToken, messages, onSendMessage, onLeave, myName, recordingActive = false }) {
  // Below this width there's no room for a video+chat side-by-side layout,
  // so chat replaces the video view instead (matches CallRoom.jsx's own
  // mobile breakpoint for the member side).
  const isMobile = useIsMobile(1024);
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), []);
  const [, force] = useState(0);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(false);
  const [screen, setScreen] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [live, setLive] = useState([]);
  // Same local (per-viewer) spotlight pin + 1:1 swap as CallRoom.jsx — see
  // docs/superpowers/specs/2026-09-22-call-spotlight-pin-overhaul-design.md.
  const [pinnedIdentity, setPinnedIdentity] = useState(null);
  const setPinned = useCallback(
    (id) => setPinnedIdentity((cur) => (id && cur === id ? null : id || null)),
    [],
  );
  const [directSwapped, setDirectSwapped] = useState(false);
  const toggleDirectSwap = useCallback(() => setDirectSwapped((v) => !v), []);
  const refresh = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const onData = (payload, participant) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type !== "chat") return;
        setLive((p) => [...p.slice(-199), {
          body: msg.body,
          senderName: msg.senderName,
          senderKind: participant?.identity?.startsWith?.("guest_") ? "guest" : "user",
          createdAt: msg.createdAt ?? new Date().toISOString(),
        }]);
      } catch { /* ignore */ }
    };
    [
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
    ].forEach((e) => room.on(e, refresh));
    room.on(RoomEvent.DataReceived, onData);

    (async () => {
      try {
        const { livekitUrl, token } = await fetchLivekitToken();
        if (cancelled) return;
        await room.connect(livekitUrl, token);
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.startAudio().catch(() => {});
        refresh();
      } catch { /* surfaced by the parent poll (KICKED / not live) */ }
    })();

    return () => {
      cancelled = true;
      room.off(RoomEvent.DataReceived, onData);
      room.disconnect();
    };
  }, [room, fetchLivekitToken, refresh]);

  const allRemote = Array.from(room.remoteParticipants.values());
  const remote = allRemote.filter((p) => !p.identity?.startsWith("screen:"));
  const localEntry = { participant: room.localParticipant, isLocal: true };
  const remoteEntries = remote.map((participant) => ({ participant, isLocal: false }));
  const participants = [localEntry, ...remoteEntries];

  useEffect(() => {
    if (pinnedIdentity && !participants.some((p) => p.participant?.identity === pinnedIdentity)) {
      setPinnedIdentity(null);
    }
  }, [pinnedIdentity, participants]);

  const hasLiveTrack = (participant, source) => {
    const pub = participant?.getTrackPublication?.(source);
    return Boolean(pub?.track && !pub.isMuted);
  };
  const screenShareEntry =
    [...participants, ...allRemote.filter((p) => p.identity?.startsWith("screen:")).map((participant) => ({ participant, isLocal: false }))]
      .find(({ participant }) => hasLiveTrack(participant, Track.Source.ScreenShare)) ?? null;

  const screenSharerIdentity = screenShareEntry?.participant?.identity ?? null;
  const prevScreenSharerRef = useRef(null);
  useEffect(() => {
    if (screenSharerIdentity !== prevScreenSharerRef.current) {
      prevScreenSharerRef.current = screenSharerIdentity;
      if (screenSharerIdentity) setPinnedIdentity(null);
    }
  }, [screenSharerIdentity]);

  useEffect(() => {
    if (participants.length !== 2 || screenShareEntry) setDirectSwapped(false);
  }, [participants.length, screenShareEntry]);

  const useFocusLayout = participants.length === 2 && !screenShareEntry;
  const speakingIds = new Set(room.activeSpeakers.map((p) => p.identity));
  const screenShareHasCamera = Boolean(
    screenShareEntry?.participant?.getTrackPublication?.(Track.Source.Camera)?.track
      && !screenShareEntry.participant.getTrackPublication(Track.Source.Camera).isMuted,
  );
  const { mainEntry: spotlightMain, others: spotlightOthers } = spotlightStrip({
    participants,
    pinnedIdentity,
    screenShareEntry: screenShareEntry ? { ...screenShareEntry, hasCamera: screenShareHasCamera } : null,
  });

  const publishChat = useCallback((body) => {
    const echo = { type: "chat", body, senderName: myName, senderKind: "guest", createdAt: new Date().toISOString() };
    try {
      room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(echo)), { reliable: true });
    } catch { /* not connected */ }
    onSendMessage(body);
  }, [room, myName, onSendMessage]);

  const publishSignal = useCallback((obj) => {
    try {
      room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true });
    } catch { /* not connected */ }
  }, [room]);

  const ephemeral = useCallEphemeral({
    room,
    publishData: publishSignal,
    selfIdentity: room.localParticipant?.identity,
    selfName: myName || "Invitado",
    isHost: false,
  });

  async function toggleMic() {
    try { const n = !mic; await room.localParticipant.setMicrophoneEnabled(n); setMic(n); } catch { /* noop */ }
  }
  async function toggleCam() {
    try { const n = !cam; await room.localParticipant.setCameraEnabled(n); setCam(n); refresh(); } catch { /* noop */ }
  }
  async function toggleScreen() {
    try { const n = !screen; await room.localParticipant.setScreenShareEnabled(n); setScreen(n); refresh(); } catch { /* noop */ }
  }

  return (
    <div className="fixed inset-0 flex bg-slate-950 text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1 p-2 sm:p-4">
          <RecordingBanner active={recordingActive} />
          {isMobile && showChat ? (
            <GuestRoomChat polled={messages} liveIncoming={live} onSend={publishChat} myName={myName} />
          ) : spotlightMain ? (
            <SpotlightLayout
              mainEntry={spotlightMain}
              others={spotlightOthers}
              screenShareEntry={screenShareEntry}
              isMobile
              raisedHands={ephemeral.raisedHands}
              myHandRaised={ephemeral.myHandRaised}
              myLocalIdentity={room.localParticipant?.identity}
              mirrorLocalCamera
              onPin={setPinned}
              speakingIds={speakingIds}
            />
          ) : useFocusLayout ? (
            <DirectFocusLayout
              localEntry={localEntry}
              remoteEntry={remoteEntries[0]}
              raisedHands={ephemeral.raisedHands}
              myHandRaised={ephemeral.myHandRaised}
              mirrorLocalCamera
              swapped={directSwapped}
              onToggleSwap={toggleDirectSwap}
              speakingIds={speakingIds}
            />
          ) : (
            <div className={`mx-auto grid h-full max-w-5xl gap-2 ${participants.length <= 1 ? "grid-cols-1" : participants.length === 2 ? "sm:grid-cols-2" : "grid-cols-2"}`}>
              {participants.map(({ participant, isLocal }) => (
                <ParticipantTile
                  key={participant?.sid || participant?.identity}
                  participant={participant}
                  isLocal={isLocal}
                  handRaised={ephemeral.raisedHands.has(participant?.identity)}
                  onPin={participants.length > 1 ? setPinned : null}
                  mirrorLocalCamera
                  fit="contain"
                  speaking={speakingIds.has(participant?.identity)}
                />
              ))}
            </div>
          )}
          {remote.map((p) => <RemoteAudio key={`a-${p.identity}`} participant={p} />)}
          <CallReactionsOverlay reactions={ephemeral.reactions} />
        </main>
        <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-black/30 p-3">
          <Button variant={mic ? "secondary" : "destructive"} size="icon" className="h-11 w-11 rounded-full" onClick={toggleMic}>
            {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </Button>
          <Button variant={cam ? "secondary" : "destructive"} size="icon" className="h-11 w-11 rounded-full" onClick={toggleCam}>
            {cam ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
          </Button>
          <Button variant={screen ? "default" : "secondary"} size="icon" className="h-11 w-11 rounded-full" onClick={toggleScreen}>
            <MonitorUp className="h-5 w-5" />
          </Button>
          <CallReactionButton onReact={ephemeral.sendReaction} />
          <Button variant={ephemeral.myHandRaised ? "default" : "secondary"} size="icon" className="h-11 w-11 rounded-full" onClick={ephemeral.toggleHand} title={ephemeral.myHandRaised ? "Bajar la mano" : "Levantar la mano"}>
            <Hand className="h-5 w-5" />
          </Button>
          <Button variant={showChat ? "default" : "secondary"} size="icon" className="h-11 w-11 rounded-full" onClick={() => setShowChat((v) => !v)}>
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Button variant="destructive" size="icon" className="h-11 w-11 rounded-full sm:w-auto sm:px-6" onClick={onLeave}>
            <PhoneOff className="h-5 w-5 sm:mr-2" /><span className="hidden sm:inline">Salir</span>
          </Button>
        </footer>
      </div>
      {!isMobile && showChat && (
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10 bg-slate-950">
          <GuestRoomChat polled={messages} liveIncoming={live} onSend={publishChat} myName={myName} />
        </aside>
      )}
    </div>
  );
}
