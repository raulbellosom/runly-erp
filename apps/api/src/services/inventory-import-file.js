// File parsing + value normalizers for the inventory item import.
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { InventoryServiceError } from './inventory-guards.js';

export const MAX_ITEM_IMPORT_ROWS = 2000;
export const MAX_IMAGES_PER_ROW = 5;

const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

export const clean = (value) => String(value ?? '').trim();
export const key = (value) => clean(value).toLocaleLowerCase('es');
export function normalizeHeader(header) {
  return clean(header).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.#°º]/g, '').replace(/\s+/g, '_');
}

function isoFromDate(date) {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${m}-${d}`;
}

// "2024-03-15", "15/03/2024", "15-03-24" -> "2024-03-15"; null when invalid.
export function parseImportDate(value) {
  const str = clean(value);
  if (!str) return null;
  let y; let m; let d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (match) [, y, m, d] = match.map(Number);
  else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(str);
    if (!match) return null;
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return isoFromDate(date);
}

// "$1,299.50" -> 1299.5; null when empty; NaN when not a number.
export function parseImportPrice(value) {
  const str = clean(value).replace(/[$\s]|MXN|USD/gi, '').replace(/,/g, '');
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// Returns { headers, rows, rowNumbers, images } keeping the file's own header
// text. `rowNumbers[i]` is the sheet row of rows[i]; `images` maps a sheet row
// to the pictures anchored on it (XLSX only; pictures placed over cells).
export async function parseItemFile(buffer, filename, { withImages = false } = {}) {
  const lower = String(filename ?? '').toLowerCase();
  let headers = [];
  const rows = [];
  const rowNumbers = [];
  const images = new Map();
  if (lower.endsWith('.csv')) {
    const records = parseCsv(buffer, { columns: (row) => { headers = row.map(clean); return headers; }, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
    records.forEach((record, i) => { rows.push(record); rowNumbers.push(i + 2); });
  } else if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (sheet) {
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) { row.eachCell((cell, col) => { headers[col - 1] = clean(cell.text); }); return; }
        const record = {};
        row.eachCell((cell, col) => {
          const header = headers[col - 1];
          if (!header) return;
          const link = cell.hyperlink || cell.value?.hyperlink;
          record[header] = cell.value instanceof Date ? isoFromDate(cell.value) : clean(link && /^https?:/i.test(link) ? link : cell.text);
        });
        if (Object.values(record).some(Boolean)) { rows.push(record); rowNumbers.push(rowNumber); }
      });
      for (const image of sheet.getImages()) {
        const sheetRow = Math.floor(image.range?.tl?.nativeRow ?? image.range?.tl?.row ?? -1) + 1;
        if (sheetRow < 2) continue;
        const list = images.get(sheetRow) ?? [];
        if (list.length >= MAX_IMAGES_PER_ROW) continue;
        if (!withImages) { list.push(null); images.set(sheetRow, list); continue; }
        const media = workbook.getImage(Number(image.imageId));
        const ext = String(media?.extension ?? '').toLowerCase();
        if (!media?.buffer || !IMAGE_TYPES[ext]) continue;
        list.push({ buffer: Buffer.from(media.buffer), type: IMAGE_TYPES[ext], name: `foto-fila-${sheetRow}-${list.length + 1}.${ext === 'jpeg' ? 'jpg' : ext}` });
        images.set(sheetRow, list);
      }
    }
  } else {
    throw new InventoryServiceError('Formato no soportado. Usa un archivo CSV o Excel (.xlsx).', 400);
  }
  headers = headers.filter(Boolean);
  if (!headers.length) throw new InventoryServiceError('El archivo no tiene encabezados en la primera fila.', 400);
  if (rows.length > MAX_ITEM_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
  return { headers, rows, rowNumbers, images };
}
