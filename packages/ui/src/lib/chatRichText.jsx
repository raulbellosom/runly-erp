// packages/ui/src/lib/chatRichText.jsx
//
// WhatsApp-style rich text for chat bodies: *bold*, _italic_, ~strikethrough~,
// `inline code`, ```fenced code```, plus real "- " bullet / "1. " ordered
// lists and "> " blockquotes (WhatsApp itself doesn't render any of those
// three, but chat messages here routinely need them). Composes with the
// existing @[uuid:name] mention tokens (MentionTextarea's format) and an
// optional search-query highlight, so this is the single render path for
// every chat surface — member messages, MirAI's answers, the MirAI side
// panel, and the call chat.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { splitMentionSegments } from "../components/MentionTextarea.jsx";

const INLINE_TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
const LIST_ITEM_RE = /^\s*[-•]\s+(.*)$/;
const ORDERED_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_ITEM_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /```([\w+-]*)\n?([\s\S]*?)```/g;

function buildHighlightRegex(query) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp("\\b" + escaped, "gi");
  } catch {
    return null;
  }
}

function renderHighlighted(text, re, keyPrefix) {
  if (!text || !re) return text;
  re.lastIndex = 0;
  const out = [];
  let lastIndex = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    out.push(
      <mark key={`${keyPrefix}-hl${i++}`} className="bg-yellow-300 text-black rounded-xs px-0.5">
        {m[0]}
      </mark>,
    );
    lastIndex = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex += 1;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length ? out : text;
}

function renderInlineText(text, highlightRe, codeClassName, keyPrefix) {
  const segments = splitMentionSegments(text);
  const nodes = [];
  segments.forEach((seg, si) => {
    if (seg.type === "mention") {
      nodes.push(
        <span
          key={`${keyPrefix}-mn${si}`}
          className="inline-flex items-center bg-accent/30 text-accent-foreground rounded px-1 text-sm font-medium"
        >
          @{seg.name}
        </span>,
      );
      return;
    }
    const pieces = seg.value.split(INLINE_TOKEN_RE).filter((p) => p !== "");
    pieces.forEach((piece, pi) => {
      const key = `${keyPrefix}-p${si}-${pi}`;
      if (piece.length > 2 && piece.startsWith("*") && piece.endsWith("*")) {
        nodes.push(<strong key={key}>{renderHighlighted(piece.slice(1, -1), highlightRe, key)}</strong>);
      } else if (piece.length > 2 && piece.startsWith("_") && piece.endsWith("_")) {
        nodes.push(<em key={key}>{renderHighlighted(piece.slice(1, -1), highlightRe, key)}</em>);
      } else if (piece.length > 2 && piece.startsWith("~") && piece.endsWith("~")) {
        nodes.push(<s key={key}>{renderHighlighted(piece.slice(1, -1), highlightRe, key)}</s>);
      } else if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) {
        nodes.push(
          <code key={key} className={codeClassName}>
            {piece.slice(1, -1)}
          </code>,
        );
      } else {
        const h = renderHighlighted(piece, highlightRe, key);
        nodes.push(Array.isArray(h) ? <span key={key}>{h}</span> : h);
      }
    });
  });
  return nodes;
}

// Groups the lines of one non-fenced text segment into paragraph / bullet /
// ordered-list blocks. Consecutive non-list lines stay one paragraph block
// (newlines preserved via whitespace-pre-wrap), matching the previous
// single-<p> rendering when no list is present.
function groupLines(text) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const ordered = ORDERED_ITEM_RE.exec(lines[i]);
    const bullet = !ordered && LIST_ITEM_RE.exec(lines[i]);
    const quote = !ordered && !bullet && QUOTE_ITEM_RE.exec(lines[i]);
    if (ordered || bullet) {
      const kind = ordered ? "ol" : "ul";
      const items = [];
      while (i < lines.length) {
        const o = ORDERED_ITEM_RE.exec(lines[i]);
        const b = !o && LIST_ITEM_RE.exec(lines[i]);
        if (kind === "ol" && o) { items.push(o[1]); i += 1; continue; }
        if (kind === "ul" && b) { items.push(b[1]); i += 1; continue; }
        break;
      }
      blocks.push({ type: kind, items });
      continue;
    }
    if (quote) {
      const quoteLines = [];
      while (i < lines.length) {
        const q = QUOTE_ITEM_RE.exec(lines[i]);
        if (!q) break;
        quoteLines.push(q[1]);
        i += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }
    const paraLines = [lines[i]];
    i += 1;
    while (
      i < lines.length &&
      !ORDERED_ITEM_RE.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !QUOTE_ITEM_RE.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: paraLines.join("\n") });
  }
  return blocks;
}

