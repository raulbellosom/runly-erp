import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Button, SelectField, TagsField, ErrorState,
} from "@runly/ui";
import { Video, Calendar } from "lucide-react";
import { toast } from "sonner";
import EventFormModal from "../../runly.calendar/components/EventFormModal";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useChatConversations } from "../hooks/useChatConversations";
import { getConversationDisplayName } from "../lib/chatUtils";
import { useCalls } from "../calls/CallsProvider";
import { useQueryClient } from "@tanstack/react-query";
import { startMeeting } from "../lib/startMeeting.js";
import { summarizeInviteResult, describeInviteOutcome } from "../calls/lib/inviteResult";

function unwrap(r) {
  return r?.data ?? r;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEW_ROOM = "__new__";

// Meet-style: pick "ahora" or "programar".
//  - Ahora   -> opens the call room immediately; the link + email invites live
//              INSIDE the room (CallInvitePanel) while you wait alone.
//  - Programar -> collect emails + open EventFormModal; invites are sent only
//              when the event is saved ("Programar en el calendario").
export function NewMeetingDialog({ open, onOpenChange, defaultConversationId = null }) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { data } = useChatConversations();
  const { enabled: callsEnabled, isStarting, activeCall, startCall } = useCalls();
  const queryClient = useQueryClient();

  const conversations = useMemo(() => {
    const list = unwrap(data) ?? [];
    return list.filter((c) => c.type === "channel" || c.type === "group");
  }, [data]);

  const [conversationId, setConversationId] = useState(defaultConversationId ?? NEW_ROOM);
  const [mode, setMode] = useState("now"); // "now" | "schedule"
  const [emails, setEmails] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scheduled, setScheduled] = useState(null); // { targetId, link } once ready for EventFormModal
  const submittingRef = useRef(false);
  const createdRoomRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMode("now"); setEmails([]); setError(null); setScheduled(null);
    setConversationId(conversations.some((c) => c.id === defaultConversationId) ? defaultConversationId : NEW_ROOM);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = conversations.find((c) => c.id === conversationId) ?? null;
  const memberIds = (selected?.members ?? []).map((m) => m.userId).filter(Boolean);

  async function resolveTargetId() {
    if (conversationId !== NEW_ROOM) return conversationId;
    if (createdRoomRef.current) return createdRoomRef.current;
    const when = new Date().toLocaleDateString([], { day: "2-digit", month: "short" });
    const room = unwrap(await runly.chat.createChannel({ title: `Reunión ${when}`, isPublic: false }, token));
    if (!room?.id) throw new Error("No se pudo crear la sala.");
    createdRoomRef.current = room.id;
    return room.id;
  }

  async function startNow() {
    if (submittingRef.current || isStarting || activeCall) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const ok = await startMeeting({
        resolveTargetId,
        createLink: async (targetId) => {
          // Existing multi-member conversations can ring normally without
          // requiring the caller to have permission to manage guest links.
          if (targetId !== createdRoomRef.current && memberIds.length >= 2) return;
          if (targetId !== createdRoomRef.current) {
            const existing = unwrap(await runly.calls.getLink(targetId, token));
            if (existing?.link) return;
          }
          const result = unwrap(await runly.calls.createLink(targetId, token));
          if (!result?.link) throw new Error("No se pudo preparar el enlace de la reunión.");
        },
        startCall,
        discardNewRoom: async (targetId) => {
          if (createdRoomRef.current !== targetId) return;
          await runly.chat.deleteConversation(targetId, token);
          createdRoomRef.current = null;
        },
      });
      if (ok) {
        createdRoomRef.current = null;
        onOpenChange(false);
      }
    } catch (e) {
      setError(e?.message || "No se pudo iniciar la reunión.");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      setBusy(false);
      submittingRef.current = false;
    }
  }

  async function continueToSchedule() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const targetId = await resolveTargetId();
      const created = unwrap(await runly.calls.createLink(targetId, token));
      const link = created?.link ?? null;
      if (!link) throw new Error("No se pudo generar el enlace de invitados.");
      setScheduled({ targetId, link });
    } catch (e) {
      toast.error(e?.message || "No se pudo preparar la reunión.");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  // Invites go out only once the event is actually saved.
  async function sendScheduledInvites(targetId, schedule) {
    if (!emails.length) return;
    try {
      const res = unwrap(await runly.calls.sendInvites(targetId, emails, token, schedule));
      const { notice } = summarizeInviteResult(res);
      const outcome = describeInviteOutcome(res);
      if (outcome) toast.success(outcome);
      if (notice) {
        toast.message(notice.title, notice.description ? { description: notice.description } : undefined);
      }
    } catch (e) {
      toast.error(e?.message || "No se pudieron enviar las invitaciones.");
    }
  }

  if (scheduled) {
    return (
      <EventFormModal
        sourceModule="runly.chat"
        sourceEntityId={scheduled.targetId}
        initialAttendeeIds={memberIds}
        defaultVideoUrl={scheduled.link.url}
        onClose={async () => {
          // Backing out of the calendar step must not leave an orphan empty
          // room with a live, un-revoked guest join link behind.
          if (createdRoomRef.current && createdRoomRef.current === scheduled.targetId) {
            const roomId = createdRoomRef.current;
            createdRoomRef.current = null;
            await runly.chat.deleteConversation(roomId, token).catch(() => {});
          }
          setScheduled(null);
          onOpenChange(false);
        }}
        onSaved={async (savedPayload) => {
          await sendScheduledInvites(scheduled.targetId, {
            scheduledAt: savedPayload?.startAt ?? null,
            scheduledEndAt: savedPayload?.endAt ?? null,
          });
          createdRoomRef.current = null;
          toast.success(`Reunión programada. Código de invitados: ${scheduled.link.code}`);
          setScheduled(null);
          onOpenChange(false);
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent size="sm" scrollable>
        <DialogHeader><DialogTitle>Nueva reunión</DialogTitle></DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!callsEnabled ? (
          <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Las llamadas no están configuradas en esta instancia.
          </p>
        ) : (
          <div className="space-y-4">
            <SelectField
              label="Sala"
              value={conversationId}
              disabled={busy}
              onValueChange={setConversationId}
              options={[
                { value: NEW_ROOM, label: "➕ Nueva sala de reunión" },
                ...conversations.map((c) => ({
                  value: c.id,
                  label: getConversationDisplayName(c, userProfile?.id),
                })),
              ]}
            />

            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "now", label: "Ahora", hint: "Entra ya y espera a los demás", Icon: Video },
                { key: "schedule", label: "Programar", hint: "Elige fecha y hora", Icon: Calendar },
              ].map(({ key, label, hint, Icon }) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  onClick={() => setMode(key)}
                  className={[
                    "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                    mode === key
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))]">
                    <Icon className="h-4 w-4" /> {label}
                  </span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</span>
                </button>
              ))}
            </div>

            {mode === "schedule" && (
              <TagsField
                label="Invitados externos por correo (opcional)"
                placeholder="ana@empresa.com  (Enter para agregar)"
                value={emails}
                onChange={setEmails}
                type="email"
                inputMode="email"
                normalizeItem={(v) => v.trim().toLowerCase()}
                validateItem={(v) => (EMAIL_RE.test(v) ? null : "Correo no válido")}
              />
            )}

            {error && <ErrorState className="py-3" title="No se pudo iniciar la reunión" description={error} />}
            {activeCall && <p className="text-sm text-muted-foreground">Ya tienes una llamada en curso. Termínala antes de iniciar otra reunión.</p>}
            <div className="flex justify-end pt-1">
              {mode === "now" ? (
                <Button onClick={startNow} disabled={busy || isStarting || Boolean(activeCall)}>
                  <Video className="mr-2 h-4 w-4" /> {busy ? "Abriendo..." : "Iniciar reunión"}
                </Button>
              ) : (
                <Button onClick={continueToSchedule} disabled={busy}>
                  <Calendar className="mr-2 h-4 w-4" /> {busy ? "Preparando..." : "Continuar"}
                </Button>
              )}
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
