// Copiar el analisis de MirAI (resumen/acuerdos/tareas/eventos) — texto plano,
// mismo principio que transcriptExport.js: el contenido es texto simple, no
// una vista que rasterizar.

function formatDateTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("es-MX"); } catch { return iso; }
}

export function analysisToPlainText(analysis) {
  if (!analysis) return "";
  const lines = [];
  if (analysis.summary) lines.push("Resumen:", analysis.summary, "");
  if (analysis.decisions?.length) {
    lines.push("Acuerdos:");
    for (const d of analysis.decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (analysis.actionItems?.length) {
    lines.push("Tareas propuestas:");
    for (const item of analysis.actionItems) lines.push(`- ${item.text}`);
    lines.push("");
  }
  if (analysis.proposedEvents?.length) {
    lines.push("Eventos propuestos:");
    for (const ev of analysis.proposedEvents) lines.push(`- ${ev.title} (${formatDateTime(ev.startsAt)})`);
    lines.push("");
  }
  const proposedContacts = analysis.moduleProposals?.["runly.contacts"]?.proposed;
  if (proposedContacts?.length) {
    lines.push("Contactos propuestos:");
    for (const c of proposedContacts) {
      const detail = [c.company, c.email, c.phone].filter(Boolean).join(" · ");
      lines.push(`- ${c.name}${detail ? ` (${detail})` : ""}`);
    }
  }
  return lines.join("\n").trim();
}

export async function copyAnalysisToClipboard(analysis) {
  const text = analysisToPlainText(analysis);
  if (!text) throw new Error("No hay contenido para copiar.");
  await navigator.clipboard.writeText(text);
}

export async function copyTextToClipboard(text) {
  if (!text) throw new Error("No hay contenido para copiar.");
  await navigator.clipboard.writeText(text);
}