// Always dark, regardless of the app's light/dark theme or the bubble color
// it sits in (own bubble = brand color, received = --muted) — a code block
// that borrows either of those blends straight into its surroundings (the
// bug: in light theme, this used bg-[hsl(var(--muted))], the exact same
// token the received-message bubble itself uses, so on a light theme the
// "code canvas" was invisible against its own background). Matches the
// universal editor/GitHub convention of a dark code canvas independent of
// the surrounding UI theme, so it always reads clearly as code.
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  return (
    // w-[min(22rem,80vw)]: a code block's own preferred width would
    // otherwise be driven by its longest unwrapped line (white-space: pre) —
    // min-w-0/overflow-hidden alone don't stop that from propagating up
    // through the bubble's own fit-content sizing (the bubble hugs its text,
    // so it isn't a fixed width to begin with), which is exactly how one long
    // line still blew the whole bubble/window out. Giving this box a
    // definite preferred width instead breaks that propagation at the
    // source; max-w-full then reclamps it down for a narrow container (the
    // ~300px MiniChatWindow) where even that would still be too wide — same
    // two-part fix already used for captioned images (MediaCaptionBubble).
    <div className="my-1.5 min-w-0 w-[min(22rem,80vw)] max-w-full overflow-hidden rounded-lg border border-white/10 bg-[#1e1e2e]">
      <div className="flex items-center justify-between gap-2 bg-black/25 px-2.5 py-1 text-[10px] text-slate-400">
        <span className="truncate">{lang || "codigo"}</span>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-white/10 hover:text-slate-200"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="min-w-0 max-w-full overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        <code className="whitespace-pre font-mono text-slate-100">{code}</code>
      </pre>
    </div>
  );
}

/**
 * Renders a chat message body with WhatsApp-style formatting.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.highlightQuery] - search term to <mark> inside the text
 * @param {string} [opts.codeClassName] - classes for inline `code`
 * @param {string} [opts.listClassName] - extra classes merged onto <ul>/<ol>
 * @param {string} [opts.paragraphClassName] - classes for each text block's <p>
 */
export function renderRichText(text, opts = {}) {
  const {
    highlightQuery = "",
    codeClassName = "rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[0.85em]",
    listClassName = "",
    // wrap-anywhere (overflow-wrap: anywhere), not wrap-break-word
    // (overflow-wrap: break-word) — a long unbroken run (a token, hash, URL)
    // still overflows a flex-sized bubble under break-word: per spec, that
    // value is deliberately excluded from the browser's min-content size
    // calculation (kept for CSS2.1 back-compat), so the bubble's own min
    // width is computed as if the word couldn't break at all, and only THEN
    // does actual line-breaking apply — too late, the box already sized
    // itself around the unbroken word. `anywhere` is the one MDN recommends
    // specifically for flex/grid contexts because it IS counted toward
    // min-content, so the bubble can actually shrink below one long word's
    // width instead of forcing everything wider to make room for it.
    paragraphClassName = "text-left whitespace-pre-wrap wrap-anywhere",
  } = opts;
  if (!text) return null;
  const highlightRe = buildHighlightRegex(highlightQuery);

  const segments = [];
  let last = 0;
  let m;
  let fenceIdx = 0;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ t: "text", v: text.slice(last, m.index) });
    segments.push({ t: "code", lang: m[1] || "", v: m[2].replace(/\n$/, ""), key: `fence${fenceIdx++}` });
    last = FENCE_RE.lastIndex;
  }
  if (last < text.length) segments.push({ t: "text", v: text.slice(last) });

  return (
    <>
      {segments.map((seg, si) => {
        if (seg.t === "code") return <CodeBlock key={seg.key} code={seg.v} lang={seg.lang} />;
        return groupLines(seg.v).map((block, bi) => {
          const bKey = `b${si}-${bi}`;
          if (block.type === "ul") {
            return (
              <ul key={bKey} className={`list-disc pl-5 my-1 space-y-0.5 ${listClassName}`}>
                {block.items.map((item, ii) => (
                  <li key={`${bKey}-li${ii}`}>{renderInlineText(item, highlightRe, codeClassName, `${bKey}i${ii}`)}</li>
                ))}
              </ul>
            );
          }
          if (block.type === "ol") {
            return (
              <ol key={bKey} className={`list-decimal pl-5 my-1 space-y-0.5 ${listClassName}`}>
                {block.items.map((item, ii) => (
                  <li key={`${bKey}-li${ii}`}>{renderInlineText(item, highlightRe, codeClassName, `${bKey}i${ii}`)}</li>
                ))}
              </ol>
            );
          }
          if (block.type === "quote") {
            // border-current so the rule always matches whatever color
            // paragraphClassName gives the text (brand-on-own-bubble vs.
            // foreground-on-received-bubble) without a separate isOwn prop.
            return (
              <blockquote key={bKey} className="my-1 border-l-2 border-current/40 pl-2 opacity-80">
                <p className={paragraphClassName}>
                  {renderInlineText(block.text, highlightRe, codeClassName, bKey)}
                </p>
              </blockquote>
            );
          }
          return (
            <p key={bKey} className={paragraphClassName}>
              {renderInlineText(block.text, highlightRe, codeClassName, bKey)}
            </p>
          );
        });
      })}
    </>
  );
}
