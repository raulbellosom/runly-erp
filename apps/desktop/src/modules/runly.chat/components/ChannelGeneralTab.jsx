// apps/desktop/src/modules/runly.chat/components/ChannelGeneralTab.jsx
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Popover, PopoverTrigger, PopoverContent, ImageViewer, ComboboxField, Label, Textarea, SwitchField, ThemedEmojiPicker } from "@runly/ui";
import { Image as ImageIcon, Smile, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import EventFormModal from "../../runly.calendar/components/EventFormModal";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useChatConversationDetail } from "../hooks/useChatConversationDetail";
import { useChannelRoles, useUpdateChannelRole } from "../hooks/useChannelRoles";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";

// "General" tab of ConversationProfilePanel — avatar-editing UI for a channel/group
// conversation. Mirrors MessageReactionPicker.jsx's Popover + ThemedEmojiPicker
// pattern for the emoji button (but with a real PopoverTrigger, since the button
// itself is the trigger here, not opened externally) and CompanyBranding.jsx's
// uploadLogoMutation for the image button (FormData -> runly.files.upload ->
// use the returned file id). `toast` comes from "sonner" directly, matching the
// convention used by every other toast-using screen in this app (@runly/ui only
// exports the <Toaster/> container, not the `toast()` function itself).
export function ChannelGeneralTab({ conversationId, currentUserId }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const { data: convData } = useChatConversationDetail(conversationId);
  const conversation = convData?.data;
  const ownMember = findOwnMember(conversation?.members ?? [], currentUserId);
  const canManage = roleHasPermission(ownMember, CHAT_PERMISSIONS.CHANNEL_MANAGE);
  // Toggling who can post edits a role's permissions, which the backend gates on
  // roles.manage (not channel.manage) — same two default holders (Owner/Admin)
  // today, but a custom role could have one without the other, so gate on the
  // permission the mutation actually requires (same reasoning already applied
  // to ChannelRolesTab's own controls).
  const canManageRoles = roleHasPermission(ownMember, CHAT_PERMISSIONS.ROLES_MANAGE);
  const { data: rolesData } = useChannelRoles(conversationId);
  const { mutate: updateRole, isPending: isUpdatingRole } = useUpdateChannelRole(conversationId);
  // "Member" is the role every regular member gets (addMembers assigns it by
  // name, deleteRole falls back to it by name) — toggling its own
  // messages.send is the simple, one-click version of "only admins can post"
  // the user asked for, as opposed to editing permissions role-by-role in
  // Gestion de roles. Renamed/deleted-Member edge case: memberRole is
  // undefined and the switch just doesn't render, same as "still loading".
  const memberRole = (rolesData?.data ?? []).find((r) => r.name === "Member" && !r.isSystem);
  const onlyAdminsCanWrite = memberRole ? memberRole.permissions?.[CHAT_PERMISSIONS.MESSAGES_SEND] !== true : false;

  function handleToggleOnlyAdmins(nextChecked) {
    if (!memberRole) return;
    updateRole(
      { roleId: memberRole.id, data: { permissions: { ...memberRole.permissions, [CHAT_PERMISSIONS.MESSAGES_SEND]: !nextChecked } } },
      { onError: () => toast.error("No se pudo actualizar el permiso de escritura.") },
    );
  }

  const isChannel = conversation?.type === "channel";
  const projectsQuery = useQuery({
    queryKey: ["chat-channel-tab-projects", token],
    queryFn: async () => {
      // GET /projects returns a raw array, not { data: [...] } — see the
      // same note in CreateChannelModal.jsx's equivalent query.
      const res = await runly.projects.listProjects(token);
      return (res?.data ?? res ?? []).map((p) => ({ label: p.name, value: p.id }));
    },
    enabled: Boolean(isChannel && token),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (updates) => runly.chat.updateConversation(conversationId, updates, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: () => toast.error("No se pudo actualizar la imagen del canal."),
  });

  const linkMutation = useMutation({
    mutationFn: (linkedProjectId) => runly.chat.updateConversation(conversationId, {
      linkedModule: linkedProjectId ? "runly.projects" : null,
      linkedEntityId: linkedProjectId,
    }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: (err) => toast.error(err?.status === 409 ? "Ese proyecto ya tiene un canal vinculado." : "No se pudo vincular el proyecto."),
  });

  const descriptionMutation = useMutation({
    mutationFn: (description) => runly.chat.updateConversation(conversationId, { description }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      setEditingDescription(false);
    },
    onError: () => toast.error("No se pudo actualizar la descripcion."),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("moduleKey", "runly.chat");
      formData.append("entityType", "ChatConversation");
      const uploaded = await runly.files.upload(formData, token);
      return uploaded?.data?.id ?? null;
    },
    onSuccess: (fileId) => {
      if (fileId) updateMutation.mutate({ avatarFileId: fileId });
    },
    onError: () => toast.error("No se pudo subir la imagen."),
  });

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  }

  // atlas.calls guest-link access mode. The CallLink row is unique + persistent
  // per conversation, so requireLobby here IS the per-conversation default that
  // the in-call toggle also writes. getLink only needs membership; updateLink
  // needs channel.manage, so the control is gated on canManage.
  const callLinkQuery = useQuery({
    queryKey: ["chat-channel-call-link", conversationId],
    queryFn: async () => {
      const res = await runly.calls.getLink(conversationId, token);
      return res?.data?.link ?? res?.link ?? null;
    },
    enabled: Boolean(conversationId && token && canManage && conversation?.type !== "direct"),
    staleTime: 30_000,
    retry: false,
  });
  const callLink = callLinkQuery.data ?? null;
  // No link yet -> backend seeds requireLobby:true on first create, so the
  // default shown is "with approval" (switch off).
  const callAccessOpen = callLink ? !callLink.requireLobby : false;

  const callAccessMutation = useMutation({
    mutationFn: async (nextOpen) => {
      if (!callLink) {
        await runly.calls.createLink(conversationId, token);
      }
      const res = await runly.calls.updateLink(conversationId, { requireLobby: !nextOpen }, token);
      return res?.data?.link ?? res?.link ?? null;
    },
    onSuccess: (link) => {
      if (link) queryClient.setQueryData(["chat-channel-call-link", conversationId], link);
      else queryClient.invalidateQueries({ queryKey: ["chat-channel-call-link", conversationId] });
    },
    onError: () => toast.error("No se pudo cambiar el acceso a las llamadas."),
  });

  const hasAvatar = Boolean(conversation?.avatarUrl || conversation?.avatar_emoji);

  const { data: fullAvatarUrl } = useQuery({
    queryKey: ["chat-avatar-full-url", conversation?.avatar_file_id],
    queryFn: async () => {
      const res = await runly.files.getSignedUrl(conversation.avatar_file_id, token, { variant: "full" });
      return res?.data?.signedUrl ?? null;
    },
    enabled: Boolean(avatarViewerOpen && conversation?.avatar_file_id && token),
    staleTime: 50 * 60 * 1000,
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-4">
        {conversation?.avatarUrl ? (
          <button
            type="button"
            onClick={() => setAvatarViewerOpen(true)}
            title="Ver imagen del canal"
            aria-label="Ver imagen del canal"
            className="h-16 w-16 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center overflow-hidden shrink-0 hover:opacity-90 transition-opacity"
          >
            <img src={conversation.avatarUrl} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="h-16 w-16 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center overflow-hidden shrink-0">
            {conversation?.avatar_emoji ? (
              // snake_case is correct here, not a typo: getConversation/listConversations
              // rename avatar_file_id's resolved URL to camelCase avatarUrl, but pass
              // avatar_emoji straight through unaliased from `SELECT c.*` — the backend's
              // own response shape is genuinely inconsistent between these two fields.
              <span className="text-3xl">{conversation.avatar_emoji}</span>
            ) : (
              <span className="text-lg font-semibold text-[hsl(var(--muted-foreground))]">
                {(conversation?.title ?? "?")[0]?.toUpperCase()}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              disabled={!canManage}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage || uploadMutation.isPending || updateMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
              Cambiar imagen
            </Button>
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" disabled={!canManage || uploadMutation.isPending || updateMutation.isPending}>
                  <Smile className="h-3.5 w-3.5 mr-1.5" />
                  Cambiar emoji
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-auto p-0 overflow-hidden">
                <ThemedEmojiPicker
                  onEmojiClick={(emojiData) => {
                    updateMutation.mutate({ avatarEmoji: emojiData.emoji });
                    setEmojiOpen(false);
                  }}
                  width="min(300px, calc(100vw - 1.5rem))"
                  height={340}
                />
              </PopoverContent>
            </Popover>
          </div>
          {hasAvatar && canManage && (
            <button
              type="button"
              onClick={() => updateMutation.mutate({ avatarFileId: null, avatarEmoji: null })}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors self-start"
            >
              <X className="h-3 w-3" />
              Quitar imagen o emoji
            </button>
          )}
        </div>
      </div>
      {!canManage && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Solo un administrador del canal puede cambiar esta imagen.
        </p>
      )}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Descripcion</Label>
          {canManage && !editingDescription && (
            <button
              type="button"
              onClick={() => {
                setDescriptionDraft(conversation?.description ?? "");
                setEditingDescription(true);
              }}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Editar
            </button>
          )}
        </div>
        {editingDescription ? (
          <div className="space-y-1.5">
            <Textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Que trata este canal..."
              maxLength={2000}
              rows={3}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={descriptionMutation.isPending} onClick={() => descriptionMutation.mutate(descriptionDraft.trim() || null)}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" disabled={descriptionMutation.isPending} onClick={() => setEditingDescription(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))] whitespace-pre-wrap">
            {conversation?.description || "Sin descripcion."}
          </p>
        )}
      </div>
      {memberRole && canManageRoles && (
        <SwitchField
          label="Solo administradores pueden escribir"
          description="Los miembros con el rol Member no podran enviar mensajes en este canal."
          checked={onlyAdminsCanWrite}
          onChange={handleToggleOnlyAdmins}
          disabled={isUpdatingRole}
        />
      )}
      {canManage && conversation?.type !== "direct" && !callLinkQuery.isError && (
        <SwitchField
          label="Libre acceso a las llamadas"
          description="Cualquiera con el enlace o el código entra directo. Si lo desactivas, tú admites a cada persona (PIN)."
          checked={callAccessOpen}
          onChange={(next) => callAccessMutation.mutate(next)}
          disabled={callAccessMutation.isPending || callLinkQuery.isLoading}
        />
      )}
      {isChannel && (
        <div className="space-y-1.5">
          <Label>Proyecto vinculado</Label>
          <ComboboxField
            options={projectsQuery.data ?? []}
            value={conversation?.linked_module === "runly.projects" ? conversation.linked_entity_id : null}
            onChange={(projectId) => linkMutation.mutate(projectId)}
            placeholder="Buscar proyecto..."
            emptyText={projectsQuery.isLoading ? "Cargando..." : "Sin resultados"}
            disabled={!canManage || linkMutation.isPending}
          />
          {conversation?.linked_module === "runly.projects" && canManage && (
            <button
              type="button"
              onClick={() => linkMutation.mutate(null)}
              disabled={linkMutation.isPending}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors"
            >
              Quitar vinculo
            </button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={() => setScheduleOpen(true)}
          >
            Agendar reunion
          </Button>
        </div>
      )}
      {scheduleOpen && (
        <EventFormModal
          initialAttendeeIds={(conversation?.members ?? []).map((m) => m.userId)}
          sourceModule="runly.chat"
          sourceEntityId={conversationId}
          onClose={() => setScheduleOpen(false)}
          onSaved={() => {
            setScheduleOpen(false);
            queryClient.invalidateQueries({ queryKey: ["channel-events", conversationId] });
          }}
        />
      )}
      <ImageViewer
        src={fullAvatarUrl ?? conversation?.avatarUrl}
        alt={conversation?.title ?? "Canal"}
        open={avatarViewerOpen}
        onClose={() => setAvatarViewerOpen(false)}
      />
    </div>
  );
}
