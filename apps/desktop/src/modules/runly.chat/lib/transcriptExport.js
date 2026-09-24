// Copiar/descargar una transcripción ya READY — texto plano, no un render de
// la UI, porque a diferencia de canvasExport.js/notePageExport.js (rasterizan
// una nota visual) el contenido aquí es simple texto con marcas de tiempo,
// así que un PDF con texto real (seleccionable/buscable) tiene más sentido
// que rasterizar el diálogo.

function formatTimestamp(ms) {
  const totalSeconds = Math.floor((ms ?? 0) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const safeName = (title) => (title?.trim() || "transcripcion").replace(/[^\w\-. ]+/g, "_");

// Segments only carry speakerLabel once V2 (captura por pista) ships — V1
// (audio mezclado) never sets it, same assumption TranscriptViewerDialog
// already makes.
export function transcriptToPlainText(transcript) {
  const lines = (transcript?.segments ?? []).map((segment) => {
    const prefix = segment.speakerLabel ? `${segment.speakerLabel}: ` : "";
    return `[${formatTimestamp(segment.startMs)}] ${prefix}${segment.text}`;
  });
  return lines.join("\n");
}

export async function copyTranscriptToClipboard(transcript) {
  const text = transcriptToPlainText(transcript);
  if (!text) throw new Error("No hay contenido para copiar.");
  await navigator.clipboard.writeText(text);
}

export async function downloadTranscriptPdf(transcript, { callTitle } = {}) {
  const text = transcriptToPlainText(transcript);
  if (!text) throw new Error("No hay contenido para descargar.");

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 48;
  const marginTop = 56;
  const marginBottom = 56;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let cursorY = marginTop;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(callTitle || "Transcripción de llamada", marginX, cursorY);
  cursorY += 18;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text("Generada automáticamente — puede contener errores de reconocimiento.", marginX, cursorY);
  cursorY += 20;
  pdf.setTextColor(0);

  pdf.setFontSize(10.5);
  const lineHeight = 15;
  for (const rawLine of text.split("\n")) {
    const wrapped = pdf.splitTextToSize(rawLine, contentWidth);
    for (const line of wrapped) {
      if (cursorY + lineHeight > pageHeight - marginBottom) {
        pdf.addPage();
        cursorY = marginTop;
      }
      pdf.text(line, marginX, cursorY);
      cursorY += lineHeight;
    }
  }

  pdf.save(`${safeName(callTitle)}.pdf`);
}
