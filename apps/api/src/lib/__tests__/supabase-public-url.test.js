// apps/api/src/lib/__tests__/supabase-public-url.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvePublicSupabaseUrl,
  toPublicSupabaseUrl,
  wrapStorageForPublicUrls,
} from '../supabase-public-url.js'

const env = {
  SUPABASE_URL: 'http://supabase-kong:8000',
  RUNLY_SUPABASE_PUBLIC_URL: 'https://supabase.example.com',
}

function fakeSupabaseAdmin({ signedUrl, signedUrls = null, publicUrl } = {}) {
  const calls = { createSignedUrl: [], createSignedUrls: [], getPublicUrl: [], upload: [] }
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async upload(objectKey, body, options) {
            calls.upload.push({ bucket, objectKey, body, options })
            return { data: { path: objectKey }, error: null }
          },
          async createSignedUrl(objectKey, expiresIn, options) {
            calls.createSignedUrl.push({ bucket, objectKey, expiresIn, options })
            return { data: { signedUrl: signedUrl ?? `${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${objectKey}?token=abc.def.ghi` }, error: null }
          },
          async createSignedUrls(objectKeys, expiresIn, options) {
            calls.createSignedUrls.push({ bucket, objectKeys, expiresIn, options })
            return {
              data: signedUrls ?? objectKeys.map((path) => ({
                path,
                signedUrl: `${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}?token=tok-${path}`,
              })),
              error: null,
            }
          },
          getPublicUrl(objectKey) {
            calls.getPublicUrl.push({ bucket, objectKey })
            return { data: { publicUrl: publicUrl ?? `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectKey}` } }
          },
        }
      },
    },
  }
}

describe('resolvePublicSupabaseUrl', () => {
  it('prefers RUNLY_SUPABASE_PUBLIC_URL when set', () => {
    assert.equal(resolvePublicSupabaseUrl(env), 'https://supabase.example.com')
  })

  it('falls back to SUPABASE_URL when no public URL is configured (dev without a public domain)', () => {
    assert.equal(resolvePublicSupabaseUrl({ SUPABASE_URL: 'http://localhost:8000' }), 'http://localhost:8000')
  })

  it('strips a trailing slash', () => {
    assert.equal(resolvePublicSupabaseUrl({ RUNLY_SUPABASE_PUBLIC_URL: 'https://supabase.example.com/' }), 'https://supabase.example.com')
  })
})

describe('toPublicSupabaseUrl', () => {
  it('rewrites only the origin of an internal signed URL, preserving path, token and query params', () => {
    const signed = 'http://supabase-kong:8000/storage/v1/object/sign/runly-files/modules/a/b.png?token=eyJhbGciOiJIUzI1NiJ9.abc.def&width=200'
    const result = toPublicSupabaseUrl(signed, env)
    assert.equal(result, 'https://supabase.example.com/storage/v1/object/sign/runly-files/modules/a/b.png?token=eyJhbGciOiJIUzI1NiJ9.abc.def&width=200')
  })

  it('leaves a URL that does not point at the internal Supabase host untouched', () => {
    const other = 'https://cdn.example.com/some/asset.png?x=1'
    assert.equal(toPublicSupabaseUrl(other, env), other)
  })

  it('is a no-op when RUNLY_SUPABASE_PUBLIC_URL is not configured', () => {
    const signed = 'http://supabase-kong:8000/storage/v1/object/sign/runly-files/a.png?token=tok'
    assert.equal(toPublicSupabaseUrl(signed, { SUPABASE_URL: env.SUPABASE_URL }), signed)
  })

  it('passes through null/undefined without throwing', () => {
    assert.equal(toPublicSupabaseUrl(null, env), null)
    assert.equal(toPublicSupabaseUrl(undefined, env), undefined)
  })
})

describe('wrapStorageForPublicUrls', () => {
  it('rewrites createSignedUrl results to the public domain while uploads still target the internal client', async () => {
    const client = fakeSupabaseAdmin()
    const wrapped = wrapStorageForPublicUrls(client, env)

    await wrapped.storage.from('runly-files').upload('a/b.png', Buffer.from('x'), {})
    assert.equal(client.calls.upload[0].bucket, 'runly-files')

    const { data } = await wrapped.storage.from('runly-files').createSignedUrl('a/b.png', 3600)
    assert.match(data.signedUrl, /^https:\/\/supabase\.example\.com\//)
    assert.match(data.signedUrl, /token=abc\.def\.ghi$/)
    assert.doesNotMatch(data.signedUrl, /supabase-kong/)
  })

  it('preserves the signed token exactly when rewriting the origin', async () => {
    const client = fakeSupabaseAdmin({
      signedUrl: 'http://supabase-kong:8000/storage/v1/object/sign/runly-files/doc.pdf?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
    })
    const wrapped = wrapStorageForPublicUrls(client, env)
    const { data } = await wrapped.storage.from('runly-files').createSignedUrl('doc.pdf', 3600)
    const token = new URL(data.signedUrl).searchParams.get('token')
    assert.equal(token, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')
  })

  it('rewrites every entry returned by createSignedUrls (bulk download)', async () => {
    const client = fakeSupabaseAdmin()
    const wrapped = wrapStorageForPublicUrls(client, env)
    const { data } = await wrapped.storage.from('runly-files').createSignedUrls(['a.png', 'b.png'], 3600)
    for (const entry of data) {
      assert.match(entry.signedUrl, /^https:\/\/supabase\.example\.com\//)
    }
  })

  it('rewrites getPublicUrl results (public bucket / logos / storefront)', () => {
    const client = fakeSupabaseAdmin()
    const wrapped = wrapStorageForPublicUrls(client, env)
    const { data } = wrapped.storage.from('runly-website').getPublicUrl('logo.png')
    assert.equal(data.publicUrl, 'https://supabase.example.com/storage/v1/object/public/runly-website/logo.png')
  })

  it('is a no-op when RUNLY_SUPABASE_PUBLIC_URL is unset (dev without a public domain)', async () => {
    const client = fakeSupabaseAdmin()
    const wrapped = wrapStorageForPublicUrls(client, { SUPABASE_URL: env.SUPABASE_URL })
    const { data } = await wrapped.storage.from('runly-files').createSignedUrl('a.png', 3600)
    assert.match(data.signedUrl, /^http:\/\/supabase-kong:8000\//)
  })
})
