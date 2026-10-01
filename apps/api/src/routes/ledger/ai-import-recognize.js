// apps/api/src/routes/ledger/ai-import-recognize.js
//
// Shared "recognize a bank statement file" pipeline (spec 2026-09-30-mirai-
// ledger-hr-fleet §3): detects the file type (PDF, image, CSV/XLSX), extracts
// candidate transaction rows, matches an account, flags DB duplicates against
// it and signs the import proof token. Extracted from ai-import-routes.js's
// POST /ledger/imports/recognize handler so the MirAI ledger.statement.import
// action (./mirai-actions.js) runs the exact same pipeline the route does —
// no divergent behavior between an uploaded file and a chat attachment.
import {
  ExtractionError, extractPdfPages, extractRowsFromText, extractStatementRows, suggestColumnMapping,
} from "./ai-import-extraction.js";
import { dedupeIntraFile, markDbDuplicates } from "./ai-import-dedup.js";
import { prepareVisionImage } from "../../services/vision-image.js";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// account match -> intra-file/DB dedup -> signed proof token -> response shape.
// Shared tail for all three recognize() branches (PDF, image, CSV/XLSX).
async function finishRecognize({ rawRows, documentText, companyId, actorId, service }) {
  const dedupedRows = dedupeIntraFile(rawRows);
  const { detectedAccount, candidateAccounts, existingTransactions } = await service.recognize({
    companyId,
    documentText,
  });
  const flaggedRows = markDbDuplicates(dedupedRows, existingTransactions);
  const rows = flaggedRows.map((row, index) => ({ tempId: `row-${index}`, ...row }));
  const proofToken = service.signImportProof({
    companyId,
    actorId,
    rowsHash: String(JSON.stringify(rows).length),
  });
  return { proofToken, detectedAccount, candidateAccounts, rows, warnings: [] };
}

// Detects the file format from filename/mimeType and runs the matching
// extraction path, then finishRecognize(). Throws ExtractionError (handled
// the same way by both call sites) for an unsupported format.
export async function recognizeStatementFile({ buffer, filename, mimeType, companyId, actorId, service, aiRouter }) {
  const name = String(filename || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    const { pages } = await extractPdfPages(buffer);
    const { rows: rawRows } = await extractStatementRows({
      pages,
      extractText: (args) => extractRowsFromText({ ...args, aiRouter }),
      extractVisionPage: service.vision.extractLedgerStatementPage,
    });
    const documentText = pages.map((p) => p.text).join("\n");
    return finishRecognize({ rawRows, documentText, companyId, actorId, service });
  }

  if (IMAGE_MIME_TYPES.includes(mimeType)) {
    let visionBuffer;
    try {
      visionBuffer = await prepareVisionImage(buffer);
    } catch (err) {
      throw new ExtractionError(err.message, 422);
    }
    const imageBase64 = visionBuffer.toString("base64");
    const { parsed } = await service.vision.extractLedgerStatementPage({ imageBase64, mimeType: "image/jpeg" });
    const rawRows = parsed.rows ?? [];
    return finishRecognize({ rawRows, documentText: "", companyId, actorId, service });
  }

  if (name.endsWith(".csv") || name.endsWith(".xlsx")) {
    // import-service.js uses optional heavy deps (exceljs, csv-parse) — load
    // lazily, same convention as ai-import-routes.js/accounts-routes.js.
    const { parseImportBuffer, validateImportRows } = await import("./import-service.js");
    const isCsv = name.endsWith(".csv");
    const rawHeaderRows = await parseImportBuffer(buffer, isCsv ? "csv" : "xlsx");
    if (rawHeaderRows.length === 0) throw new ExtractionError("El archivo no tiene datos.", 422);
    const headers = Object.keys(rawHeaderRows[0]);
    const mapping = await suggestColumnMapping({ headers, aiRouter });
    // nombre is required downstream (validateImportRows rejects rows without
    // it), but many real bank exports have no dedicated counterparty column —
    // see ai-import-routes.js's original comment on this fallback.
    if (!mapping.nombre && mapping.concepto) mapping.nombre = mapping.concepto;
    const { valid: rawRows } = validateImportRows(rawHeaderRows, mapping);
    return finishRecognize({ rawRows, documentText: "", companyId, actorId, service });
  }

  throw new ExtractionError("Formato no soportado. Usa PDF, imagen, CSV o XLSX.", 400);
}
