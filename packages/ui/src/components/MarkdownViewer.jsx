import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils.js";

const REMARK_PLUGINS = [remarkGfm];

const COMPONENTS = {
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (href && !href.startsWith("#")) {
          e.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }}
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ node, children, ...props }) => (
    <div className="overflow-x-auto my-3 rounded-md border border-border">
      <table {...props} style={{ margin: 0, width: "max-content", minWidth: "100%" }}>
        {children}
      </table>
    </div>
  ),
  td: ({ node, children, ...props }) => (
    <td {...props}>
      <div style={{ maxWidth: "220px", wordBreak: "break-word", overflowWrap: "break-word" }}>
        {children}
      </div>
    </td>
  ),
  th: ({ node, children, ...props }) => (
    <th {...props}>
      <div style={{ maxWidth: "220px", wordBreak: "break-word", overflowWrap: "break-word" }}>
        {children}
      </div>
    </th>
  ),
};

export function MarkdownViewer({ value, className, emptyText, accentColor }) {
  if (!value?.trim()) {
    if (!emptyText) return null;
    return <p className={cn("text-sm text-muted-foreground italic", className)}>{emptyText}</p>;
  }

  return (
    <div
      className={cn("mdx-prose text-sm", className)}
      style={accentColor ? { "--md-accent-color": accentColor } : undefined}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
