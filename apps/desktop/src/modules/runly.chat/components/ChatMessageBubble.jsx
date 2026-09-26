import { useState, useRef, useEffect } from "react";
import {
  CheckCheck, MoreHorizontal, Copy, Trash2, Forward, EyeOff, CheckSquare,
  Pin, PinOff, Smile, MessageSquare, CornerUpLeft, Sparkles, Volume2, Square, Loader2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  AssistantWordmark, renderMentionText, renderRichText, useLongPress, useSwipeToReply, useCoarsePointer, useIsMobile,
} from "@runly/ui";
import { formatMessageTime } from "../lib/chatUtils";
import { useAuth } from "../../../auth/AuthProvider";
import { roleHasPermission, findOwnMember, isMentioned, CHAT_PERMISSIONS } from "../lib/chatPermissions";
import { MessageReactions } from "./MessageReactions";
import { MessageReactionPicker } from "./MessageReactionPicker";
import { EntityReferenceCard } from "./EntityReferenceCard";
import { FileReferenceGroup } from "./FileReferenceGroup";
import { AttachmentsBlock } from "./MessageAttachments";
import { isMergeableMediaMessage } from "../lib/messageMedia";
import { MessageQuote } from "./MessageQuote";
import { CallLogCard } from "./CallLogCard";
import { getCallMeta, getRecordingMeta } from "./callLogMeta";
import { RecordingReadyCard } from "./RecordingReadyCard";
import { MessageActionSheet } from "./MessageActionSheet";
import { buildMessageActions } from "../lib/messageActions";

// Block native text selection app-wide the instant a touch lands on a message
// row (chat-suppress-select in chat-theme.css). It has to be in place BEFORE
// iOS's long-press selection timer fires (~500ms) — applying user-select:none
// afterwards or clearing the range can't abort the selection loupe / the
// "Copy · Translate" bar once they appear. Released on pointerup/cancel, with
// a safety timeout so a stolen gesture can't leave selection disabled forever.
let _selReleaseTimer = null;
function suppressNativeSelection() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add("chat-suppress-select");
  try { window.getSelection()?.removeAllRanges(); } catch { /* no-op */ }
  clearTimeout(_selReleaseTimer);
  _selReleaseTimer = setTimeout(releaseNativeSelection, 2500);
}
function releaseNativeSelection() {
  if (typeof document === "undefined") return;
  clearTimeout(_selReleaseTimer);
  document.documentElement.classList.remove("chat-suppress-select");
}

// ── Corner radius for grouped bubbles ─────────────────────────────────────────
function bubbleRadius(isOwn, isFirst, isLast) {
  const FULL = "rounded-[var(--chat-radius-bubble)]";
  if (isFirst && isLast) return FULL;
  if (isOwn) {
    if (isFirst) return `${FULL} rounded-br-[var(--chat-radius-bubble-tail)]`;
    if (isLast)  return `${FULL} rounded-tr-[var(--chat-radius-bubble-tail)]`;
    return `${FULL} rounded-r-[var(--chat-radius-bubble-tail)]`;
  } else {
    if (isFirst) return `${FULL} rounded-bl-[var(--chat-radius-bubble-tail)]`;
    if (isLast)  return `${FULL} rounded-tl-[var(--chat-radius-bubble-tail)]`;
    return `${FULL} rounded-l-[var(--chat-radius-bubble-tail)]`;
  }
}

