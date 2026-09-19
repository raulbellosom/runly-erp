import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Parse untrusted PDFs away from the API event loop, with limits set by the caller.
const task = getDocument({ data: new Uint8Array(workerData), isEvalSupported: false, useSystemFonts: false,
  disableFontFace: true, useWasm: false,
  standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))).replaceAll('\\', '/') });
try {
  const pdf = await task.promise;
  let text = '';
  let truncated = pdf.numPages > 20;
  for (let page = 1; page <= Math.min(pdf.numPages, 20); page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    text += `\nPágina ${page}: ${content.items.map(item => item.str ?? '').join(' ')}`;
    if (text.length > 12000) { truncated = true; break; }
  }
  parentPort.postMessage({ text: text.slice(0, 12000), truncated, empty: !text.replace(/Página \d+:/g, '').trim() });
} catch { parentPort.postMessage({ error: true }); }
finally { await task.destroy(); }
