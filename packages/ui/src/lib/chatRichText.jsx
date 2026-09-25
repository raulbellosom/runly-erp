// packages/ui/src/lib/chatRichText.jsx
//
// WhatsApp-style rich text for chat bodies: *bold*, _italic_, ~strikethrough~,
// `inline code`, ```fenced code```, plus real "- " bullet / "1. " ordered
// lists (WhatsApp itself doesn't render lists, but chat messages here
// routinely need them). Composes with the existing @[uuid:name] mention
// tokens (MentionTextarea's format) and an optional search-query highlight,
// so this is the single render path for every chat surface — member
// messages, MirAI's answers, the MirAI side panel, and the call chat.
import { useState } from "react";
import { splitMentionSegments } from "../components/MentionTextarea.jsx";

const INLINE_TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
const LIST_ITEM_RE = /^\s*[-•]\s+(.*)$/;
const ORDERED_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;
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
    const paraLines = [lines[i]];
    i += 1;
    while (i < lines.length && !ORDERED_ITEM_RE.test(lines[i]) && !LIST_ITEM_RE.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: paraLines.join("\n") });
  }
  return blocks;
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">
        <span>{lang || "codigo"}</span>
        <button
          type="button"
          className="hover:text-[hsl(var(--foreground))]"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {});
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        <code className="font-mono whitespace-pre">{code}</code>
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
    paragraphClassName = "text-left whitespace-pre-wrap wrap-break-word",
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
