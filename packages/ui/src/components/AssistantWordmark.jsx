// Two-tone MirAI wordmark for labels and headings. Flowing prose stays plain text.
export function AssistantWordmark({ className = "" }) {
  return (
    <span className={className}>
      Mir<span style={{ color: "var(--brand-primary)" }}>AI</span>
    </span>
  );
}
