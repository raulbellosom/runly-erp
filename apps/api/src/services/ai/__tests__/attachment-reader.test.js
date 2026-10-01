import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { createAttachmentReader, AttachmentReaderError } from '../attachment-reader.js';

test('reads a .txt attachment as plain text', async () => {
  const reader = createAttachmentReader();
  const out = await reader.read({ buffer: Buffer.from('serie: A-001'), name: 'nota.txt', mimeType: 'text/plain' });
  assert.equal(out.text, 'serie: A-001');
  assert.equal(out.truncated, false);
  assert.equal(out.preview, null);
});

test('reads a .csv attachment as plain text', async () => {
  const reader = createAttachmentReader();
  const out = await reader.read({ buffer: Buffer.from('modelo,serie\nDEMO,A-001'), name: 'equipos.csv', mimeType: 'text/csv' });
  assert.match(out.text, /DEMO,A-001/);
});

test('rejects a file over 10 MB', async () => {
  const reader = createAttachmentReader();
  await assert.rejects(
    reader.read({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), name: 'grande.txt' }),
    (err) => err instanceof AttachmentReaderError && err.status === 400,
  );
});

test('rejects an unsupported extension (.exe)', async () => {
  const reader = createAttachmentReader();
  await assert.rejects(
    reader.read({ buffer: Buffer.from('MZ'), name: 'programa.exe' }),
    (err) => err instanceof AttachmentReaderError && /Formatos admitidos/.test(err.message),
  );
});

test('rejects an empty buffer', async () => {
  const reader = createAttachmentReader();
  await assert.rejects(reader.read({ buffer: Buffer.alloc(0), name: 'vacio.txt' }), (err) => err.status === 400);
});

test('reads a real DOCX/XLSX while preserving serial identifiers, and rejects a disguised or XXE-laced DOCX', async () => {
  const reader = createAttachmentReader();
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="test"><w:body><w:p><w:r><w:t>Modelo DEMO Serial O0-I1-B8</w:t></w:r></w:p></w:body></w:document>');
  const docxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Equipos');
  sheet.addRow(['Modelo', 'Serie']); sheet.addRow(['DEMO', '00-I1-B8']);
  const xlsxBuffer = await book.xlsx.writeBuffer();

  const docxOut = await reader.read({ buffer: docxBuffer, name: 'equipos.docx' });
  assert.match(docxOut.text, /O0-I1-B8/);
  const xlsxOut = await reader.read({ buffer: Buffer.from(xlsxBuffer), name: 'equipos.xlsx' });
  assert.match(xlsxOut.text, /00-I1-B8/);

  await assert.rejects(reader.read({ buffer: Buffer.from('fake zip'), name: 'fake.docx' }), (err) => err.status === 400);

  zip.file('word/document.xml', '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///secret">]><w:t>&x;</w:t>');
  const xxeBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(reader.read({ buffer: xxeBuffer, name: 'bad.docx' }), (err) => err.status === 400);
});

test('uses the injected vision service for images and returns a thumbnail preview', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let received;
  const reader = createAttachmentReader({ vision: { describeImage: async (args) => { received = args; return { description: 'Serie A-001' }; } } });
  const out = await reader.read({ buffer: png, name: 'etiqueta.png', mimeType: 'image/png', question: 'que dice' });
  assert.ok(received.imageBase64);
  assert.equal(received.mimeType, 'image/jpeg');
  assert.match(out.text, /A-001/);
  assert.match(out.preview, /^data:image\/jpeg;base64,/);
});
