import { useEffect, useState } from "react";
import EmojiPicker, { EmojiStyle } from "emoji-picker-react";

// Shared emoji picker (chat composer, reactions, channel avatar, note icons).
//
// emoji-picker-react ships its own light/dark palette that clashes with the
// Runly theme, so every --epr-* color is repainted from the theme tokens (both
// the light and the dark set, since the tokens themselves flip with the theme).
// Sizes are tightened too: the library default (30px emoji + 5px padding) fits
// only ~6 per row in a 300px popover.
const EPR_VARS = {
  "--epr-bg-color": "hsl(var(--popover, var(--background)))",
  "--epr-dark-bg-color": "hsl(var(--popover, var(--background)))",
  "--epr-category-label-bg-color": "hsl(var(--popover, var(--background)))",
  "--epr-dark-category-label-bg-color": "hsl(var(--popover, var(--background)))",
  "--epr-category-label-text-color": "hsl(var(--muted-foreground))",
  "--epr-text-color": "hsl(var(--foreground))",
  "--epr-dark-text-color": "hsl(var(--foreground))",
  "--epr-hover-bg-color": "hsl(var(--muted))",
  "--epr-dark-hover-bg-color": "hsl(var(--muted))",
  "--epr-focus-bg-color": "hsl(var(--muted))",
  "--epr-dark-focus-bg-color": "hsl(var(--muted))",
  "--epr-highlight-color": "hsl(var(--primary))",
  "--epr-dark-highlight-color": "hsl(var(--primary))",
  "--epr-category-icon-active-color": "hsl(var(--primary))",
  "--epr-dark-category-icon-active-color": "hsl(var(--primary))",
  "--epr-search-input-bg-color": "hsl(var(--muted))",
  "--epr-dark-search-input-bg-color": "hsl(var(--muted))",
  "--epr-search-input-bg-color-active": "hsl(var(--muted))",
  "--epr-dark-search-input-bg-color-active": "hsl(var(--muted))",
  "--epr-search-input-text-color": "hsl(var(--foreground))",
  "--epr-search-input-placeholder-color": "hsl(var(--muted-foreground))",
  "--epr-search-border-color": "hsl(var(--border))",
  "--epr-search-border-color-active": "hsl(var(--primary))",
  "--epr-picker-border-color": "transparent",
  "--epr-preview-border-color": "hsl(var(--border))",
  "--epr-emoji-size": "22px",
  "--epr-emoji-padding": "4px",
  "--epr-category-label-height": "28px",
  "--epr-category-navigation-button-size": "22px",
  "--epr-header-padding": "8px 10px",
  "--epr-horizontal-padding": "8px",
  "--epr-search-input-height": "36px",
};

function useIsDark(forced) {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    if (forced !== undefined) return undefined;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [forced]);
  return forced ?? dark;
}

// Radix Dialog/Sheet lock scrolling (react-remove-scroll) for everything outside
// themselves. A picker opened in a Popover from inside a modal is portaled to
// <body>, so the lock cancels its wheel/touch scroll. Stopping propagation at
// the picker keeps those events from reaching the lock's document listeners.
const stopScrollLock = (event) => event.stopPropagation();

export function ThemedEmojiPicker({ onEmojiClick, width = "100%", height = 360, className = "", style, dark }) {
  const isDark = useIsDark(dark);
  return (
    <div className={className} style={style} onWheel={stopScrollLock} onTouchMove={stopScrollLock}>
      <EmojiPicker
        onEmojiClick={onEmojiClick}
        theme={isDark ? "dark" : "light"}
        emojiStyle={EmojiStyle.NATIVE}
        width={width}
        height={height}
        style={EPR_VARS}
        searchPlaceholder="Buscar emoji..."
        lazyLoadEmojis
        skinTonesDisabled
        autoFocusSearch={false}
        previewConfig={{ showPreview: false }}
      />
    </div>
  );
}
