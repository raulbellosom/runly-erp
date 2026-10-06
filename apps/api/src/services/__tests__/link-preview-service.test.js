import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkPreview, createLinkPreviewService } from '../link-preview-service.js';

describe('parseLinkPreview', () => {
  it('extracts Open Graph metadata and resolves a relative image', () => {
    const html = `<html><head>
      <meta property="og:title" content="Caf&eacute; &amp; Pan">
      <meta content="Una   descripcion" property="og:description" />
      <meta property="og:image" content="/img/cover.jpg">
      <title>Ignorado</title></head></html>`;
    const p = parseLinkPreview(html, 'https://www.ejemplo.test/a/b');
    assert.equal(p.title, 'Caf&eacute; & Pan');
    assert.equal(p.description, 'Una descripcion');
    assert.equal(p.image, 'https://www.ejemplo.test/img/cover.jpg');
    assert.equal(p.siteName, 'ejemplo.test');
  });

  it('falls back to <title> and returns null when nothing is usable', () => {
    assert.equal(parseLinkPreview('<title>Hola</title>', 'https://x.test/').title, 'Hola');
    assert.equal(parseLinkPreview('<p>nada</p>', 'https://x.test/'), null);
  });

  it('never fetches internal addresses', async () => {
    let called = false;
    const svc = createLinkPreviewService({ fetchImpl: async () => { called = true; } });
    assert.equal(await svc.getPreview('http://127.0.0.1:4010/health'), null);
    assert.equal(called, false);
  });
});
