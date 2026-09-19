// apps/desktop/src/modules/runly.chat/components/AssistantMarkdown.jsx
//
// MirAI answers in plain text but uses ```fences``` for code and `backticks`
// inline. Render exactly those two — nothing else (no #, **, tables, HTML).
import { useState } from "react";

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

export function AssistantMarkdown({ text }) {
  if (!text) return null;
  const out = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: "code", lang: m[1] || "", v: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });

  return (
    <div className="text-left">
      {out.map((seg) =>
        seg.t === "code" ? (
          <CodeBlock key={`c${k++}`} code={seg.v} lang={seg.lang} />
        ) : (
          <p key={`t${k++}`} className="whitespace-pre-wrap wrap-break-word">
            {seg.v.split(/(`[^`\n]+`)/g).map((piece, i) =>
              piece.startsWith("`") && piece.endsWith("`") && piece.length > 2 ? (
                <code key={i} className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[0.85em]">
                  {piece.slice(1, -1)}
                </code>
              ) : (
                piece
              ),
            )}
          </p>
        ),
      )}
    </div>
  );
}
