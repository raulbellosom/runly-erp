import { parentPort, workerData } from 'node:worker_threads';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';

try {
  let text = '';
  let truncated = false;
  if (workerData.kind === 'docx') {
    const zip = await JSZip.loadAsync(workerData.buffer);
    const document = zip.file('word/document.xml');
    if (!document) throw new Error('Invalid Word document');
    const xml = await document.async('string');
    if (xml.length > 5000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Document too complex');
    const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false }).parse(xml);
    const visit = node => {
      if (text.length > 12000) { truncated = true; return; }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'w:t') text += `${Array.isArray(value) ? value.join(' ') : value} `;
        else if (Array.isArray(value)) value.forEach(visit);
        else visit(value);
      }
    };
    visit(parsed);
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workerData.buffer);
    truncated = workbook.worksheets.length > 10;
    for (const sheet of workbook.worksheets.slice(0, 10)) {
      text += `\nHoja: ${sheet.name}\n`;
      if (sheet.rowCount > 500 || sheet.columnCount > 50) truncated = true;
      for (let row = 1; row <= Math.min(sheet.rowCount, 500); row++) {
        text += Array.from({ length: Math.min(sheet.columnCount, 50) }, (_, i) => sheet.getRow(row).getCell(i + 1).text).join(' | ') + '\n';
        if (text.length > 12000) { truncated = true; break; }
      }
      if (text.length > 12000) break;
    }
  }
  parentPort.postMessage({ text: text.slice(0, 12000), truncated, empty: !text.trim() });
} catch { parentPort.postMessage({ error: true }); }
