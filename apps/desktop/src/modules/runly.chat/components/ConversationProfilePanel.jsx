// apps/desktop/src/modules/runly.chat/components/ConversationProfilePanel.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, FolderOpen, Users, Bell, Settings, Shield, AlertTriangle, CalendarDays, Mail, Phone, Video, ChevronDown } from "lucide-react";
import {
  Button, Tabs, TabsList, TabsTrigger, TabsContent,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@runly/ui";
import { AdvancedFileViewer } from "@runly/ui";
import { ChannelGeneralTab } from "./ChannelGeneralTab";
import { ChannelMembersTab } from "./ChannelMembersTab";
import { ChannelRolesTab } from "./ChannelRolesTab";
import { ChannelDangerZoneTab } from "./ChannelDangerZoneTab";
import { ConversationInfoTab } from "./ConversationInfoTab";
import { ConversationMediaTab } from "./ConversationMediaTab";
import { ChannelEventsTab } from "./ChannelEventsTab";
import { GroupsInCommonTab } from "./GroupsInCommonTab";
import { NotificationsTab } from "./NotificationsTab";
import { useChatConversationDetail } from "../hooks/useChatConversationDetail";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";
import { getConversationDisplayName } from "../lib/chatUtils";
import { useGlobalPresence } from "../../../providers/RealtimeProvider";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

function SectionHeader({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
    </div>
  );
}

function ProfileCallActions({ disabled, onStartAudioCall, onStartVideoCall }) {
  const actions = [
    {
      label: "Llamada",
      description: "Solo audio",
      icon: Phone,
      onClick: onStartAudioCall,
    },
    {
      label: "Videollamada",
      description: "Audio y video",
      icon: Video,
      onClick: onStartVideoCall,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 px-4 pb-4">
      {actions.map(({ label, description, icon: Icon, onClick }) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          onClick={onClick}
          disabled={disabled}
          aria-label={`Iniciar ${label.toLowerCase()}`}
          aria-busy={disabled || undefined}
          className="h-auto min-h-[72px] flex-col gap-1.5 rounded-xl border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-3 text-center shadow-sm hover:border-[hsl(var(--primary)/0.45)] hover:bg-[hsl(var(--primary)/0.06)]"
        >
          <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-xs font-semibold leading-none">{label}</span>
          <span className="text-[10px] font-normal leading-none text-[hsl(var(--muted-foreground))]">
            {disabled ? "Conectando..." : description}
          </span>
        </Button>
      ))}
    </div>
  );
}

// Replaces ChatMembersPanel — same swap-into-content-slot contract (root
// carries flex-1/min-h-0/flex-col/overflow-hidden so it fills ChatWindow's
// or MiniChatWindow's content area identically to the message list it
// replaces), but now handles every conversation type, not just group/
// channel. `type === "direct"` still renders a flat scrollable column of
// stacked sections (data-section-anchored); group/channel renders two tabs
// (Informacion / Miembros y roles) instead — section set is type-dependent
// per spec Section 8.
//
// `initialTab` lets a caller open straight to a specific section on mount.
// For "direct" it scrolls a `data-section` into view. For group/channel the
// only value any caller passes is "members" (MemberAvatarStack, "Ver
// miembros" menu item in ChatWindow.jsx), used to pick the Tabs
// `defaultValue`. Either way the CALLER must remount this component when
// initialTab changes (e.g. `<ConversationProfilePanel key={initialTab} .../>`),
// since neither the scroll effect nor an uncontrolled Tabs re-derives after mount.
//
// `onBack` renders an explicit "back to messages" row above the sections —
// this was the other half of the user's complaint: the only way back used
// to be remembering that the same header icon that opened the panel also
// closes it, which wasn't discoverable.
//
// `onOpenConversation(conv)` is how a clicked member's row (group/channel
// "Miembros y roles" tab) opens a DM — each host decides what that means
// (ChatWindow navigates the route, MiniChatWindow opens another float window).
//
// `messages`/`isLoadingMessages` come from the caller's own already-mounted
// useChatMessages(conversationId) call — never call that hook a second time
// here, it would open a second Supabase Realtime subscription for the same
// conversation and silently kill the caller's own live updates.
export function ConversationProfilePanel({
  conversation,
  currentUserId,
  initialTab,
  onBack,
  messages,
  isLoadingMessages,
  onShowAllFiles,
  onOpenConversation,
  onDeleted,
  callsEnabled,
  callPending,
  onStartAudioCall,
  onStartVideoCall,
}) {
  const conversationId = conversation?.id;
  const type = conversation?.type;
  const { data: convData } = useChatConversationDetail(conversationId);
  const detail = convData?.data ?? conversation;
  // is_muted only ever comes from `conversation` (the listConversations row) —
  // getConversation's own `SELECT c.*` never joins the per-member muted_at the
  // way listConversations does, so `detail.is_muted` is always undefined here.
  const isMuted = Boolean(conversation?.is_muted);

  const { isUserOnline, getLastSeen } = useGlobalPresence();
  const displayName = getConversationDisplayName(conversation, currentUserId);
  const otherMemberForHero = type === "direct"
    ? (detail?.members ?? conversation?.members ?? []).find((m) => m.userId !== currentUserId)
    : null;
  const heroAvatarUrl = conversation?.avatarUrl ?? otherMemberForHero?.avatarUrl ?? null;
  const heroAvatarFileId = conversation?.avatar_file_id ?? otherMemberForHero?.avatarFileId ?? null;
  const heroAvatarEmoji = conversation?.avatar_emoji ?? null;
  const memberCount = (detail?.members ?? conversation?.members ?? []).length;
  let statusLine;
  if (type === "direct") {
    const online = otherMemberForHero ? isUserOnline(otherMemberForHero.userId) : false;
    const lastSeen = otherMemberForHero ? getLastSeen(otherMemberForHero.userId) : null;
    statusLine = online
      ? "En linea"
      : lastSeen
        ? `Visto ${lastSeen.toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
        : "Desconectado";
  } else {
    statusLine = `${memberCount} ${memberCount === 1 ? "miembro" : "miembros"}`;
  }
  const [avatarErr, setAvatarErr] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const description = detail?.description ?? conversation?.description ?? null;

  const { session } = useAuth();

  // Resolve a signed avatar URL at a given variant. Direct chats go through
  // the chat-specific member-avatar endpoint — the generic files endpoint
  // (runly.files.getSignedUrl) 404s on identity avatar files, and the identity
  // endpoint needs a permission chat users lack. Group/channel avatars are
  // real company files, so those still resolve through runly.files.
  const resolveAvatarSignedUrl = useCallback(
    async (variant) => {
      const token = session?.access_token;
      if (!token) return null;
      if (type === "direct") {
        if (!conversationId || !otherMemberForHero?.userId) return null;
        const res = await runly.chat.getMemberAvatarSignedUrl(
          conversationId,
          otherMemberForHero.userId,
          token,
          { variant },
        );
        return res?.data?.signedUrl ?? null;
      }
      if (!heroAvatarFileId) return null;
      const res = await runly.files.getSignedUrl(heroAvatarFileId, token, { variant });
      return res?.data?.signedUrl ?? null;
    },
    [type, conversationId, otherMemberForHero?.userId, heroAvatarFileId, session?.access_token],
  );

  // The hero circle would otherwise render the 40px `thumb` variant that
  // batchSignAvatarUrls embeds into member/conversation rows — upgrade it to
  // `card` (96px) so the 80px circle is crisp, matching ProfileScreen.
  const { data: heroCrispUrl } = useQuery({
    queryKey: ["chat-hero-avatar-card", type, conversationId, heroAvatarFileId, otherMemberForHero?.userId],
    queryFn: () => resolveAvatarSignedUrl("card"),
    enabled: Boolean(heroAvatarUrl && !avatarErr && session?.access_token),
    staleTime: 50 * 60 * 1000,
  });

  // Stable identity so AdvancedFileViewer's fetch effect doesn't re-run on
  // every parent render while the viewer is open.
  const resolveFullAvatarUrl = useCallback(() => resolveAvatarSignedUrl("full"), [resolveAvatarSignedUrl]);

  const scrollRef = useRef(null);

  useEffect(() => {
    if (!initialTab || !scrollRef.current) return;
    const target = scrollRef.current.querySelector(`[data-section="${initialTab}"]`);
    target?.scrollIntoView({ block: "start" });
  }, [initialTab]);

  const backHeader = (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-[hsl(var(--border))] shrink-0">
      <button
        type="button"
        onClick={onBack}
        title="Volver a mensajes"
        className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors touch-manipulation"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <p className="text-sm font-semibold">Perfil</p>
    </div>
  );

  const hero = (
    <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
      {heroAvatarUrl && !avatarErr ? (
        <button
          type="button"
          onClick={() => setAvatarViewerOpen(true)}
          title="Ver foto de perfil"
          aria-label="Ver foto de perfil"
          className="h-20 w-20 rounded-full overflow-hidden bg-[hsl(var(--muted))] flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <img
            src={heroCrispUrl ?? heroAvatarUrl}
            alt={displayName}
            className="h-full w-full object-cover"
            onError={() => setAvatarErr(true)}
          />
        </button>
      ) : (
        <div className="h-20 w-20 rounded-full overflow-hidden bg-[hsl(var(--muted))] flex items-center justify-center">
          {heroAvatarEmoji ? (
            <span className="text-4xl">{heroAvatarEmoji}</span>
          ) : (
            <span className="text-2xl font-semibold text-[hsl(var(--muted-foreground))]">
              {(displayName ?? "?")[0]?.toUpperCase()}
            </span>
          )}
        </div>
      )}
      <p className="chat-font-display text-lg font-bold truncate max-w-full">{displayName}</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{statusLine}</p>
      {type !== "direct" && description && (
        <div className="w-full max-w-full">
          <p className={["text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap", descExpanded ? "" : "line-clamp-2"].join(" ")}>
            {description}
          </p>
          {description.length > 80 && (
            <button
              type="button"
              onClick={() => setDescExpanded((v) => !v)}
              className="mx-auto mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-[hsl(var(--primary))] hover:underline"
            >
              {descExpanded ? "Ver menos" : "Ver mas"}
              <ChevronDown className={["h-3 w-3 transition-transform", descExpanded ? "rotate-180" : ""].join(" ")} />
            </button>
          )}
        </div>
      )}
    </div>
  );

  // Same viewer used for every other avatar in the app (ProfileScreen,
  // UserEditorScreen) and for chat image attachments — not a bespoke modal.
  const avatarViewer = heroAvatarUrl ? (
    <AdvancedFileViewer
      open={avatarViewerOpen}
      onOpenChange={setAvatarViewerOpen}
      files={[
        {
          id: heroAvatarFileId ?? "avatar",
          mimeType: "image/jpeg",
          originalName: displayName ?? "Foto de perfil",
          sizeBytes: 0,
        },
      ]}
      activeIndex={0}
      onIndexChange={() => {}}
      onResolveSignedUrl={resolveFullAvatarUrl}
      zIndex={10000}
    />
  ) : null;

  const hasContactInfo = Boolean(otherMemberForHero?.email || otherMemberForHero?.phone || otherMemberForHero?.bio);

  if (type === "direct") {
    return (
      <>
        {backHeader}
        {hero}
        {callsEnabled && (
          <ProfileCallActions
            disabled={callPending}
            onStartAudioCall={onStartAudioCall}
            onStartVideoCall={onStartVideoCall}
          />
        )}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {hasContactInfo && (
            <div data-section="contact-info">
              <SectionHeader icon={Info} label="Informacion" />
              <div className="px-4 pb-3 space-y-2.5">
                {otherMemberForHero.bio && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{otherMemberForHero.bio}</p>
                )}
                {otherMemberForHero.email && (
                  <a
                    href={`mailto:${otherMemberForHero.email}`}
                    className="flex items-center gap-2.5 text-sm hover:text-[hsl(var(--primary))] transition-colors"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    <span className="truncate">{otherMemberForHero.email}</span>
                  </a>
                )}
                {otherMemberForHero.phone && (
                  <a
                    href={`tel:${otherMemberForHero.phone}`}
                    className="flex items-center gap-2.5 text-sm hover:text-[hsl(var(--primary))] transition-colors"
                  >
                    <Phone className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    <span className="truncate">{otherMemberForHero.phone}</span>
                  </a>
                )}
              </div>
            </div>
          )}
          <div data-section="media">
            <SectionHeader icon={FolderOpen} label="Multimedia" />
            <ConversationMediaTab conversationId={conversationId} messages={messages} isLoading={isLoadingMessages} preview onShowAll={onShowAllFiles} />
          </div>
          <div data-section="common">
            <SectionHeader icon={Users} label="En comun" />
            <GroupsInCommonTab otherUserId={otherMemberForHero?.userId} />
          </div>
          <div data-section="notifications">
            <SectionHeader icon={Bell} label="Notificaciones" />
            <NotificationsTab conversationId={conversationId} isMuted={isMuted} />
          </div>
          <div data-section="info">
            <SectionHeader icon={Info} label="Zona de peligro" />
            <ConversationInfoTab
              conversationId={conversationId}
              otherUserId={otherMemberForHero?.userId}
              otherDisplayName={otherMemberForHero?.displayName}
            />
          </div>
        </div>
        {avatarViewer}
      </>
    );
  }

  // group / channel — two tabs (Informacion / Miembros y roles) instead of a
  // flat scroll: this is what actually moves Eventos up out of the bottom
  // half of the panel and gives Roles a dedicated, collapsed-by-default home
  // instead of sitting in the middle of the member list. Both tabs are
  // visible to every member — only the roles-management Accordion below is
  // gated, matching the existing roleHasPermission check.
  const ownMember = findOwnMember(detail?.members ?? [], currentUserId);
  const canManageRoles = roleHasPermission(ownMember, CHAT_PERMISSIONS.ROLES_MANAGE);
  const canManageChannel = roleHasPermission(ownMember, CHAT_PERMISSIONS.CHANNEL_MANAGE);
  // The only initialTab value any caller ever passes for group/channel is
  // "members" (MemberAvatarStack, "Ver miembros" menu item in ChatWindow.jsx)
  // — used here just to pick which tab opens by default. The parent remounts
  // this whole component on initialTab change (key={profileInitialTab}), so
  // an uncontrolled Tabs defaultValue is enough; no controlled state needed.
  const defaultTab = initialTab === "members" ? "members" : "info";

  return (
    <>
      {backHeader}
      {hero}
      <Tabs defaultValue={defaultTab} className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 pb-2 shrink-0">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="info">Informacion</TabsTrigger>
            <TabsTrigger value="members">Miembros y roles</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="info" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <SectionHeader icon={Settings} label="Ajustes" />
          <ChannelGeneralTab conversationId={conversationId} currentUserId={currentUserId} />
          <SectionHeader icon={CalendarDays} label="Eventos" />
          <ChannelEventsTab conversationId={conversationId} />
          <SectionHeader icon={FolderOpen} label="Multimedia" />
          <ConversationMediaTab conversationId={conversationId} messages={messages} isLoading={isLoadingMessages} preview onShowAll={onShowAllFiles} />
          <SectionHeader icon={Bell} label="Notificaciones" />
          <NotificationsTab conversationId={conversationId} isMuted={isMuted} />
          {canManageChannel && (
            <>
              <SectionHeader icon={AlertTriangle} label="Zona de peligro" />
              <ChannelDangerZoneTab conversationId={conversationId} onDeleted={onDeleted} />
            </>
          )}
        </TabsContent>

        <TabsContent value="members" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <SectionHeader icon={Users} label="Miembros" />
          <div className="px-4 pb-3">
            <ChannelMembersTab conversationId={conversationId} currentUserId={currentUserId} onOpenConversation={onOpenConversation} />
          </div>
          {canManageRoles && (
            <div className="px-4 pb-4">
              <Accordion type="single" collapsible>
                <AccordionItem value="roles">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                      Gestion de roles
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ChannelRolesTab conversationId={conversationId} currentUserId={currentUserId} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {avatarViewer}
    </>
  );
}
