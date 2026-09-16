import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withImageVariant, IMAGE_VARIANT_PRESETS } from '../imageVariants.js';

const PUBLIC_URL = 'https://supabase.racoondevs.com/storage/v1/object/public/runly-notes/notes/u1/n1/123-cover.jpg';

test('rewrites a public object URL to the render/image path with the preset query params', () => {
  const result = withImageVariant(PUBLIC_URL, 'banner');
  assert.equal(
    result,
    'https://supabase.racoondevs.com/storage/v1/render/image/public/runly-notes/notes/u1/n1/123-cover.jpg?width=1600&height=400&resize=cover&quality=80',
  );
});

test('returns the original URL unchanged for the full variant', () => {
  assert.equal(withImageVariant(PUBLIC_URL, 'full'), PUBLIC_URL);
});

test('returns the original URL unchanged for an unrecognized variant', () => {
  assert.equal(withImageVariant(PUBLIC_URL, 'nonsense'), PUBLIC_URL);
});

test('returns null/undefined/empty input unchanged', () => {
  assert.equal(withImageVariant(null, 'banner'), null);
  assert.equal(withImageVariant(undefined, 'banner'), undefined);
  assert.equal(withImageVariant('', 'banner'), '');
});

test('leaves non-Supabase-public-object URLs unchanged (e.g. already-signed or blob URLs)', () => {
  const signedUrl = 'https://supabase.racoondevs.com/storage/v1/object/sign/runly-files/a/b.png?token=xyz';
  assert.equal(withImageVariant(signedUrl, 'banner'), signedUrl);
  const blobUrl = 'blob:http://localhost:5173/abc-123';
  assert.equal(withImageVariant(blobUrl, 'banner'), blobUrl);
});

test('appends the preset query params with & when the URL already has a query string', () => {
  const urlWithQuery = `${PUBLIC_URL}?download=true`;
  const result = withImageVariant(urlWithQuery, 'thumb');
  assert.equal(
    result,
    'https://supabase.racoondevs.com/storage/v1/render/image/public/runly-notes/notes/u1/n1/123-cover.jpg?download=true&width=40&height=40&resize=cover&quality=70',
  );
});

test('IMAGE_VARIANT_PRESETS mirrors the backend presets used for banners', () => {
  assert.deepEqual(IMAGE_VARIANT_PRESETS.banner, { width: 1600, height: 400, resize: 'cover', quality: 80 });
});

test('rewrites a public object URL using the content preset (width-only, no forced crop)', () => {
  const result = withImageVariant(PUBLIC_URL, 'content');
  assert.equal(
    result,
    'https://supabase.racoondevs.com/storage/v1/render/image/public/runly-notes/notes/u1/n1/123-cover.jpg?width=1600&quality=80',
  );
});

test('rewrites a public object URL using the lqip preset (tiny width-only placeholder)', () => {
  const result = withImageVariant(PUBLIC_URL, 'lqip');
  assert.equal(
    result,
    'https://supabase.racoondevs.com/storage/v1/render/image/public/runly-notes/notes/u1/n1/123-cover.jpg?width=24&quality=30',
  );
});
