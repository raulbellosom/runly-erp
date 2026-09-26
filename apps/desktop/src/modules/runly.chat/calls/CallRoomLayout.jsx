import { useEffect, useRef } from "react";
import { Button } from "@runly/ui";
import {
  Camera,
  CameraOff,
  Captions,
  CaptionsOff,
  Circle,
  Flashlight,
  FlashlightOff,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  ScreenShareOff,
  StopCircle,
  SwitchCamera,
  UserPlus,
  Volume2,
} from "lucide-react";
import { Track } from "livekit-client";
import { playCallSound } from "./callSounds";
import { ParticipantTile } from "./ParticipantTile";
import { SpotlightLayout } from "./SpotlightLayout";
import { DirectFocusLayout } from "./DirectFocusLayout";
import { CallViewSwitcher } from "./CallViewSwitcher";
import { CallReactionsOverlay } from "./CallReactionsOverlay";
import { CallReactionButton } from "./CallReactionButton";
import { RaisedHandsBar } from "./RaisedHandsBar";
import { RecordingBanner } from "./RecordingBanner";
import { spotlightStrip } from "./lib/callLayout";

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function RemoteAudio({ participant }) {
  const audioRef = useRef(null);
  const publication = participant?.getTrackPublication?.(Track.Source.Microphone);
  const track = publication?.track;

  useEffect(() => {
    const element = audioRef.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => track.detach(element);
  }, [track]);

  // react-doctor-disable-next-line media-has-caption no-autoplay-without-muted -- This is live call audio after explicit acceptance; muting it would break the call.
  return <audio ref={audioRef} autoPlay />;
}

function OutgoingCallTone({ active }) {
  useEffect(() => {
    if (!active) return undefined;
    return playCallSound("ringtone", { loop: true, volume: 0.5 });
  }, [active]);

  return null;
}

