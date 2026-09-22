import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileKindOf,
  fileKindLabel,
  fileKindAccent,
  fileKindWhereClauses,
} from '../file-kinds.js';

test('fileKindOf resolves by exact mime type', () => {
  assert.equal(fileKindOf({ originalName: 'a.pdf', mimeType: 'application/pdf' }), 'pdf');
  assert.equal(fileKindOf({ originalName: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'doc');
  assert.equal(fileKindOf({ originalName: 'a.xls', mimeType: 'application/vnd.ms-excel' }), 'sheet');
});

test('fileKindOf resolves by mime prefix', () => {
  assert.equal(fileKindOf({ originalName: 'p.heic', mimeType: 'image/heic' }), 'image');
  assert.equal(fileKindOf({ originalName: 'clip.mkv', mimeType: 'video/x-matroska' }), 'video');
  assert.equal(fileKindOf({ originalName: 'song.flac', mimeType: 'audio/flac' }), 'audio');
});

test('fileKindOf resolves HLS manifests (call recordings) as video', () => {
  assert.equal(fileKindOf({ originalName: 'grabacion.m3u8', mimeType: 'application/vnd.apple.mpegurl' }), 'video');
  assert.equal(fileKindOf({ originalName: 'grabacion.m3u8', mimeType: '' }), 'video');
});

test('fileKindOf falls back to extension when mime is generic or empty', () => {
  assert.equal(fileKindOf({ originalName: 'ledger.csv', mimeType: 'text/plain' }), 'csv');
  assert.equal(fileKindOf({ originalName: 'ledger.csv', mimeType: 'application/octet-stream' }), 'csv');
  assert.equal(fileKindOf({ originalName: 'ledger.csv', mimeType: '' }), 'csv');
  assert.equal(fileKindOf({ originalName: 'data.tsv', mimeType: '' }), 'csv');
  assert.equal(fileKindOf({ originalName: 'notes.md', mimeType: '' }), 'text');
  assert.equal(fileKindOf({ originalName: 'archive.zip', mimeType: 'application/octet-stream' }), 'archive');
});

test('fileKindOf: csv wins over sheet/text even with a spreadsheet mime', () => {
  assert.equal(fileKindOf({ originalName: 'x.csv', mimeType: 'application/vnd.ms-excel' }), 'csv');
});

test('fileKindOf: text kind excludes csv/tsv', () => {
  assert.equal(fileKindOf({ originalName: 'x.csv', mimeType: 'text/csv' }), 'csv');
});

test('fileKindOf returns generic for the unknown', () => {
  assert.equal(fileKindOf({ originalName: 'firmware.bin', mimeType: 'application/octet-stream' }), 'generic');
  assert.equal(fileKindOf({}), 'generic');
});

test('fileKindLabel and fileKindAccent', () => {
  assert.equal(fileKindLabel('csv'), 'CSV');
  assert.equal(fileKindLabel('presentation'), 'Presentación');
  assert.equal(fileKindLabel('nonsense'), 'Archivo');
  assert.match(fileKindAccent('sheet'), /^#[0-9a-f]{6}$/i);
  assert.notEqual(fileKindAccent('doc', { dark: true }), fileKindAccent('doc', { dark: false }));
});

test('fileKindWhereClauses exposes a csv clause and keeps csv out of sheet/text', () => {
  const clauses = fileKindWhereClauses();
  assert.ok(clauses.csv, 'csv clause exists');
  const sheetJson = JSON.stringify(clauses.sheet);
  assert.ok(!sheetJson.includes('text/csv'), 'sheet no longer matches text/csv');
  const textJson = JSON.stringify(clauses.text);
  assert.ok(textJson.includes('text/csv'), 'text still explicitly excludes text/csv');
});
