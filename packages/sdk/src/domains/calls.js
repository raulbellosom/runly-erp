export function createCallsDomain(request, withAuthHeaders) {
  const action = (callId, name, token) =>
    request(`/calls/${encodeURIComponent(callId)}/${name}`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({}),
    });

  const json = (path, method, body, token) =>
    request(path, {
      method,
      headers: withAuthHeaders(token),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // Guest calls carry ONLY the guest session token (never the user's JWT).
  const guestHeaders = (guestToken) => (guestToken ? { Authorization: `Bearer ${guestToken}` } : {});
  const guestJson = (path, method, body, guestToken) =>
    request(path, {
      method,
      headers: guestHeaders(guestToken),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  return {
    getConfig: (token) => request("/calls/config", { headers: withAuthHeaders(token) }),
    getCurrent: (token) => request("/calls/current", { headers: withAuthHeaders(token) }),
    create: (data, token) => json("/calls", "POST", data, token),
    get: (callId, token) =>
      request(`/calls/${encodeURIComponent(callId)}`, { headers: withAuthHeaders(token) }),
    join: (callId, token) => action(callId, "join", token),
    screenToken: (callId, token) => action(callId, 'screen-token', token),
    decline: (callId, token) => action(callId, "decline", token),
    leave: (callId, token) => action(callId, "leave", token),
    end: (callId, token) => action(callId, "end", token),

    // --- guest link (by conversation) ---
    getLink: (conversationId, token) =>
      request(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, { headers: withAuthHeaders(token) }),
    createLink: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "POST", {}, token),
    updateLink: (conversationId, patch, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "PATCH", patch, token),
    revokeLink: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link`, "DELETE", undefined, token),
    // `schedule` — optional `{ scheduledAt, scheduledEndAt }` for a meeting
    // booked ahead of time; omit for an instant "join now" call invite.
    sendInvites: (conversationId, emails, token, schedule) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/link/invites`, "POST", schedule ? { emails, ...schedule } : { emails }, token),

    // --- guest moderation (by call) ---
    listGuests: (callId, token) =>
      request(`/calls/${encodeURIComponent(callId)}/guests`, { headers: withAuthHeaders(token) }),
    admitGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/admit`, "POST", {}, token),
    denyGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/deny`, "POST", {}, token),
    kickGuest: (callId, guestId, token) => json(`/calls/${callId}/guests/${guestId}/kick`, "POST", {}, token),
    muteGuest: (callId, guestId, muted, token) => json(`/calls/${callId}/guests/${guestId}/mute`, "POST", { muted }, token),
    startRecording: (callId, token) => json(`/calls/${callId}/recording/start`, "POST", {}, token),
    stopRecording: (callId, token) => json(`/calls/${callId}/recording/stop`, "POST", {}, token),
    listRecordings: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/recordings`, "GET", undefined, token),
    renameRecording: (recordingId, title, token) =>
      json(`/calls/recordings/${encodeURIComponent(recordingId)}`, "PATCH", { title }, token),
    deleteRecording: (recordingId, token) =>
      json(`/calls/recordings/${encodeURIComponent(recordingId)}`, "DELETE", undefined, token),

    // --- transcripts (V1 — audio mezclado de una grabación existente) ---
    requestTranscript: (callId, token) => json(`/calls/${callId}/transcript/request`, "POST", {}, token),
    // --- transcripts (V2 — captura por pista, identificación de hablantes) ---
    startTrackTranscription: (callId, token) => json(`/calls/${callId}/transcript-tracks/start`, "POST", {}, token),
    stopTrackTranscription: (callId, token) => json(`/calls/${callId}/transcript-tracks/stop`, "POST", {}, token),
    retryTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/retry`, "POST", {}, token),
    regenerateTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/regenerate`, "POST", {}, token),
    listTranscripts: (conversationId, token) =>
      json(`/calls/conversations/${encodeURIComponent(conversationId)}/transcripts`, "GET", undefined, token),
    getTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}`, "GET", undefined, token),
    deleteTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}`, "DELETE", undefined, token),
    analyzeTranscript: (transcriptId, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/analyze`, "POST", {}, token),
    commitTranscriptProposals: (transcriptId, body, token) =>
      json(`/calls/transcripts/${encodeURIComponent(transcriptId)}/commit-proposals`, "POST", body, token),

    // --- guest (unauthenticated) ---
    guest: {
      join: (payload) => guestJson("/calls/guest/join", "POST", payload),
      state: (guestToken) => guestJson("/calls/guest/state", "GET", undefined, guestToken),
      token: (guestToken) => guestJson("/calls/guest/token", "POST", {}, guestToken),
      heartbeat: (guestToken) => guestJson("/calls/guest/heartbeat", "POST", {}, guestToken),
      leave: (guestToken) => guestJson("/calls/guest/leave", "POST", {}, guestToken),
      sendMessage: (guestToken, body, metadata) =>
        guestJson("/calls/guest/messages", "POST", metadata ? { body, metadata } : { body }, guestToken),
      presignAttachment: (guestToken, payload) =>
        guestJson("/calls/guest/attachments/presign", "POST", payload, guestToken),
      getAttachmentUrl: (guestToken, attachmentId) =>
        guestJson(`/calls/guest/attachments/${encodeURIComponent(attachmentId)}/url`, "GET", undefined, guestToken),
    },
  };
}