export function CallRoomLayout({ view, actions, chat }) {
  const {
    session,
    connectionState,
    engineReady = true,
    elapsed,
    outgoingToneActive,
    remoteParticipants,
    remoteEntries,
    localEntry,
    participants,
    useFocusLayout,
    screenShareEntry,
    isVideoActive,
    mirrorLocalCamera,
    gridClass,
    needsAudio,
    micEnabled,
    cameraEnabled,
    canSwitchCamera,
    torchSupported,
    torchEnabled,
    screenEnabled,
    screenShareSupported,
    isDirectVideo,
    layoutMode,
    invitePanel = null,
    reactions = [],
    raisedHands = new Map(),
    myHandRaised = false,
    isHost = false,
    pinnedIdentity = null,
    myLocalIdentity = null,
    directSwapped = false,
    speakingIds = new Set(),
    canRecord = false,
    recordingActive = false,
    recordingBusy = false,
    canTranscribeTracks = false,
    trackTranscriptionActive = false,
    trackTranscriptionBusy = false,
  } = view;

  const {
    isMobile = false,
    mobileView = "video",
    onMobileViewChange = () => {},
    chatExpanded = true,
    onToggleChatExpanded = () => {},
    chatUnread = 0,
    hasScreenShare = false,
    panel: chatPanel = null,
    canShare = false,
    onShare = () => {},
    pendingLobby = 0,
    onOpenGuests = null,
  } = chat ?? {};

  const showChatColumn = !isMobile && chatExpanded;
  const showChatRail = !isMobile && !chatExpanded;
  const mobileChatOpen = isMobile && mobileView === "chat";

  // The spotlight main: a still-valid manual pin, or (with no pin) whoever is
  // screen-sharing — see resolveSpotlightMain in lib/callLayout.js. Null
  // means "no spotlight": 1:1 falls to DirectFocusLayout, everything else to
  // the classic grid. `spotlightStrip` also resolves the strip ("everyone
  // else", including the sharer's own camera tile if they have one live).
  const screenShareHasCamera = Boolean(
    screenShareEntry?.participant?.getTrackPublication?.(Track.Source.Camera)?.track
      && !screenShareEntry.participant.getTrackPublication(Track.Source.Camera).isMuted,
  );
  const { mainEntry: spotlightMain, others: spotlightOthers } = spotlightStrip({
    participants,
    pinnedIdentity,
    screenShareEntry: screenShareEntry ? { ...screenShareEntry, hasCamera: screenShareHasCamera } : null,
  });

  return (
    <div className="fixed inset-0 z-[46] flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-950 text-white">
      <OutgoingCallTone active={outgoingToneActive} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header
        className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3"
        style={{
          paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
          paddingLeft: "calc(1rem + env(safe-area-inset-left, 0px))",
          paddingRight: "calc(1rem + env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {session.call.calendarEvent?.title || session.call.initiator?.displayName || "Runly Calls"}
          </p>
          <p className="text-xs text-white/60">
            {connectionState === "connected" && outgoingToneActive ? "Llamando..." :
              connectionState === "connected" ? formatDuration(elapsed) :
                connectionState === "reconnecting" ? "Reconectando..." :
                  connectionState === "failed" ? "No se pudo conectar" : "Conectando..."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions.minimize && (
            <button
              type="button"
              onClick={actions.minimize}
              title="Minimizar llamada"
              aria-label="Minimizar llamada"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:text-white"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          )}
          {canShare && (
            <button
              type="button"
              onClick={onOpenGuests ?? onShare}
              title="Invitados"
              className="relative flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:text-white"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invitados
              {pendingLobby > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold ring-2 ring-slate-950">
                  {pendingLobby > 9 ? "9+" : pendingLobby}
                </span>
              )}
            </button>
          )}
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
            {isVideoActive ? "Videollamada" : "Llamada de voz"}
          </span>
        </div>
      </header>

      {isMobile && (
        <CallViewSwitcher
          view={mobileView}
          onChange={onMobileViewChange}
          chatUnread={chatUnread}
        />
      )}

      <main className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
        <RecordingBanner active={recordingActive} />
        {mobileChatOpen ? (
          <div className="absolute inset-0 flex flex-col bg-[hsl(var(--background))]">
            {hasScreenShare && (
              <button
                type="button"
                onClick={() => onMobileViewChange("video")}
                className="flex items-center gap-2 bg-violet-600 px-4 py-2 text-left text-xs font-medium text-white"
              >
                <MonitorUp className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">
                  {(screenShareEntry?.participant?.name) || "Alguien"} esta compartiendo pantalla
                </span>
                <span className="underline">Ver</span>
              </button>
            )}
            <div className="min-h-0 flex-1">{chatPanel}</div>
          </div>
        ) : (
          <>
        {spotlightMain ? (
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
            isMobile={isMobile}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            myLocalIdentity={myLocalIdentity}
            mirrorLocalCamera={mirrorLocalCamera}
            onPin={actions.setPinned}
            speakingIds={speakingIds}
          />
        ) : useFocusLayout ? (
          <DirectFocusLayout
            localEntry={localEntry}
            remoteEntry={remoteEntries[0]}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            mirrorLocalCamera={mirrorLocalCamera}
            swapped={isMobile ? directSwapped : false}
            onToggleSwap={isMobile ? actions.toggleDirectSwap : null}
            speakingIds={speakingIds}
          />
        ) : (
          <div className={`mx-auto grid h-full max-w-6xl gap-2 sm:gap-3 ${gridClass}`}>
            {participants.map(({ participant, isLocal }) => (
              <ParticipantTile
                key={participant.sid || participant.identity || "local-participant"}
                participant={participant}
                isLocal={isLocal}
                handRaised={raisedHands.has(participant?.identity)}
                onPin={participants.length > 1 ? actions.setPinned : null}
                mirrorLocalCamera={mirrorLocalCamera}
                fit={participants.length <= 2 ? "contain" : "auto"}
                speaking={speakingIds.has(participant?.identity)}
              />
            ))}
          </div>
        )}
          </>
        )}
        {remoteParticipants.map((participant) => (
          <RemoteAudio key={`audio-${participant.identity}`} participant={participant} />
        ))}

        {invitePanel && !mobileChatOpen && !screenShareEntry && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center p-4 sm:items-center">
            <div className="pointer-events-auto w-full max-w-sm">{invitePanel}</div>
          </div>
        )}

        <CallReactionsOverlay reactions={reactions} />
        {isHost && <RaisedHandsBar raisedHands={raisedHands} onLower={actions.lowerHand} />}
      </main>

      <footer
        className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-t border-white/10 bg-black/30 pt-3 backdrop-blur-xl"
        style={{
          paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          paddingLeft: "calc(0.75rem + env(safe-area-inset-left, 0px))",
          paddingRight: "calc(0.75rem + env(safe-area-inset-right, 0px))",
        }}
      >
        {needsAudio && (
          <Button type="button" variant="secondary" size="sm" className="basis-full sm:basis-auto" onClick={actions.activateAudio}>
            <Volume2 className="mr-2 h-4 w-4" />
            Activar audio
          </Button>
        )}
        <Button type="button" variant={micEnabled ? "secondary" : "destructive"} size="icon" disabled={!engineReady} className="h-11 w-11 rounded-full disabled:opacity-40" onClick={actions.toggleMicrophone} title={!engineReady ? "Conectando..." : micEnabled ? "Silenciar" : "Activar microfono"}>
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </Button>
        {/* Camera + screen-share are always available — a call created as voice
            can be upgraded to video mid-call (no kind gate). */}
        <Button type="button" variant={cameraEnabled ? "secondary" : "destructive"} size="icon" disabled={!engineReady} className="h-11 w-11 rounded-full disabled:opacity-40" onClick={actions.toggleCamera} title={!engineReady ? "Conectando..." : cameraEnabled ? "Apagar camara" : "Encender camara"}>
          {cameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
        </Button>
        {cameraEnabled && canSwitchCamera && (
          <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={actions.switchCamera} title="Cambiar camara">
            <SwitchCamera className="h-5 w-5" />
          </Button>
        )}
        {cameraEnabled && torchSupported && (
          <Button type="button" variant={torchEnabled ? "default" : "secondary"} size="icon" className="h-11 w-11 rounded-full" onClick={actions.toggleTorch} title={torchEnabled ? "Apagar linterna" : "Encender linterna"}>
            {torchEnabled ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
          </Button>
        )}
        <CallReactionButton onReact={actions.sendReaction} disabled={!engineReady} />
        <Button type="button" variant={myHandRaised ? "default" : "secondary"} size="icon" disabled={!engineReady} className="h-11 w-11 rounded-full disabled:opacity-40" onClick={actions.toggleHand} title={!engineReady ? "Conectando..." : myHandRaised ? "Bajar la mano" : "Levantar la mano"}>
          <Hand className="h-5 w-5" />
        </Button>
        <Button type="button" variant={screenEnabled ? "default" : "secondary"} size="icon" disabled={!engineReady} className={`h-11 w-11 rounded-full disabled:opacity-40 ${screenShareSupported ? "" : "opacity-50"}`} onClick={actions.toggleScreen} aria-disabled={!screenShareSupported} title={!engineReady ? "Conectando..." : screenShareSupported ? (screenEnabled ? "Dejar de compartir" : "Compartir pantalla") : "Compartir pantalla no disponible en este navegador"}>
          {screenShareSupported ? <MonitorUp className="h-5 w-5" /> : <ScreenShareOff className="h-5 w-5" />}
        </Button>
        {isDirectVideo && (
          <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={actions.toggleLayout} title={layoutMode === "focus" ? "Usar vista 50/50" : "Destacar al otro participante"}>
            {layoutMode === "focus" ? <LayoutGrid className="h-5 w-5" /> : <PictureInPicture2 className="h-5 w-5" />}
          </Button>
        )}
        {canRecord && (
          <Button
            type="button"
            variant={recordingActive ? "destructive" : "secondary"}
            size="icon"
            disabled={!engineReady || recordingBusy}
            className="h-11 w-11 rounded-full disabled:opacity-40"
            onClick={actions.toggleRecording}
            title={recordingActive ? "Detener grabación" : "Grabar llamada"}
          >
            {recordingActive ? <StopCircle className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          </Button>
        )}
        {canTranscribeTracks && (
          <Button
            type="button"
            variant={trackTranscriptionActive ? "destructive" : "secondary"}
            size="icon"
            disabled={!engineReady || trackTranscriptionBusy}
            className="h-11 w-11 rounded-full disabled:opacity-40"
            onClick={actions.toggleTrackTranscription}
            title={trackTranscriptionActive ? "Detener transcripción con hablantes" : "Transcribir con identificación de hablantes"}
          >
            {trackTranscriptionActive ? <CaptionsOff className="h-5 w-5" /> : <Captions className="h-5 w-5" />}
          </Button>
        )}
        <Button type="button" variant="destructive" size="icon" className="h-11 w-11 rounded-full sm:w-auto sm:px-6" onClick={actions.leave} title="Colgar">
          <PhoneOff className="h-5 w-5 sm:mr-2" />
          <span className="hidden sm:inline">Colgar</span>
        </Button>
      </footer>
      </div>

      {showChatColumn && (
        <aside className="hidden w-[380px] shrink-0 border-l border-white/10 bg-[hsl(var(--background))] lg:block">
          {chatPanel}
        </aside>
      )}

      {showChatRail && (
        <aside className="hidden w-12 shrink-0 flex-col items-center border-l border-white/10 bg-slate-950 pt-3 lg:flex">
          <button
            type="button"
            onClick={() => onToggleChatExpanded(true)}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:text-white"
            title="Mostrar chat"
          >
            <MessageSquare className="h-5 w-5" />
            {chatUnread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white ring-2 ring-slate-950">
                {chatUnread > 9 ? "9+" : chatUnread}
              </span>
            )}
          </button>
        </aside>
      )}
    </div>
  );
}
