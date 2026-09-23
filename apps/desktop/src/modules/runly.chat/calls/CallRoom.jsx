import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { toast } from "sonner";
import { useIsMobile, Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { useChatMessages } from "../hooks/useChatMessages";
import { playCallSound, playCallEndSound } from "./callSounds";
import { nextCallView } from "./lib/callChat";
import { CallChatPanel } from "./CallChatPanel";
import { CallShareDialog } from "./CallShareDialog";
import { CallInvitePanel } from "./CallInvitePanel";
import { MiniCallBubble } from "./MiniCallBubble";
import { useCallGuests } from "./hooks/useCallGuests";
import { useCallEphemeral } from "./hooks/useCallEphemeral";
import { useCallRecording } from "./hooks/useCallRecording";
import { CallGuestSheet } from "./CallGuestSheet";
import { CallRoomLayout } from "./CallRoomLayout";
import { useNativeScreenShare } from './useNativeScreenShare';

const UNANSWERED_CALL_TIMEOUT_MS = 36_000;
// Meet-style: a meeting room where nobody ever joined auto-closes after this,
// with a 60s "¿sigues aquí?" warning + an "extender" button that resets it.
const ALONE_LIMIT_MS = 5 * 60_000;

const CHAT_PANEL_PREF_KEY = "atlas.calls.chatPanel.collapsed";

function readChatCollapsedPref() {
  try {
    return localStorage.getItem(CHAT_PANEL_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeChatCollapsedPref(collapsed) {
  try {
    localStorage.setItem(CHAT_PANEL_PREF_KEY, collapsed ? "1" : "0");
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}

export function CallRoom({ session, onLeave, onUnanswered, isInitiator = false, minimized = false, onMinimize, onRestore, guestPanelNonce = 0 }) {
  const nativeScreen = useNativeScreenShare(session.call.id);
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), [session.callId]);
  const [renderVersion, setRenderVersion] = useState(0);
  const [connectionState, setConnectionState] = useState("connecting");
  // The RTC engine (not just signaling) — publishing tracks/data before this is
  // true throws "engine not connected within timeout".
  const [engineReady, setEngineReady] = useState(false);
  const mediaInitRef = useRef(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(session.call.kind === "VIDEO");
  const [browserScreenEnabled, setScreenEnabled] = useState(false);
  const screenEnabled = nativeScreen.supported ? nativeScreen.active : browserScreenEnabled;
  const [layoutMode, setLayoutMode] = useState("focus");
  const [cameraFacing, setCameraFacing] = useState("user");
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hasRemoteJoined, setHasRemoteJoined] = useState(false);
  // The host can dismiss the "add people" card; it stays gone for the rest of
  // this call (a new call gets a fresh CallRoom).
  const [inviteDismissed, setInviteDismissed] = useState(false);

  const conversationId = session.call.conversationId;
  const isMobile = useIsMobile(1024);
  const [mobileView, setMobileView] = useState("video");
  const [chatExpanded, setChatExpanded] = useState(() => !readChatCollapsedPref());

  const { data: chatData } = useChatMessages(conversationId);
  const chatMsgCount = chatData?.data?.length ?? 0;
  const chatActive = isMobile ? mobileView === "chat" : chatExpanded;
  const chatSeenRef = useRef(0);
  const chatLoadedRef = useRef(false);
  const [chatUnread, setChatUnread] = useState(0);

  const { userProfile } = useAuth();
  const canRecord = Boolean(userProfile?.isAdmin || userProfile?.permissions?.includes("chat.calls.record"));
  const recording = useCallRecording({ callId: session.call.id, conversationId });

  // Guest access: only the initiator polls the roster (a non-manager member
  // gets a swallowed 403); the share dialog + roster are hidden otherwise.
  const guestsApi = useCallGuests(session.call.id, { enabled: isInitiator });
  const hasGuests = guestsApi.guests.some((g) => g.status === "ADMITTED" || g.status === "LOBBY");
  const [shareOpen, setShareOpen] = useState(false);
  const [guestSheetOpen, setGuestSheetOpen] = useState(false);
  // Bumped by CallsProvider from the "Ver solicitudes" toast action — only opens
  // the sheet in place, never navigates or unmounts the room.
  useEffect(() => { if (guestPanelNonce) setGuestSheetOpen(true); }, [guestPanelNonce]);
  // Local (per-viewer) spotlight pin — not synced.
  const [pinnedIdentity, setPinnedIdentity] = useState(null);
  const setPinned = useCallback(
    (id) => setPinnedIdentity((cur) => (id && cur === id ? null : id || null)),
    [],
  );
  // 1:1 mobile-only "who's big" swap (WhatsApp-style tap on the small PiP) —
  // independent of pinnedIdentity, which drives the group/screen-share
  // spotlight instead. See DirectFocusLayout.
  const [directSwapped, setDirectSwapped] = useState(false);
  const toggleDirectSwap = useCallback(() => setDirectSwapped((v) => !v), []);
  const [liveMessages, setLiveMessages] = useState([]);
  const [aloneDeadline, setAloneDeadline] = useState(() => Date.now() + ALONE_LIMIT_MS);
  const [aloneSecondsLeft, setAloneSecondsLeft] = useState(0);

  const publishData = useCallback((obj) => {
    if (room.state !== ConnectionState.Connected) return;
    try {
      room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true });
    } catch { /* not connected yet */ }
  }, [room]);

  const refresh = useCallback(() => setRenderVersion((value) => value + 1), []);
  const screenShareSupported = nativeScreen.supported || Boolean(globalThis.navigator?.mediaDevices?.getDisplayMedia);

  // Ephemeral in-call affordances (data-channel only): floating reactions + raise-hand.
  const ephemeral = useCallEphemeral({
    room,
    publishData,
    selfIdentity: room.localParticipant?.identity,
    selfName: room.localParticipant?.name || "Tú",
    isHost: isInitiator,
  });

  const refreshCameraCapabilities = useCallback(async () => {
    const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const mediaTrack = publication?.track?.mediaStreamTrack;
    const settings = mediaTrack?.getSettings?.() ?? {};
    const capabilities = mediaTrack?.getCapabilities?.() ?? {};
    if (settings.facingMode === "user" || settings.facingMode === "environment") {
      setCameraFacing(settings.facingMode);
    }
    setTorchSupported(Boolean(capabilities.torch));
    setTorchEnabled(Boolean(settings.torch));
    try {
      const devices = await Room.getLocalDevices("videoinput", false);
      setCanSwitchCamera(devices.length > 1);
    } catch {
      setCanSwitchCamera(false);
    }
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    const events = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
    ];
    const handleReconnecting = () => setConnectionState("reconnecting");
    const handleReconnected = () => setConnectionState("connected");
    const handleDisconnected = () => {
      setConnectionState("disconnected");
      setEngineReady(false);
      playCallEndSound();
    };
    // The RTC engine (PeerConnection) — not signaling. Publishing a track or
    // data before this is Connected throws "engine not connected within
    // timeout". Every publish path is gated on `engineReady`.
    const handleConnStateChanged = (state) => {
      setEngineReady(state === ConnectionState.Connected);
      if (state === ConnectionState.Connected) setConnectionState("connected");
      else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        setConnectionState("reconnecting");
      } else if (state === ConnectionState.Connecting) setConnectionState("connecting");
    };
    const handleParticipantConnected = (participant) => {
      if (participant?.identity?.startsWith('screen:')) { refresh(); return; }
      setHasRemoteJoined(true);
      playCallSound("join");
      refresh();
    };
    const handleParticipantDisconnected = (participant) => {
      if (participant?.identity?.startsWith('screen:')) { refresh(); return; }
      playCallEndSound();
      refresh();
    };
    const handleMediaDevicesChanged = () => {
      refreshCameraCapabilities().catch(() => {});
    };
    const handleLocalTrackPublished = (publication) => {
      if (publication?.source === Track.Source.ScreenShare) setScreenEnabled(true);
      refresh();
    };
    const handleLocalTrackUnpublished = (publication) => {
      if (publication?.source === Track.Source.ScreenShare) setScreenEnabled(false);
      refresh();
    };
    const handleData = (payload, participant) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type !== "chat") return;
        setLiveMessages((prev) => [...prev.slice(-199), {
          body: msg.body,
          senderName: msg.senderName,
          senderKind: msg.senderKind
            ?? (participant?.identity?.startsWith?.("guest_") ? "guest" : "user"),
          createdAt: msg.createdAt ?? new Date().toISOString(),
        }]);
      } catch { /* not a chat data packet */ }
    };
    events.forEach((event) => room.on(event, refresh));
    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.ConnectionStateChanged, handleConnStateChanged);
    room.on(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

    async function connect() {
      try {
        await room.connect(session.livekitUrl, session.token);
        if (cancelled) return;
        if (Array.from(room.remoteParticipants.values()).some((participant) => !participant.identity?.startsWith('screen:'))) {
          setHasRemoteJoined(true);
          playCallSound("join");
        }
        // room.connect() resolves once the RTC engine is up; mirror it in case
        // ConnectionStateChanged fired before this handler was wired.
        if (room.state === ConnectionState.Connected) {
          setEngineReady(true);
          setConnectionState("connected");
        }
        await room.startAudio().catch(() => {
          if (!cancelled) setNeedsAudio(true);
        });
        if (!cancelled) refresh();
      } catch (error) {
        if (cancelled) return;
        setConnectionState("failed");
        toast.error(error?.message || "No se pudo conectar a la llamada.");
      }
    }
    connect();

    return () => {
      cancelled = true;
      // A new room object -> re-arm the one-shot media publish for it.
      mediaInitRef.current = false;
      events.forEach((event) => room.off(event, refresh));
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.ConnectionStateChanged, handleConnStateChanged);
      room.off(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      room.off(RoomEvent.DataReceived, handleData);
      room.disconnect();
    };
  }, [room, session, refresh, refreshCameraCapabilities]);

  // Publish the initial mic/camera tracks only once the RTC engine is Connected.
  // Doing this inside connect() raced the engine and surfaced as "publishing
  // rejected as engine not connected within timeout".
  useEffect(() => {
    if (!engineReady || mediaInitRef.current) return;
    mediaInitRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) setMicEnabled(true);
      } catch (error) {
        if (!cancelled) {
          setMicEnabled(false);
          toast.error(error?.message || "No se pudo activar el microfono.");
        }
      }
      if (session.call.kind === "VIDEO") {
        try {
          await room.localParticipant.setCameraEnabled(true);
          if (!cancelled) {
            setCameraEnabled(true);
            await refreshCameraCapabilities();
          }
        } catch (error) {
          if (!cancelled) {
            setCameraEnabled(false);
            toast.error(error?.message || "No se pudo activar la camara.");
          }
        }
      }
      if (!cancelled) refresh();
    })();
    return () => { cancelled = true; };
  }, [engineReady, room, session.call.kind, refresh, refreshCameraCapabilities]);

  useEffect(() => {
    const started = new Date(session.call.startedAt ?? session.call.createdAt ?? Date.now()).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session.call.createdAt, session.call.startedAt]);

  useEffect(() => {
    // A meeting-room call starts ACTIVE (host alone, guests join via link) —
    // it must not auto-hang-up while the host waits for guests.
    if (!isInitiator || hasRemoteJoined || session.call.status === "ACTIVE") return undefined;
    const createdAt = new Date(session.call.createdAt ?? Date.now()).getTime();
    const remaining = Math.max(0, UNANSWERED_CALL_TIMEOUT_MS - (Date.now() - createdAt));
    const timer = window.setTimeout(() => onUnanswered?.(), remaining);
    return () => window.clearTimeout(timer);
  }, [isInitiator, hasRemoteJoined, session.call.status, session.call.createdAt, onUnanswered]);

  // Count chat messages that arrive while the panel is not the active view.
  useEffect(() => {
    if (!chatLoadedRef.current) {
      if (chatData) {
        chatLoadedRef.current = true;
        chatSeenRef.current = chatMsgCount;
      }
      return;
    }
    if (chatActive) {
      chatSeenRef.current = chatMsgCount;
      setChatUnread(0);
      return;
    }
    if (chatMsgCount > chatSeenRef.current) {
      setChatUnread((current) => current + (chatMsgCount - chatSeenRef.current));
      chatSeenRef.current = chatMsgCount;
    }
  }, [chatMsgCount, chatActive, chatData]);

  // Block any publish action until the RTC engine is Connected — otherwise
  // LiveKit throws "engine not connected within timeout" and the toast fires on
  // every button press.
  function engineNotReady() {
    if (engineReady) return false;
    toast.info("Conectando a la llamada…", { id: "call-connecting" });
    return true;
  }

  async function toggleMicrophone() {
    if (engineNotReady()) return;
    try {
      const next = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      refresh();
    } catch (error) {
      toast.error(error?.message || "No se pudo cambiar el microfono.");
    }
  }

  async function toggleCamera() {
    if (engineNotReady()) return;
    try {
      const next = !cameraEnabled;
      await room.localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      if (next) await refreshCameraCapabilities();
      else {
        setTorchEnabled(false);
        setTorchSupported(false);
      }
      refresh();
    } catch (error) {
      toast.error(error?.message || "No se pudo cambiar la camara.");
    }
  }

  async function switchCamera() {
    try {
      const cameraTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (!cameraTrack?.restartTrack) throw new Error("No hay una camara activa.");
      const nextFacing = cameraFacing === "environment" ? "user" : "environment";
      await cameraTrack.restartTrack({ facingMode: nextFacing });
      setCameraFacing(nextFacing);
      setTorchEnabled(false);
      await refreshCameraCapabilities();
      refresh();
    } catch (error) {
      toast.error(error?.message || "No se pudo cambiar de camara.");
    }
  }

  async function toggleTorch() {
    try {
      const mediaTrack = room.localParticipant
        .getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
      if (!mediaTrack || !torchSupported) {
        toast.info("La camara activa no permite controlar la linterna.");
        return;
      }
      const next = !torchEnabled;
      await mediaTrack.applyConstraints({ advanced: [{ torch: next }] });
      setTorchEnabled(next);
    } catch (error) {
      toast.error(error?.message || "No se pudo cambiar la linterna.");
    }
  }

  async function toggleScreen() {
    if (engineNotReady()) return;
    if (nativeScreen.supported) {
      try { await nativeScreen.toggle(); }
      catch (error) { toast.error(error?.message || 'No se pudo compartir la pantalla.'); }
      return;
    }
    if (!screenShareSupported) {
      toast.info("Tu navegador no permite compartir pantalla durante una llamada. Prueba desde Chrome o Edge en una computadora.");
      return;
    }
    try {
      const next = !screenEnabled;
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenEnabled(next);
      refresh();
    } catch (error) {
      if (error?.name === "NotAllowedError") {
        toast.info("No se concedio permiso para compartir la pantalla.");
      } else {
        toast.error(error?.message || "No se pudo compartir la pantalla.");
      }
    }
  }

  function handleLeave() {
    playCallEndSound();
    onLeave();
  }

  const allRemoteParticipants = Array.from(room.remoteParticipants.values());
  const remoteParticipants = allRemoteParticipants.filter((participant) => !participant.identity?.startsWith('screen:'));
  const localEntry = { participant: room.localParticipant, isLocal: true };
  const remoteEntries = remoteParticipants.map((participant) => ({ participant, isLocal: false }));
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
  const anyRemoteHasVideo = allRemoteParticipants.some(
    (p) => hasLiveTrack(p, Track.Source.Camera) || hasLiveTrack(p, Track.Source.ScreenShare),
  );
  // A call created as AUDIO becomes a video call the moment anyone turns on a
  // camera or starts sharing — the UI must follow the tracks, not the frozen
  // session.call.kind (there is no backend endpoint to change kind mid-call).
  const isVideoActive =
    session.call.kind === "VIDEO" || cameraEnabled || screenEnabled || anyRemoteHasVideo;
  const screenShareEntry =
    [...participants, ...allRemoteParticipants.filter((participant) => participant.identity?.startsWith('screen:')).map((participant) => ({ participant, isLocal: false }))]
      .find(({ participant }) => hasLiveTrack(participant, Track.Source.ScreenShare)) ?? null;
  const hasScreenShare = Boolean(screenShareEntry);
  const isDirectVideo = isVideoActive && participants.length === 2;
  const useFocusLayout = isDirectVideo && layoutMode === "focus" && !screenShareEntry;

  // A screen share starting (or switching to a different presenter) always
  // takes the spotlight, clearing any manual pin — see resolveSpotlightMain
  // in lib/callLayout.js. Un-pinning afterwards falls back to following the
  // share again; this only fires on an actual identity change, not every
  // render.
  const screenSharerIdentity = screenShareEntry?.participant?.identity ?? null;
  const prevScreenSharerRef = useRef(null);
  useEffect(() => {
    if (screenSharerIdentity !== prevScreenSharerRef.current) {
      prevScreenSharerRef.current = screenSharerIdentity;
      if (screenSharerIdentity) setPinnedIdentity(null);
    }
  }, [screenSharerIdentity]);

  // The 1:1 mobile swap only makes sense while DirectFocusLayout is actually
  // showing (exactly 2 participants, no screen share) — reset it otherwise
  // so it doesn't resurface stale once the call returns to 1:1.
  useEffect(() => {
    if (participants.length !== 2 || screenShareEntry) setDirectSwapped(false);
  }, [participants.length, screenShareEntry]);
  const mirrorLocalCamera = cameraFacing !== "environment";
  const gridClass = participants.length === 1
    ? "grid-cols-1 grid-rows-1"
    : participants.length === 2
      ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1"
      : "grid-cols-2 auto-rows-[minmax(10rem,1fr)] overflow-y-auto";
  void renderVersion;

  const isAlone = participants.length === 1 && !hasGuests;
  // Only meeting-room calls (start ACTIVE, guest link exists) get the alone
  // auto-close — a normal call already has the 36s unanswered timeout.
  const aloneEligible = session.call.status === "ACTIVE" && isInitiator && !hasRemoteJoined && isAlone;

  useEffect(() => {
    if (hasRemoteJoined || hasGuests) setAloneDeadline(Date.now() + ALONE_LIMIT_MS);
  }, [hasRemoteJoined, hasGuests]);

  useEffect(() => {
    if (!aloneEligible) { setAloneSecondsLeft(0); return undefined; }
    const tick = () => {
      const left = aloneDeadline - Date.now();
      if (left <= 0) { handleLeave(); return; }
      setAloneSecondsLeft(left <= 60_000 ? Math.ceil(left / 1000) : 0);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [aloneEligible, aloneDeadline]); // eslint-disable-line react-hooks/exhaustive-deps

  const extendAlone = useCallback(() => {
    setAloneDeadline(Date.now() + ALONE_LIMIT_MS);
    setAloneSecondsLeft(0);
  }, []);

  useEffect(() => {
    const corrected = nextCallView(mobileView);
    if (corrected !== mobileView) setMobileView(corrected);
  }, [mobileView]);

  const handleChatClose = useCallback(() => {
    if (isMobile) {
      setMobileView("video");
    } else {
      setChatExpanded(false);
      writeChatCollapsedPref(true);
    }
  }, [isMobile]);

  const handleToggleChatExpanded = useCallback((next) => {
    setChatExpanded(next);
    writeChatCollapsedPref(!next);
  }, []);

  const chatPanelNode =
    !isMobile || mobileView === "chat"
      ? (
        <CallChatPanel
          conversationId={conversationId}
          onClose={handleChatClose}
          roomMode={hasGuests ? "call" : "conversation"}
          callId={session.call.id}
          liveIncoming={liveMessages}
          publishData={publishData}
        />
      )
      : null;

  if (minimized) {
    return (
      <MiniCallBubble
        remoteParticipants={remoteParticipants}
        localParticipant={room.localParticipant}
        elapsed={elapsed}
        micEnabled={micEnabled}
        onToggleMic={toggleMicrophone}
        onRestore={onRestore}
        onHangUp={handleLeave}
      />
    );
  }

  return (
    <>
    <CallRoomLayout
      view={{
        session,
        connectionState,
        engineReady,
        elapsed,
        outgoingToneActive: isInitiator
          && !hasRemoteJoined
          && !["failed", "disconnected"].includes(connectionState),
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
        invitePanel: isInitiator && isAlone && !inviteDismissed
          ? <CallInvitePanel conversationId={conversationId} onClose={() => setInviteDismissed(true)} />
          : null,
        reactions: ephemeral.reactions,
        raisedHands: ephemeral.raisedHands,
        myHandRaised: ephemeral.myHandRaised,
        isHost: isInitiator,
        pinnedIdentity,
        myLocalIdentity: room.localParticipant?.identity,
        directSwapped,
        canRecord,
        recordingActive: recording.active,
        recordingBusy: recording.busy,
      }}
      actions={{
        activateAudio: () => room.startAudio().then(() => setNeedsAudio(false)),
        toggleMicrophone,
        toggleCamera,
        switchCamera,
        toggleTorch,
        toggleScreen,
        toggleLayout: () => setLayoutMode((current) => current === "focus" ? "balanced" : "focus"),
        leave: handleLeave,
        minimize: onMinimize,
        sendReaction: ephemeral.sendReaction,
        toggleHand: ephemeral.toggleHand,
        lowerHand: ephemeral.lowerHand,
        setPinned,
        toggleDirectSwap,
        toggleRecording: recording.active ? recording.stop : recording.start,
      }}
      chat={{
        isMobile,
        mobileView,
        onMobileViewChange: setMobileView,
        chatExpanded,
        onToggleChatExpanded: handleToggleChatExpanded,
        chatUnread,
        hasScreenShare,
        panel: chatPanelNode,
        canShare: isInitiator,
        onShare: () => setShareOpen(true),
        pendingLobby: guestsApi.lobby.length,
        onOpenGuests: isInitiator ? () => setGuestSheetOpen(true) : null,
      }}
    />
    {isInitiator && (
      <>
        <CallShareDialog open={shareOpen} onOpenChange={setShareOpen} conversationId={conversationId} />
        <CallGuestSheet
          open={guestSheetOpen}
          onOpenChange={setGuestSheetOpen}
          guestsApi={guestsApi}
          onShare={() => { setGuestSheetOpen(false); setShareOpen(true); }}
        />
      </>
    )}
    <AloneWarningDialog
      open={aloneSecondsLeft > 0}
      seconds={aloneSecondsLeft}
      onStay={extendAlone}
      onLeave={handleLeave}
    />
    </>
  );
}

function AloneWarningDialog({ open, seconds, onStay, onLeave }) {
  return (
    // Non-modal: don't lock the call controls while the "are you there" prompt
    // is up, and any interaction outside counts as "still here".
    <Dialog open={open} modal={false} onOpenChange={(o) => { if (!o) onStay(); }}>
      <DialogContent className="sm:max-w-xs" onInteractOutside={onStay}>
        <DialogHeader><DialogTitle>¿Sigues en la reunión?</DialogTitle></DialogHeader>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Nadie más se ha unido. La reunión se cerrará en {seconds} s.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onLeave}>Salir</Button>
          <Button onClick={onStay}>Seguir aquí</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
