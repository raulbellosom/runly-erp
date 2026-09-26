import { Copy, Forward, CheckSquare, Pin, PinOff, Smile, MessageSquare, Trash2, EyeOff, CornerUpLeft, Sparkles, Info, Volume2, Square, Loader2, Pencil } from "lucide-react";

// Single source of truth for the per-message action list. Consumed by the
// desktop hover menu (MessageActions in ChatMessageBubble) and the mobile /
// right-click MessageActionSheet. Each entry:
//   { key, label, icon, iconClassName?, onSelect, danger?, group }
// `group` is "primary" | "danger" — drives separator placement. `iconClassName`
// is optional extra classes appended to the icon's own (e.g. "animate-spin"
// for the speak action while loading) — every render site must apply it.
export function buildMessageActions({
  hasBody, isOwn, canPin, isPinned, canReply,
  onReply, onCopy, onForward, onEnterSelection, onPin, onReact, onOpenThread,
  onDelete, onHideForMe, onAskMirai, onShowReceipt, onSpeak, isSpeaking, isLoadingSpeak, onEdit,
}) {
  const items = [];
  if (onReply) items.push({ key: "reply", label: "Responder", icon: CornerUpLeft, onSelect: onReply, group: "primary" });
  // Own text messages only — editing an attachment's caption/body still goes
  // through this same PATCH (the API only ever touches `body`).
  if (isOwn && hasBody && onEdit) items.push({ key: "edit", label: "Editar", icon: Pencil, onSelect: onEdit, group: "primary" });
  if (hasBody && onCopy) items.push({ key: "copy", label: "Copiar", icon: Copy, onSelect: onCopy, group: "primary" });
  // "Leer en voz alta" — any message with text, from anyone, not just MirAI
  // (see hooks/useTextToSpeech.js). Toggles to "Detener lectura" while this
  // specific message's audio is the one currently playing, and shows a
  // spinner while it's being synthesized — clicking it either way cancels.
  if (hasBody && onSpeak) {
    items.push({
      key: "speak",
      label: isLoadingSpeak ? "Generando audio…" : isSpeaking ? "Detener lectura" : "Leer en voz alta",
      icon: isLoadingSpeak ? Loader2 : isSpeaking ? Square : Volume2,
      iconClassName: isLoadingSpeak ? "animate-spin" : undefined,
      onSelect: onSpeak,
      group: "primary",
    });
  }
  if (onForward) items.push({ key: "forward", label: "Reenviar", icon: Forward, onSelect: onForward, group: "primary" });
  if (onAskMirai) items.push({ key: "ask-mirai", label: "Preguntar a MirAI", icon: Sparkles, onSelect: onAskMirai, group: "primary" });
  if (onEnterSelection) items.push({ key: "select", label: "Seleccionar", icon: CheckSquare, onSelect: onEnterSelection, group: "primary" });
  if (canPin && onPin) items.push({ key: "pin", label: isPinned ? "Desfijar mensaje" : "Fijar mensaje", icon: isPinned ? PinOff : Pin, onSelect: onPin, group: "primary" });
  if (onReact) items.push({ key: "react", label: "Reaccionar", icon: Smile, onSelect: onReact, group: "primary" });
  if (canReply && onOpenThread) items.push({ key: "thread", label: "Responder en hilo", icon: MessageSquare, onSelect: onOpenThread, group: "primary" });
  // Own messages only — mirrors WhatsApp's "Info del mensaje", which only ever
  // appears on messages you sent (the enviado/visto breakdown is meaningless
  // on a message you received).
  if (isOwn && onShowReceipt) items.push({ key: "receipt", label: "Info del mensaje", icon: Info, onSelect: onShowReceipt, group: "primary" });
  if (isOwn && onDelete) items.push({ key: "delete", label: "Eliminar para todos", icon: Trash2, onSelect: onDelete, danger: true, group: "danger" });
  if (onHideForMe) items.push({ key: "hide", label: "Eliminar para mi", icon: EyeOff, onSelect: onHideForMe, group: "danger" });
  return items;
}

export const QUICK_REACTIONS = ["\u{1F44D}", "❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];