// ── Selection checkbox ────────────────────────────────────────────────────────
function SelectionCircle({ isSelected }) {
  return (
    <div
      className={[
        "shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all duration-150 self-center",
        isSelected
          ? "bg-primary border-primary text-primary-foreground"
          : "border-[hsl(var(--foreground)/0.5)] bg-[hsl(var(--background)/0.85)]",
      ].join(" ")}
      style={!isSelected ? { boxShadow: "0 0 0 1px hsl(var(--foreground)/0.15)" } : undefined}
    >
      {isSelected && (
        <svg viewBox="0 0 10 8" className="w-3 h-2.5" fill="none">
          <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

// ── Swipe-to-reply hint ──────────────────────────────────────────────────────
// The curved-arrow badge revealed as the bubble is dragged sideways. It lives
// inside the transformed row, so it is counter-translated to stay pinned to
// the row's edge while the message content slides past it (WhatsApp-style).
const SWIPE_THRESHOLD = 56;
function SwipeReplyHint({ translateX, isOwn }) {
  if (!translateX) return null;
  const progress = Math.min(1, Math.abs(translateX) / SWIPE_THRESHOLD);
  return (
    <span
      className="absolute top-1/2 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md pointer-events-none"
      style={{
        [isOwn ? "right" : "left"]: 6,
        transform: `translateX(${-translateX}px) translateY(-50%) scale(${0.6 + 0.4 * progress})`,
        opacity: progress,
      }}
    >
      <CornerUpLeft className="h-4 w-4" style={isOwn ? { transform: "scaleX(-1)" } : undefined} />
    </span>
  );
}

// ── Message action dropdown (desktop hover) ──────────────────────────────────
// The action list itself comes from buildMessageActions() — the single source
// shared with MessageActionSheet (mobile long-press / desktop right-click).
function MessageActions({
  isOwn, hasBody, onCopy, onDelete, onHideForMe, onForward, onEnterSelection,
  canPin, isPinned, onPin, onReact, canReply, onOpenThread, onReply, onAskMirai, onShowReceipt,
  onSpeak, isSpeaking, isLoadingSpeak,
}) {
  const actions = buildMessageActions({
    hasBody, isOwn, canPin, isPinned, canReply,
    onReply, onCopy, onForward, onEnterSelection, onPin, onReact, onOpenThread,
    onDelete, onHideForMe, onAskMirai, onShowReceipt, onSpeak, isSpeaking, isLoadingSpeak,
  });
  const primary = actions.filter((a) => a.group === "primary");
  const danger = actions.filter((a) => a.group === "danger");

  // On touch devices (tablets included) there is no hover, so the reveal-on
  // -hover affordances would never appear — show them permanently there.
  const coarse = useCoarsePointer();
  const revealCls = coarse
    ? "opacity-100"
    : "opacity-0 group-hover/msg:opacity-100 focus:opacity-100";

  return (
    <>
      {/* Quick-react affordance — opens the reaction picker directly (no
          dropdown detour). It isn't opened from inside another overlay's
          onSelect, so it doesn't hit the Radix close/open race the dropdown
          item does. */}
      {onReact && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onReact(); }}
          title="Reaccionar"
          aria-label="Reaccionar"
          className={`${revealCls} h-6 w-6 flex items-center justify-center rounded-full hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-opacity shrink-0 self-center touch-manipulation`}
        >
          <Smile className="h-3.5 w-3.5" />
        </button>
      )}
      {/* Quick-speak affordance — same idea as the quick-react button above:
          a dedicated icon instead of only being buried inside the "..."
          menu (user feedback: it was too hard to find in there). Still also
          listed in the dropdown (buildMessageActions) for discoverability,
          same redundancy the reaction action already has. */}
      {onSpeak && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpeak(); }}
          title={isLoadingSpeak ? "Generando audio…" : isSpeaking ? "Detener lectura" : "Leer en voz alta"}
          aria-label={isLoadingSpeak ? "Generando audio" : isSpeaking ? "Detener lectura" : "Leer en voz alta"}
          className={`${revealCls} h-6 w-6 flex items-center justify-center rounded-full hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-opacity shrink-0 self-center touch-manipulation`}
        >
          {isLoadingSpeak
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : isSpeaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${revealCls} data-[state=open]:opacity-100 h-6 w-6 flex items-center justify-center rounded-full hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-opacity shrink-0 self-center touch-manipulation`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={isOwn ? "start" : "end"}
          style={{ zIndex: 10000 }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {primary.map((a) => (
            <DropdownMenuItem
              key={a.key}
              onSelect={() => {
                // "react" opens a Radix Popover from inside this menu's
                // onSelect — defer past the menu's own close (see the
                // onCloseAutoFocus preventDefault above) so the Popover
                // isn't read as an outside interaction and dismissed.
                if (a.key === "react") requestAnimationFrame(() => a.onSelect?.());
                else a.onSelect?.();
              }}
            >
              <a.icon className={`h-3.5 w-3.5 mr-2 ${a.iconClassName ?? ""}`} />
              {a.label}
            </DropdownMenuItem>
          ))}
          {primary.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
          {danger.map((a) => (
            <DropdownMenuItem
              key={a.key}
              onSelect={() => a.onSelect?.()}
              className={a.danger ? "text-red-500 focus:text-red-500" : undefined}
            >
              <a.icon className={`h-3.5 w-3.5 mr-2 ${a.iconClassName ?? ""}`} />
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// One bubble shared by image/video attachments and their caption, WhatsApp
// style: media flush to the top (no inner rounding — the bubble's
// overflow-hidden clips it), caption directly below in the same coloured
// bubble. Rendered instead of the standalone text bubble + loose media block
// when isMergeableMediaMessage(attachments) and there is a caption.
function MediaCaptionBubble({ radiusClass, isOwn, body, searchQuery, replyTo, onJumpToMessage, attachmentsBlockProps }) {
  return (
    <div
      className={[
        radiusClass,
        // Hard width cap so a captioned image never spans the whole bubble
        // (72% of the row on a wide desktop was ~650px) — WhatsApp-style:
        // ~288px, or 72vw on a phone, with the caption wrapping to match.
        // max-w-full on top of that: 72vw is measured against the whole
        // browser viewport, not this bubble's actual parent — inside a
        // narrow container (the ~300-320px MiniChatWindow) 72vw of the FULL
        // page is still ~1000px+ on desktop, so without this the image blew
        // straight out of the floating window instead of being clamped by
        // its own row's real available width.
        "w-[min(18rem,72vw)] max-w-full overflow-hidden mt-1",
        isOwn ? "bg-(--brand-primary)" : "bg-[hsl(var(--muted))]",
      ].join(" ")}
    >
      <AttachmentsBlock {...attachmentsBlockProps} merged />
      <div className="px-3 py-2 text-sm leading-relaxed">
        {replyTo && (
          <MessageQuote reply={replyTo} variant="inline" context={isOwn ? "onBrand" : "onMuted"} onJump={onJumpToMessage} />
        )}
        {renderRichText(body, {
          highlightQuery: searchQuery,
          paragraphClassName: ["text-left whitespace-pre-wrap wrap-break-word", isOwn ? "text-(--brand-primary-foreground)" : "text-[hsl(var(--foreground))]"].join(" "),
        })}
      </div>
    </div>
  );
}

// ── Main bubble ───────────────────────────────────────────────────────────────
export function ChatMessageBubble({
  message,
  isOwn,
  onAttachmentClick,
  showReadReceipt,
  isFirst = true,
  isLast = true,
  onCopy,
  onDelete,
  onEdit,
  onHideForMe,
  onForward,
  selectionMode = false,
  isSelected = false,
  onSelect,
  onEnterSelection,
  searchQuery = "",
  isSearchMatch = false,
  isCurrentMatch = false,
  currentUserId,
  members,
  conversationType,
  isPinned = false,
  onPin,
  onToggleReaction,
  onDeleteAttachment,
  deletingAttachmentId,
  isThreadReplyView = false,
  onOpenThreadForMessage,
  onReply,
  onAskMirai,
  onJumpToMessage,
  onShowReceipt,
  onSpeak,
  isSpeaking = false,
  isLoadingSpeak = false,
}) {
  const [avatarErr, setAvatarErr] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [actionSheet, setActionSheet] = useState({ open: false, point: null, el: null, rect: null, attachment: null });
  const lastTapRef = useRef(0);
  // Set the instant a long-press fires so the click/tap that lands when the
  // finger lifts is swallowed instead of activating whatever is under it
  // (previously it could hit the just-opened menu's "Seleccionar" item and
  // drop the whole list into selection mode).
  const suppressClickRef = useRef(false);
  // Anchor element (+ its rect as a fallback) and attachment id captured at
  // pointerdown, when e.currentTarget (the row) is still live — the deferred
  // long-press callback can't rely on the event's target/currentTarget being
  // usable ~450ms later. The sheet re-measures `el` live on open; `rect` is
  // only used if the element is gone by then.
  const pressRef = useRef({ el: null, rect: null, attId: null });
  const coarse = useCoarsePointer();
  const isMobile = useIsMobile();
  // A media message that carries a caption renders as one merged bubble. On
  // TOUCH we treat a long-press on it like a long-press on a text message —
  // spotlight the whole bubble, show only the message actions, drop the
  // per-image "copiar imagen / descargar / abrir" items (viewing the images
  // is the job of a tap, which opens the gallery viewer). Desktop keeps the
  // image actions on right-click.
  const isCaptionedMedia =
    Boolean(String(message.body ?? "").trim()) && isMergeableMediaMessage(message.attachments ?? []);
  const simplifyMediaMenu = coarse && isCaptionedMedia;
  // On touch, suppress the browser's native text selection / callout so a
  // long-press opens OUR menu instead of starting a text selection that the
  // user then drags across several bubbles. `chat-msg-row` also gets a
  // stronger CSS-level `user-select:none` (chat-theme.css, @media coarse) that
  // beats any child re-enabling selection. Desktop keeps text selectable.
  const touchNoSelect = coarse ? "select-none [-webkit-touch-callout:none] [-webkit-user-select:none]" : "";

  // Clear the "swallow the next click" flag once the popover closes even if
  // that click never came (e.g. the viewer tapped the scrim, which is a
  // portal outside this row) — otherwise the next tap on an attachment/link
  // gets eaten by handleRowClickCapture.
  useEffect(() => {
    if (actionSheet.open) return undefined;
    releaseNativeSelection();
    const t = setTimeout(() => { suppressClickRef.current = false; }, 60);
    return () => clearTimeout(t);
  }, [actionSheet.open]);

  const isDeleted = Boolean(message.deleted_at);
  const isPending = String(message.id ?? "").startsWith("temp-");
  const gesturesDisabled = selectionMode || isDeleted || isPending || message.type === "date_separator"
    || message.sender_type === "system" || message.message_type === "system";

  const longPress = useLongPress({
    disabled: gesturesDisabled,
    // We do our own target filtering below (attachments MUST long-press
    // through to open the unified menu, other controls must not).
    ignoreInteractiveTarget: true,
    onLongPress: (e) => {
      const t = e?.target;
      // Allow the press on the bubble body / text and on an attachment tile;
      // ignore it on the hover "..." button, reaction pills, links, inputs.
      if (!pressRef.current.attId && t?.closest?.("a,button,input,textarea,[role=button]")) return;
      suppressClickRef.current = true;
      try { window.getSelection()?.removeAllRanges(); } catch { /* no-op */ }
      const { el, rect: r, attId } = pressRef.current;
      // Captioned media on touch: no per-image actions, and spotlight the whole
      // merged bubble (walk up from the pressed tile) rather than just the tile.
      const attachment = (attId && !simplifyMediaMenu)
        ? (message.attachments ?? []).find((a) => String(a.id) === attId) ?? null
        : null;
      const anchorEl = simplifyMediaMenu
        ? (el?.closest?.("[data-msg-bubble]") ?? el ?? null)
        : (el ?? null);
      const anchorR = simplifyMediaMenu ? (anchorEl?.getBoundingClientRect?.() ?? r) : r;
      setActionSheet({
        open: true,
        point: e && Number.isFinite(e.clientX) ? { x: e.clientX, y: e.clientY } : null,
        el: anchorEl,
        rect: anchorR ? { top: anchorR.top, bottom: anchorR.bottom, left: anchorR.left, right: anchorR.right, width: anchorR.width, height: anchorR.height } : null,
        attachment,
      });
    },
  });
  const { handlers: swipeHandlers, translateX } = useSwipeToReply({
    disabled: gesturesDisabled || !onReply,
    direction: isOwn && !isMobile ? "left" : "right",
    threshold: SWIPE_THRESHOLD,
    onReply: () => onReply?.(message),
  });

  // The action popover is a React child of this row but createPortal()s its
  // DOM to <body>. React still bubbles the popover's synthetic events up
  // through this row's handlers — so a click on a menu item would hit
  // handleRowClickCapture (and swallow the first click), a pointerdown would
  // arm long-press/swipe, etc. Ignore anything originating in the menu.
  const fromMenu = (e) => Boolean(e.target?.closest?.("[data-msg-action-menu]"));

  function handleRowPointerUp(e) {
    if (fromMenu(e)) return;
    releaseNativeSelection();
    longPress.onPointerUp?.(e);
    swipeHandlers.onPointerUp?.(e);
    if (coarse) { try { window.getSelection()?.removeAllRanges(); } catch { /* no-op */ } }
    // A long-press just opened the menu — don't also register this lift as a
    // tap (double-tap heart, etc.).
    if (suppressClickRef.current) return;
    // Double-tap -> quick heart. Only when the tap lands on the bubble
    // background / text, never an attachment, link, or reaction pill.
    if (gesturesDisabled || !onToggleReaction) return;
    if (e.target?.closest?.("a,button,img,video,input")) return;
    const now = Date.now();
    if (now - lastTapRef.current < 250) {
      onToggleReaction(message.id, "❤️");
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }

  function handleRowContextMenu(e) {
    if (gesturesDisabled || fromMenu(e)) return;
    const attEl = e.target?.closest?.("[data-attachment-id]");
    // Bail on controls that aren't an attachment tile (links, the hover "..."
    // button, reaction pills) — but an attachment MUST open the unified menu,
    // which then also carries its copy/download/open items.
    if (!attEl && e.target?.closest?.("a,button,input,textarea,[role=button]")) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = true;
    // Prefer the tight message-content box so the long-press "spotlight" frames
    // just the bubble, not the full-width row (which is padded and edge-to-edge).
    const anchorEl = attEl ?? e.target?.closest?.("[data-msg-bubble]") ?? e.currentTarget ?? e.target?.closest?.("[data-msg-id]");
    const r = anchorEl?.getBoundingClientRect?.();
    const attachment = attEl
      ? (message.attachments ?? []).find((a) => String(a.id) === attEl.dataset.attachmentId) ?? null
      : null;
    setActionSheet({
      open: true,
      point: { x: e.clientX, y: e.clientY },
      el: anchorEl ?? null,
      rect: r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null,
      attachment,
    });
  }

  // Capture-phase: eat the click that follows a long-press / contextmenu so it
  // can't fall through to the row's own onClick. NEVER touch a click that came
  // from the portaled action menu (see fromMenu) — that's what made the first
  // click on a menu item / dismiss do nothing.
  function handleRowClickCapture(e) {
    if (fromMenu(e)) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const rowGestureProps = {
    onPointerDown: (e) => {
      if (fromMenu(e)) return;
      // Capture the anchor now, while e.currentTarget (the row) is live.
      const attEl = e.target?.closest?.("[data-attachment-id]");
      // Anchor to the tight message-content box (not the padded, edge-to-edge
      // row) so the long-press spotlight frames just the bubble.
      const anchorEl = attEl ?? e.target?.closest?.("[data-msg-bubble]") ?? e.currentTarget;
      const rect = anchorEl?.getBoundingClientRect?.() ?? null;
      pressRef.current = {
        el: anchorEl ?? null,
        rect: rect && { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
        attId: attEl?.dataset?.attachmentId ?? null,
      };
      // The instant a finger lands, block native text selection app-wide
      // (see chat-suppress-select in chat-theme.css) — this beats iOS's
      // long-press selection timer, which `user-select:none` set later or
      // getSelection().removeAllRanges() can't fully abort once it fires.
      if (e.pointerType === "touch") suppressNativeSelection();
      longPress.onPointerDown?.(e);
      swipeHandlers.onPointerDown?.(e);
    },
    onPointerMove: (e) => { if (fromMenu(e)) return; longPress.onPointerMove?.(e); swipeHandlers.onPointerMove?.(e); },
    onPointerUp: handleRowPointerUp,
    onPointerCancel: (e) => {
      if (fromMenu(e)) return;
      releaseNativeSelection();
      longPress.onPointerCancel?.(e);
      swipeHandlers.onPointerCancel?.(e);
    },
    onClickCapture: handleRowClickCapture,
    onContextMenu: handleRowContextMenu,
    style: {
      transform: translateX ? `translateX(${translateX}px)` : undefined,
      transition: translateX ? "none" : "transform 0.18s ease-out",
      // Let the browser own vertical scroll but hand horizontal drags to the
      // swipe handlers — without this the browser claims the gesture and
      // fires pointercancel mid-drag, so the swipe never completes.
      touchAction: gesturesDisabled ? undefined : "pan-y",
    },
  };

  if (message.type === "date_separator") {
    return (
      <div className="flex items-center gap-3 my-4 px-4">
        <div className="flex-1 h-px bg-[hsl(var(--border))]" />
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-medium shrink-0 px-1">
          {message.label}
        </span>
        <div className="flex-1 h-px bg-[hsl(var(--border))]" />
      </div>
    );
  }

  if (getCallMeta(message)) {
    return <CallLogCard message={message} />;
  }

  if (getRecordingMeta(message)) {
    return <RecordingReadyCard message={message} />;
  }

  if (message.sender_type === "system" || message.message_type === "system") {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] px-3 py-1 rounded-full">
          {renderMentionText(message.body)}
        </span>
      </div>
    );
  }

  const attachments = message.attachments ?? [];
  const isAssistant = message.sender_type === "assistant";
  const senderName = isAssistant
    ? "MirAI"
    : (message.sender?.displayName ??
      (message.sender_type === "guest" ? "Visitante" : "Usuario"));

  const radius = bubbleRadius(isOwn, isFirst, isLast);
  const rowPaddingY = isFirst ? "mt-2" : "mt-0.5";
  const showMeta = isLast || showReadReceipt || isPending;

  // Bubble only shown when there's text (attachments render outside/below)
  const hasText = Boolean(message.body) || isDeleted;

  const hasBody = Boolean(message.body) && !isDeleted;
  const showActions = !isDeleted && !isPending;
  // "Reenviado" marker — WhatsApp/Telegram-style, shown for messages carrying
  // metadata.forwardedFrom (set by the forward endpoint). Rendered above the
  // bubble content in both the own and other branches.
  const isForwarded = Boolean(message.metadata?.forwardedFrom) && !isDeleted;
  const forwardedMark = isForwarded ? (
    <span className="flex items-center gap-1 text-[11px] italic mb-0.5 px-1 text-[hsl(var(--muted-foreground))]">
      <Forward className="h-3 w-3" />
      Reenviado
    </span>
  ) : null;
  const entityRefs = message.metadata?.entityRefs ?? [];
  const firstRefIsFile = entityRefs[0]?.entityType === "file" && Boolean(entityRefs[0]?.mimeType);
  // Only EntityReferenceCard knows how to blend into a bubble (matching
  // background, flush corners) — FileReferenceAttachment always renders its
  // own independent card, same as a real image/file attachment does
  // elsewhere in this app. So the "merge with the bubble above/around it"
  // treatment only ever applies when the ref(s) involved are non-file — the
  // first ref specifically for firstEntityRefAttached (only it ever merges
  // with preceding text), every ref for entityRefsOnlyBubble (the synthetic
  // bubble wrapper only makes sense if nothing inside it is going to render
  // as its own separately-styled attachment card).
  //
  // Only the first entity ref visually merges with the text bubble above it
  // (EntityReferenceCard's `attached` prop) — flatten the BUBBLE's own bottom
  // corners to match, otherwise the bubble's still-rounded bottom edge meets
  // the chip's now-flat top edge and produces the exact seam this feature
  // exists to remove.
  const firstEntityRefAttached = hasBody && entityRefs.length > 0 && !firstRefIsFile;
  // Caption + all-image (or single-video) attachments render as ONE bubble
  // (WhatsApp-style). Never for the assistant, never when an entity-ref already
  // merges into the text bubble, never for a deleted message.
  const mergeMediaCaption =
    hasBody && !isAssistant && !firstEntityRefAttached && isMergeableMediaMessage(attachments);
  // When a message carries entity refs but no text body, the refs ARE the whole
  // message — wrap them in a bubble-colored container instead of leaving them
  // floating bare, so the message still reads as a chat bubble. Only when
  // EVERY ref is non-file — a single file ref in the mix would sit inside
  // this wrapper as its own visually distinct card, reintroducing a seam.
  const entityRefsOnlyBubble =
    !hasBody &&
    entityRefs.length > 0 &&
    entityRefs.every((r) => !(r.entityType === "file" && r.mimeType));
  // All file-type refs in this message (after the same lead-ref slice the
  // render blocks below apply), rendered together as ONE FileReferenceGroup
  // so multiple images lay out in a grid and share a single carousel —
  // instead of each ref rendering its own independent, full-width card with
  // its own private single-item viewer.
  const fileRefs = entityRefs
    .slice(firstEntityRefAttached ? 1 : 0)
    .filter((ref) => ref.entityType === "file" && Boolean(ref.mimeType));

  // Own membership entry in this conversation — needed to detect role-targeted mentions
  // and to gate the pin action by permission.
  const ownMember = findOwnMember(members, currentUserId);
  const ownRoleId = ownMember?.roleId;
  const mentioned = !isDeleted && isMentioned(message, currentUserId, ownRoleId);
  // Someone replied to one of my messages — surface it with the same
  // left-border treatment a mention gets.
  const repliedToMe = !isDeleted && Boolean(message.reply_to?.senderUserId)
    && message.reply_to.senderUserId === currentUserId;
  const highlightRow = mentioned || repliedToMe;
  const canPin =
    (conversationType === "channel" || conversationType === "group") &&
    roleHasPermission(ownMember, CHAT_PERMISSIONS.MESSAGES_PIN);
  const canReply =
    !isThreadReplyView &&
    (conversationType === "channel" || conversationType === "group") &&
    !message.thread_root_id;
  const onOpenThread = onOpenThreadForMessage ? () => onOpenThreadForMessage(message.id) : undefined;

  if (isOwn) {
    return (
      <div
        data-msg-id={message.id}
        data-touch={coarse ? "1" : undefined}
        role={selectionMode ? "button" : undefined}
        aria-pressed={selectionMode ? isSelected : undefined}
        tabIndex={selectionMode ? 0 : undefined}
        onClick={selectionMode ? onSelect : undefined}
        onKeyDown={selectionMode ? (e) => e.key === "Enter" && onSelect?.() : undefined}
        {...rowGestureProps}
        className={[
          "group/msg chat-msg-row relative flex justify-end items-start gap-1 px-3 sm:px-4",
          touchNoSelect,
          rowPaddingY,
          isPending ? "opacity-60" : "",
          selectionMode ? "cursor-pointer" : "",
          selectionMode && isSelected ? "bg-primary/12" : "",
          isCurrentMatch ? "bg-yellow-400/15" : isSearchMatch ? "bg-yellow-400/6" : "",
          highlightRow ? "border-l-2 border-primary pl-2" : "",
          highlightRow && !(selectionMode && isSelected) ? "bg-primary/5" : "",
        ].join(" ")}
      >
        <SwipeReplyHint translateX={translateX} isOwn />
        {selectionMode ? (
          <SelectionCircle isSelected={isSelected} />
        ) : showActions && !actionSheet.open && (
          <MessageActions
            isOwn
            hasBody={hasBody}
            onCopy={onCopy}
            onDelete={onDelete}
            onEdit={onEdit ? () => onEdit(message) : undefined}
            onHideForMe={onHideForMe}
            onForward={onForward}
            onEnterSelection={onEnterSelection}
            canPin={canPin}
            isPinned={isPinned}
            onPin={onPin}
            onReact={() => setReactionPickerOpen(true)}
            canReply={canReply}
            onOpenThread={onOpenThread}
            onReply={onReply ? () => onReply(message) : undefined}
            onAskMirai={onAskMirai ? () => onAskMirai(message) : undefined}
            onShowReceipt={onShowReceipt ? () => onShowReceipt(message) : undefined}
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            isSpeaking={isSpeaking}
            isLoadingSpeak={isLoadingSpeak}
          />
        )}
        <MessageActionSheet
          open={actionSheet.open}
          onOpenChange={(o) => setActionSheet((s) => ({ ...s, open: o }))}
          anchorPoint={actionSheet.point}
          anchorEl={actionSheet.el}
          anchorRect={actionSheet.rect}
          attachment={actionSheet.attachment}
          isOwn
          actionProps={{
            hasBody, isOwn: true, canPin, isPinned, canReply,
            onReply: onReply ? () => onReply(message) : undefined,
            onEdit: onEdit ? () => onEdit(message) : undefined,
            onCopy, onForward, onEnterSelection, onPin, onOpenThread, onDelete, onHideForMe,
            onAskMirai: onAskMirai ? () => onAskMirai(message) : undefined,
            onShowReceipt: onShowReceipt ? () => onShowReceipt(message) : undefined,
            onSpeak: onSpeak ? () => onSpeak(message) : undefined,
            isSpeaking,
            isLoadingSpeak,
          }}
          onQuickReact={(emoji) => onToggleReaction?.(message.id, emoji)}
          onOpenFullPicker={() => setReactionPickerOpen(true)}
        />
        <MessageReactionPicker
          open={reactionPickerOpen}
          onOpenChange={setReactionPickerOpen}
          onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
          anchorAlign="end"
        >
          {/* min-w-0: without it, a flex item's default min-width:auto lets a
              fixed-px child (e.g. ImageGrid's 240px single-image box) refuse
              to shrink below its own content width, ignoring max-w-[72%]/65%
              entirely — worst in the 300px-wide MiniChatWindow, where a
              single image then overflows the whole floating window. */}
          <div data-msg-bubble className="flex flex-col items-end min-w-0 max-w-[72%] sm:max-w-[65%]">
            {forwardedMark}
            {/* Quote sits INSIDE the text bubble (below) when there's a body,
                tinted to match it; only floats on its own when the reply has
                no text bubble to nest into (attachment-only reply). */}
            {message.reply_to && !hasText && (
              <MessageQuote reply={message.reply_to} variant="inline" context="standalone" onJump={onJumpToMessage} />
            )}
            {/* Text bubble + the one entity ref that visually merges with it
                (when applicable) share a grid wrapper so they resolve to the
                SAME width — a flex column with items-end sizes each child to
                its own shrink-to-fit content width independently, which is
                what made a text bubble and its "attached" ref card render
                with mismatched widths despite matching color/radius. A
                single-column grid's own width tracks its widest child, and
                grid's default justify-items:stretch makes the narrower one
                fill that width instead. When nothing merges (no text, or the
                first ref is a file — those never merge), this wrapper is
                display:contents so it's invisible to layout and the text
                bubble renders exactly as if it were a direct child, same as
                before this existed. */}
            {hasText && !mergeMediaCaption && (
              <div className={firstEntityRefAttached ? "grid" : "contents"}>
                {hasText && (
                  <div
                    className={[
                      // min-w-0: this div is a flex/grid item (its "contents"
                      // or "grid" parent above is transparent to layout) —
                      // without it, a flex/grid item's default min-width:auto
                      // floors it at its content's min-content width, which
                      // for one long unbroken run of characters (a token,
                      // URL, hash) ignores wrap-break-word entirely and
                      // overflows straight past max-w-[72%]/65%, same root
                      // cause as the min-w-0 note on data-msg-bubble above.
                      "min-w-0 px-3 py-2 text-sm leading-relaxed",
                      radius,
                      firstEntityRefAttached ? "rounded-b-none!" : "",
                      "bg-(--brand-primary) text-(--brand-primary-foreground)",
                      isDeleted ? "opacity-50 italic" : "",
                    ].join(" ")}
                  >
                    {message.reply_to && !isDeleted && (
                      <MessageQuote reply={message.reply_to} variant="inline" context="onBrand" onJump={onJumpToMessage} />
                    )}
                    {isDeleted ? (
                      <span>Mensaje eliminado</span>
                    ) : (
                      renderRichText(message.body, { highlightQuery: isAssistant ? "" : searchQuery })
                    )}
                  </div>
                )}
                {firstEntityRefAttached && (
                  <EntityReferenceCard reference={entityRefs[0]} attached isOwn={true} />
                )}
              </div>
            )}

            {!isDeleted && onOpenThread && message.thread_reply_count > 0 && (
              <button
                type="button"
                onClick={() => onOpenThread?.()}
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:underline"
              >
                <MessageSquare className="h-3 w-3" />
                {message.thread_reply_count} {message.thread_reply_count === 1 ? "respuesta" : "respuestas"}
                {message.thread_last_reply_at && ` · ${formatMessageTime(message.thread_last_reply_at)}`}
              </button>
            )}

            {!isDeleted && attachments.length > 0 && (
              mergeMediaCaption ? (
                <MediaCaptionBubble
                  radiusClass={radius}
                  isOwn
                  body={message.body}
                  searchQuery={searchQuery}
                  replyTo={message.reply_to}
                  onJumpToMessage={onJumpToMessage}
                  attachmentsBlockProps={{
                    attachments,
                    onOpen: onAttachmentClick,
                    isOwn: true,
                    messageId: message.id,
                    currentUserId,
                    onToggleReaction,
                    onDeleteAttachment,
                    deletingAttachmentId,
                  }}
                />
              ) : (
                <AttachmentsBlock
                  attachments={attachments}
                  onOpen={onAttachmentClick}
                  isOwn
                  messageId={message.id}
                  currentUserId={currentUserId}
                  onToggleReaction={onToggleReaction}
                  onDeleteAttachment={onDeleteAttachment}
                  deletingAttachmentId={deletingAttachmentId}
                />
              )
            )}

            {!isDeleted && entityRefs.length > (firstEntityRefAttached ? 1 : 0) && (
              <div
                className={[
                  entityRefsOnlyBubble ? "grid" : "flex flex-col",
                  "gap-1",
                  firstEntityRefAttached ? "mt-1" : (hasText ? "mt-0" : "mt-1"),
                  entityRefsOnlyBubble ? [radius, "overflow-hidden", "bg-(--brand-primary)"].join(" ") : "",
                ].join(" ")}
              >
                {entityRefs.slice(firstEntityRefAttached ? 1 : 0).filter((ref) => !(ref.entityType === "file" && ref.mimeType)).map((ref, idx) => (
                  <EntityReferenceCard
                    key={`${ref.entityType}:${ref.recordId}:${idx}`}
                    reference={ref}
                    attached={entityRefsOnlyBubble}
                    isOwn={true}
                  />
                ))}
                {fileRefs.length > 0 && <FileReferenceGroup references={fileRefs} isOwn={true} onOpen={onAttachmentClick} />}
              </div>
            )}

            {/* Reactions render LAST, below every other message part (text,
                attachments, entity refs) — not wedged between the text
                bubble and whatever follows it, which is what visually "cut"
                a message in two regardless of any bubble-color/radius
                matching. Matches how reactions sit under the whole message
                in WhatsApp/Telegram/Discord, not under just its first part. */}
            {!isDeleted && (
              <MessageReactions
                reactions={message.reactions}
                members={members}
                currentUserId={currentUserId}
                onToggle={(emoji) => onToggleReaction?.(message.id, emoji)}
              />
            )}

            {showMeta && (
              <div className="flex items-center gap-1 mt-1 px-0.5">
                {isPinned && (
                  <Pin className="h-2.5 w-2.5 text-[hsl(var(--muted-foreground))]" />
                )}
                {message.edited_at && !isPending && (
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] italic">editado</span>
                )}
                <span className="chat-font-mono tabular-nums text-[10px] text-[hsl(var(--muted-foreground))]">
                  {isPending ? "Enviando..." : formatMessageTime(message.created_at)}
                </span>
                {showReadReceipt && !isPending && (
                  <CheckCheck className="h-3 w-3 text-(--brand-primary)" />
                )}
              </div>
            )}
          </div>
        </MessageReactionPicker>
      </div>
    );
  }

  return (
    <div
      data-msg-id={message.id}
      data-touch={coarse ? "1" : undefined}
      role={selectionMode ? "button" : undefined}
      aria-pressed={selectionMode ? isSelected : undefined}
      tabIndex={selectionMode ? 0 : undefined}
      onClick={selectionMode ? onSelect : undefined}
      onKeyDown={selectionMode ? (e) => e.key === "Enter" && onSelect?.() : undefined}
      {...rowGestureProps}
      className={[
        "group/msg chat-msg-row relative flex items-start gap-1 px-3 sm:px-4",
        touchNoSelect,
        rowPaddingY,
        isPending ? "opacity-60" : "",
        selectionMode ? "cursor-pointer" : "",
        selectionMode && isSelected ? "bg-primary/12" : "",
        isCurrentMatch ? "bg-yellow-400/15" : isSearchMatch ? "bg-yellow-400/6" : "",
        highlightRow ? "border-l-2 border-primary pl-2" : "",
        highlightRow && !(selectionMode && isSelected) ? "bg-primary/5" : "",
      ].join(" ")}
    >
      <SwipeReplyHint translateX={translateX} isOwn={false} />
      {selectionMode && <SelectionCircle isSelected={isSelected} />}
      <MessageActionSheet
        open={actionSheet.open}
        onOpenChange={(o) => setActionSheet((s) => ({ ...s, open: o }))}
        anchorPoint={actionSheet.point}
        anchorEl={actionSheet.el}
        anchorRect={actionSheet.rect}
        attachment={actionSheet.attachment}
        isOwn={false}
        actionProps={{
          hasBody, isOwn: false, canPin, isPinned, canReply,
          onReply: onReply ? () => onReply(message) : undefined,
          onCopy, onForward, onEnterSelection, onPin, onOpenThread, onDelete, onHideForMe,
          onAskMirai: onAskMirai ? () => onAskMirai(message) : undefined,
          onSpeak: onSpeak ? () => onSpeak(message) : undefined,
          isSpeaking,
          isLoadingSpeak,
        }}
        onQuickReact={(emoji) => onToggleReaction?.(message.id, emoji)}
        onOpenFullPicker={() => setReactionPickerOpen(true)}
      />
      {/* Avatar — invisible on non-last to keep column alignment */}
      <div className={["shrink-0", isLast ? "visible" : "invisible"].join(" ")}>
        {isAssistant ? (
          <div
            className="h-7 w-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </div>
        ) : message.sender?.avatarUrl && !avatarErr ? (
          <img
            src={message.sender.avatarUrl}
            alt={senderName}
            className="h-7 w-7 rounded-full object-cover"
            onError={() => setAvatarErr(true)}
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-[hsl(var(--muted))] border border-[hsl(var(--border))] flex items-center justify-center text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
            {(senderName?.[0] ?? "U").toUpperCase()}
          </div>
        )}
      </div>

      <MessageReactionPicker
        open={reactionPickerOpen}
        onOpenChange={setReactionPickerOpen}
        onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
        anchorAlign="start"
      >
        {/* min-w-0: same fix as the "own message" bubble above — without it a
            fixed-px attachment (image grid, file card, audio player) can
            overflow past max-w-[72%]/65% instead of being capped by it. */}
        <div data-msg-bubble className="flex flex-col items-start min-w-0 max-w-[72%] sm:max-w-[65%]">
          {isFirst && (
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-1 ml-1 truncate max-w-full">
              {isAssistant ? <AssistantWordmark /> : senderName}
            </span>
          )}

          {forwardedMark}

          {message.reply_to && !hasText && (
            <MessageQuote reply={message.reply_to} variant="inline" context="standalone" onJump={onJumpToMessage} />
          )}

          {hasText && !mergeMediaCaption && (
            <div className={firstEntityRefAttached ? "grid" : "contents"}>
              {hasText && (
                <div
                  className={[
                    // min-w-0 — see the matching note on the "own" bubble above.
                    "min-w-0 px-3 py-2 text-sm leading-relaxed",
                    radius,
                    firstEntityRefAttached ? "rounded-b-none!" : "",
                    "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                    isDeleted ? "opacity-50 italic" : "",
                  ].join(" ")}
                >
                  {message.reply_to && !isDeleted && (
                    <MessageQuote reply={message.reply_to} variant="inline" context="onMuted" onJump={onJumpToMessage} />
                  )}
                  {isDeleted ? (
                    <span>Mensaje eliminado</span>
                  ) : (
                    renderRichText(message.body, { highlightQuery: isAssistant ? "" : searchQuery })
                  )}
                </div>
              )}
              {firstEntityRefAttached && (
                <EntityReferenceCard reference={entityRefs[0]} attached isOwn={false} />
              )}
            </div>
          )}

          {!isDeleted && onOpenThread && message.thread_reply_count > 0 && (
            <button
              type="button"
              onClick={() => onOpenThread?.()}
              className="mt-1 inline-flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:underline"
            >
              <MessageSquare className="h-3 w-3" />
              {message.thread_reply_count} {message.thread_reply_count === 1 ? "respuesta" : "respuestas"}
              {message.thread_last_reply_at && ` · ${formatMessageTime(message.thread_last_reply_at)}`}
            </button>
          )}

          {!isDeleted && attachments.length > 0 && (
            mergeMediaCaption ? (
              <MediaCaptionBubble
                radiusClass={radius}
                isOwn={false}
                body={message.body}
                searchQuery={searchQuery}
                replyTo={message.reply_to}
                onJumpToMessage={onJumpToMessage}
                attachmentsBlockProps={{
                  attachments,
                  onOpen: onAttachmentClick,
                  isOwn: false,
                  messageId: message.id,
                  currentUserId,
                  onToggleReaction,
                  onDeleteAttachment,
                  deletingAttachmentId,
                }}
              />
            ) : (
              <AttachmentsBlock
                attachments={attachments}
                onOpen={onAttachmentClick}
                isOwn={false}
                messageId={message.id}
                currentUserId={currentUserId}
                onToggleReaction={onToggleReaction}
                onDeleteAttachment={onDeleteAttachment}
                deletingAttachmentId={deletingAttachmentId}
              />
            )
          )}

          {!isDeleted && entityRefs.length > (firstEntityRefAttached ? 1 : 0) && (
            <div
              className={[
                entityRefsOnlyBubble ? "grid" : "flex flex-col",
                "gap-1",
                firstEntityRefAttached ? "mt-1" : (hasText ? "mt-0" : "mt-1"),
                entityRefsOnlyBubble ? [radius, "overflow-hidden", "bg-[hsl(var(--muted))]"].join(" ") : "",
              ].join(" ")}
            >
              {entityRefs.slice(firstEntityRefAttached ? 1 : 0).filter((ref) => !(ref.entityType === "file" && ref.mimeType)).map((ref, idx) => (
                <EntityReferenceCard
                  key={`${ref.entityType}:${ref.recordId}:${idx}`}
                  reference={ref}
                  attached={entityRefsOnlyBubble}
                  isOwn={false}
                />
              ))}
              {fileRefs.length > 0 && <FileReferenceGroup references={fileRefs} isOwn={false} onOpen={onAttachmentClick} />}
            </div>
          )}

          {!isDeleted && (
            <MessageReactions
              reactions={message.reactions}
              members={members}
              currentUserId={currentUserId}
              onToggle={(emoji) => onToggleReaction?.(message.id, emoji)}
            />
          )}

          {showMeta && (
            <div className="flex items-center gap-1 mt-1 px-0.5">
              {isPinned && (
                <Pin className="h-2.5 w-2.5 text-[hsl(var(--muted-foreground))]" />
              )}
              <span className="chat-font-mono tabular-nums text-[10px] text-[hsl(var(--muted-foreground))]">
                {isPending ? "Enviando..." : formatMessageTime(message.created_at)}
              </span>
              {message.edited_at && !isPending && (
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] italic">editado</span>
              )}
            </div>
          )}
        </div>
      </MessageReactionPicker>

      {!selectionMode && showActions && !actionSheet.open && (
        <MessageActions
          isOwn={false}
          hasBody={hasBody}
          onCopy={onCopy}
          onDelete={onDelete}
          onHideForMe={onHideForMe}
          onForward={onForward}
          onEnterSelection={onEnterSelection}
          canPin={canPin}
          isPinned={isPinned}
          onPin={onPin}
          onReact={() => setReactionPickerOpen(true)}
          canReply={canReply}
          onOpenThread={onOpenThread}
          onReply={onReply ? () => onReply(message) : undefined}
          onAskMirai={onAskMirai ? () => onAskMirai(message) : undefined}
          onSpeak={onSpeak ? () => onSpeak(message) : undefined}
          isSpeaking={isSpeaking}
          isLoadingSpeak={isLoadingSpeak}
        />
      )}
    </div>
  );
}
