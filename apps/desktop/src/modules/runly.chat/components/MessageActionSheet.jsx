import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCoarsePointer, useOfficeActions } from "@runly/ui";
import { Plus } from "lucide-react";
import { buildMessageActions, QUICK_REACTIONS } from "../lib/messageActions";
import { computeActionSheetLayout } from "../lib/messageActionLayout";
import { useAttachmentUrl, buildAttachmentActions } from "./MessageAttachments";

// CSS custom properties that are overridden on the `.chat-glass-theme` root
// (per-user accent preset, font-size preset, chat radii/fonts) and therefore
// have to be copied onto the lifted clone, which is portaled to <body> —
// outside that root — so the copy is styled exactly like the real bubble
// (same accent colour the user picked, same corner radius, same text size).
const THEME_VARS = [
  "--brand-primary",
  "--brand-primary-foreground",
  "--brand-primary-hover",
  "--brand-primary-on-dark",
  "--chat-radius-bubble",
  "--chat-radius-bubble-tail",
  "--chat-radius-panel",
  "--chat-radius-pill",
  "--chat-font-display",
  "--chat-font-mono",
  "--chat-zoom",
];

// Unified action surface for a message — one popover for every trigger:
//   - touch long-press: dimmed + blurred backdrop with a pixel copy of the
//     pressed bubble "lifted" onto the overlay (WhatsApp/Telegram), scaled down
//     when the pill + bubble + card stack can't fit the safe area; reaction pill
//     above, action card below; a short arm delay so the finger-lift doesn't
//     activate an item.
//   - mouse right-click: the same card anchored at the cursor with an invisible
//     click-catcher for dismiss, live on the first click.
// No Radix menu here — a programmatically-opened Radix DropdownMenu under the
// cursor swallowed the first click.
export function MessageActionSheet({
  open,
  onOpenChange,
  anchorPoint,        // {x,y} — mouse right-click position
  anchorEl,           // the pressed bubble / attachment DOM element (measured live on open)
  anchorRect,         // fallback rect captured at pointerdown, used only if anchorEl is gone
  attachment,         // the attachment tile that was pressed, if any
  isOwn = false,      // hug the bubble's side on touch
  actionProps,        // args for buildMessageActions (minus onReact)
  onQuickReact,       // (emoji) => void
  onOpenFullPicker,   // () => void
}) {
  const coarse = useCoarsePointer();
  const actions = buildMessageActions({ ...actionProps, onReact: undefined });
  const primary = actions.filter((a) => a.group === "primary");
  const danger = actions.filter((a) => a.group === "danger");
  // Attachment actions (copy image / copy link / download / open) merged into
  // the same menu when an image/file tile was the press target. useAttachmentUrl
  // is safe to call with undefined — it just stays disabled.
  const { data: attUrl } = useAttachmentUrl(attachment ?? undefined);
  const office = useOfficeActions();
  const attachmentActions = attachment ? buildAttachmentActions({ att: attachment, url: attUrl, office }) : [];

  const pillRef = useRef(null);
  const panelRef = useRef(null);
  const cloneHostRef = useRef(null);
  const [pos, setPos] = useState(null);
  // True once a real clone has been mounted into the host — the spotlight only
  // renders when there's actually a bubble copy to show (a stale/detached
  // anchor falls back to a plain menu, no empty lifted box).
  const [lifted, setLifted] = useState(false);

  useLayoutEffect(() => {
    const host = cloneHostRef.current;
    if (!open) { setPos(null); setLifted(false); host?.replaceChildren(); return; }
    const panel = panelRef.current;
    const pill = pillRef.current;
    if (!panel || !pill) return;

    const rootStyle = getComputedStyle(document.documentElement);
    const safeTop = parseFloat(rootStyle.getPropertyValue("--safe-top")) || 0;
    const safeBottom = parseFloat(rootStyle.getPropertyValue("--safe-bottom")) || 0;

    const pr = panel.getBoundingClientRect();
    const plr = pill.getBoundingClientRect();

    // Live geometry of the actual bubble — never a rect snapshotted 450ms ago at
    // pointerdown, which drifts out from under the spotlight when the list
    // settles / scrolls / reflows between the press and the menu opening.
    const liveEl = anchorEl && anchorEl.isConnected ? anchorEl : null;
    const measured = liveEl ? liveEl.getBoundingClientRect() : (anchorRect ?? null);
    const rect = measured
      ? { top: measured.top, bottom: measured.bottom, left: measured.left, right: measured.right }
      : null;

    let chatZoom = 1;
    if (coarse && host) {
      // Build the lifted copy from the real DOM so it is pixel-identical
      // (radius, colours, highlights, reactions, timestamp) with zero re-render.
      host.replaceChildren();
      if (liveEl) {
        const cs = getComputedStyle(liveEl);
        chatZoom = parseFloat(cs.getPropertyValue("--chat-zoom")) || 1;
        for (const v of THEME_VARS) {
          const val = cs.getPropertyValue(v);
          if (val) host.style.setProperty(v, val.trim());
        }
        const clone = liveEl.cloneNode(true);
        clone.removeAttribute("data-msg-bubble");
        clone.removeAttribute("data-attachment-id");
        clone.style.margin = "0";
        // The real bubble's `max-w-[72%]` is 72% of the full-width message row;
        // inside the fixed-width host that percentage would re-wrap the text.
        // The host is already sized to the measured content width, so drop the
        // cap and let the clone fill it — identical line breaks, identical height.
        clone.style.maxWidth = "none";
        clone.style.width = "100%";
        for (const media of clone.querySelectorAll("video,audio")) {
          media.removeAttribute("autoplay");
          media.setAttribute("preload", "none");
          try { media.pause?.(); } catch { /* detached node */ }
        }
        for (const withId of clone.querySelectorAll("[id]")) withId.removeAttribute("id");
        // `.chat-scale-target` (an ancestor of the real bubble) applies
        // `zoom: var(--chat-zoom)`, which getBoundingClientRect already baked
        // into `rect`. Re-apply it here and pre-divide the width so the copy
        // reflows to the same line breaks / height it had in place.
        host.style.zoom = chatZoom === 1 ? "" : String(chatZoom);
        host.style.width = rect ? `${(rect.right - rect.left) / chatZoom}px` : "";
        host.appendChild(clone);
      }
    }
    setLifted(Boolean(coarse && liveEl));

    const layout = computeActionSheetLayout({
      vw: window.innerWidth,
      vh: window.innerHeight,
      rect,
      anchorPoint: (!coarse && anchorPoint) ? anchorPoint : null,
      pillSize: { width: plr.width, height: plr.height },
      panelSize: { width: pr.width, height: pr.height },
      coarse,
      isOwn,
      safeTop,
      safeBottom,
      gap: 8,
      margin: 8,
    });

    setPos(layout);
  }, [open, anchorEl, anchorRect, anchorPoint, isOwn, coarse, attachmentActions.length, primary.length, danger.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Touch only: the popover opens while the finger is still down from the
  // long-press, so ignore pointer input on it for a beat — otherwise the lift
  // that ends the long-press activates whatever item is under it. A mouse
  // right-click produces no such synthetic click, so it stays live immediately.
  const [armed, setArmed] = useState(!coarse);
  useEffect(() => {
    if (!coarse) { setArmed(true); return undefined; }
    if (!open) { setArmed(false); return undefined; }
    setArmed(false);
    const t = setTimeout(() => setArmed(true), 220);
    return () => clearTimeout(t);
  }, [open, coarse]);

  if (!open) return null;

  function runAction(a) {
    if (a.disabled) return;
    onOpenChange(false);
    a.onSelect?.();
  }
  const close = () => onOpenChange(false);

  const surface = "glass-strong text-[hsl(var(--popover-foreground,var(--foreground)))] shadow-lg";
  const gate = armed ? "" : "pointer-events-none";
  const scrim = "bg-black/55 backdrop-blur-[3px]";
  const spotlight = coarse && lifted && pos?.mode === "spotlight";
  // Touch: pill + card ride the spotlight rise with a soft fade+zoom. Mouse
  // right-click: the menu must appear the instant you click, exactly where you
  // clicked — no zoom/slide entrance (that read as "opening left-to-right").
  const menuAnim = coarse
    ? "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 duration-100"
    : "";

  const menuItem = (a, extra = "") => (
    <button
      key={a.key}
      type="button"
      disabled={a.disabled}
      onClick={() => runAction(a)}
      className={[
        "w-full flex items-center px-4 py-2.5 text-[13px] text-left hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent",
        extra,
      ].join(" ")}
    >
      <a.icon className={`h-4 w-4 mr-3 shrink-0 ${a.iconClassName ?? ""}`} />{a.label}
    </button>
  );

  return createPortal(
    <div
      data-msg-action-menu
      className="fixed inset-0 z-200"
      role="dialog"
      aria-label="Acciones del mensaje"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Dismiss layer — full-screen. Touch: dim + blur everything (the real
          bubble included); the lifted copy below sits on top, un-dimmed, so it
          reads as the same bubble raised off the page. Mouse: an invisible
          click catcher. */}
      <button
        type="button"
        aria-label="Cerrar"
        onClick={close}
        className={["absolute inset-0", coarse ? `${scrim} motion-safe:animate-in motion-safe:fade-in-0 duration-150` : ""].join(" ")}
      />

      {/* Lifted bubble copy (touch long-press only) — a pixel clone of the real
          bubble raised above the scrim. Tapping it dismisses, like WhatsApp.
          Rendered as soon as the sheet is open (so cloneHostRef exists for the
          layout effect) and only revealed once positioned. The wrapper's
          position + scale are set STATICALLY from `pos` (no transition, so it
          can never appear to slide/teleport between frames); the entrance
          motion is a pure fade+pop on the inner host via .chat-spotlight-rise.
          Every descendant is pointer-events:none so a cloned link/button can't
          swallow the dismiss tap. */}
      {coarse && (
        <div
          role="button"
          aria-label="Cerrar"
          onClick={close}
          className="fixed"
          style={{
            left: pos?.cloneLeft ?? -9999,
            top: pos?.cloneTop ?? -9999,
            width: pos?.cloneWidth ?? 0,
            transform: `scale(${pos?.scale ?? 1})`,
            transformOrigin: "top left",
            visibility: spotlight ? "visible" : "hidden",
          }}
        >
          <div
            ref={cloneHostRef}
            className={[
              "pointer-events-none **:pointer-events-none drop-shadow-[0_10px_28px_rgb(0_0_0/0.3)]",
              spotlight ? "chat-spotlight-rise" : "",
            ].join(" ")}
          />
        </div>
      )}

      {/* Quick-reaction pill */}
      <div
        ref={pillRef}
        style={{
          position: "fixed",
          left: pos?.pillLeft ?? -9999,
          top: pos?.pillTop ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
        className={["rounded-full px-1 flex items-center gap-0.5", menuAnim, surface, gate].join(" ")}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => { close(); onQuickReact?.(emoji); }}
            className="h-9 w-8 text-lg flex items-center justify-center rounded-full hover:bg-[hsl(var(--muted))] active:scale-90 transition"
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          aria-label="Mas emojis"
          onClick={() => { close(); onOpenFullPicker?.(); }}
          className="h-9 w-8 flex items-center justify-center rounded-full hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Action card */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          left: pos?.panelLeft ?? -9999,
          top: pos?.panelTop ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
        className={["w-60 max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto overflow-x-hidden rounded-xl py-1", menuAnim, surface, gate].join(" ")}
      >
        {primary.map((a) => menuItem(a))}
        {attachmentActions.length > 0 && (
          <>
            <div className="h-px bg-[hsl(var(--border))] my-1" />
            {attachmentActions.map((a) => menuItem(a))}
          </>
        )}
        {primary.length + attachmentActions.length > 0 && danger.length > 0 && (
          <div className="h-px bg-[hsl(var(--border))] my-1" />
        )}
        {danger.map((a) => menuItem(a, a.danger ? "text-red-500" : ""))}
      </div>
    </div>,
    document.body,
  );
}
