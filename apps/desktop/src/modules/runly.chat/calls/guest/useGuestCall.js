import { useCallback, useEffect, useRef, useState } from "react";
import { runly } from "../../../../lib/runly";
import { guestPhase } from "./lib/guestCall";

function unwrap(r) {
  return r?.data ?? r;
}

// Owns the guest session token (memory only — never localStorage) and the
// state/heartbeat poll. `token`/`code`/`inviteToken` come from the URL.
export function useGuestCall({ token = null, code = null, inviteToken = null }) {
  const [guestToken, setGuestToken] = useState(null);
  const [state, setState] = useState({ joined: false, status: null, callEnded: false, error: null, recording: { active: false } });
  const [call, setCall] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);
  const [guests, setGuests] = useState([]);
  const [messages, setMessages] = useState([]);
  const [branding, setBranding] = useState(null);
  const [joining, setJoining] = useState(false);
  const pollRef = useRef(null);
  const hbRef = useRef(null);
  const gtRef = useRef(null);

  const join = useCallback(async ({ displayName, email }) => {
    setJoining(true);
    setState((s) => ({ ...s, error: null }));
    try {
      const payload = { displayName };
      if (token) payload.token = token;
      if (code) payload.code = code;
      if (inviteToken) payload.inviteToken = inviteToken;
      if (email) payload.email = email;
      const res = unwrap(await runly.calls.guest.join(payload));
      if (res?.branding) setBranding(res.branding);
      if (res?.status === "waiting") {
        setState({ joined: true, status: "waiting", callEnded: false, error: null });
        return;
      }
      gtRef.current = res.guestToken;
      setGuestToken(res.guestToken);
      setState({ joined: true, status: res.status, callEnded: false, error: null });
      setCall({ id: res.callId });
    } catch (e) {
      setState({ joined: false, status: null, callEnded: false, error: e?.message || "No se pudo unir." });
    } finally {
      setJoining(false);
    }
  }, [token, code, inviteToken]);

  // Poll state once we hold a guest token.
  useEffect(() => {
    if (!gtRef.current) return undefined;
    async function tick() {
      try {
        const res = unwrap(await runly.calls.guest.state(gtRef.current));
        setState((s) => ({ ...s, status: res.status, callEnded: !!res.callEnded, recording: res.recording ?? { active: false } }));
        setCall(res.call);
        setLivekitUrl(res.livekitUrl ?? null);
        setGuests(res.guests ?? []);
        setMessages(res.messages ?? []);
        if (res.branding) setBranding(res.branding);
      } catch { /* transient */ }
    }
    tick();
    pollRef.current = setInterval(tick, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [guestToken]);

  // Heartbeat while we hold a token.
  useEffect(() => {
    if (!gtRef.current) return undefined;
    hbRef.current = setInterval(() => { runly.calls.guest.heartbeat(gtRef.current).catch(() => {}); }, 20000);
    return () => { if (hbRef.current) clearInterval(hbRef.current); };
  }, [guestToken]);

  const fetchLivekitToken = useCallback(async () => unwrap(await runly.calls.guest.token(gtRef.current)), []);

  const sendMessage = useCallback(async (body, metadata) => {
    const res = unwrap(await runly.calls.guest.sendMessage(gtRef.current, body, metadata));
    if (res?.message) {
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    }
  }, []);

  // Presign + read for attachments in the call chat — see
  // docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md.
  const presignAttachment = useCallback(
    async ({ fileName, mimeType, sizeBytes }) =>
      unwrap(await runly.calls.guest.presignAttachment(gtRef.current, { fileName, mimeType, sizeBytes })),
    [],
  );
  const getAttachmentUrl = useCallback(
    async (attachmentId) => unwrap(await runly.calls.guest.getAttachmentUrl(gtRef.current, attachmentId)),
    [],
  );

  const leave = useCallback(async () => {
    if (gtRef.current) await runly.calls.guest.leave(gtRef.current).catch(() => {});
    setState((s) => ({ ...s, status: "LEFT" }));
  }, []);

  return {
    phase: guestPhase(state),
    state, call, livekitUrl, guests, messages, branding, joining,
    join, fetchLivekitToken, sendMessage, leave, presignAttachment, getAttachmentUrl,
  };
}
