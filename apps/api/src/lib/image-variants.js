// apps/api/src/lib/image-variants.js

// Named image-transform presets applied to Supabase Storage signed/public URLs
// via the imgproxy sidecar (confirmed active on the self-hosted instance —
// see docs/superpowers/specs/2026-08-03-image-thumbnail-variants-design.md).
// `full` means "no transform, serve the original".
export const IMAGE_VARIANTS = Object.freeze({
  thumb: Object.freeze({ width: 40, height: 40, resize: 'cover', quality: 70 }),
  card: Object.freeze({ width: 96, height: 96, resize: 'cover', quality: 75 }),
  banner: Object.freeze({ width: 1600, height: 400, resize: 'cover', quality: 80 }),
  // Forces a height, so it letterboxes/pads into a fixed box — use only where
  // the source image's aspect ratio is known/controlled (e.g. product photos).
  product: Object.freeze({ width: 480, height: 480, resize: 'contain', quality: 80 }),
  // No forced height — scales to fit the width, preserving aspect ratio, no
  // crop and no letterbox. Use for arbitrary-aspect content images where
  // cropping to a fixed box would cut off real content.
  content: Object.freeze({ width: 1600, quality: 80 }),
  full: null,
})

// Exported (not just used internally) so callers that need to route through
// a caching layer — e.g. getCachedSignedUrls in signed-url-cache.js — can
// compute the same transform shape without duplicating the variant lookup.
export function transformOptions(variant) {
  if (variant !== 'full' && !(variant in IMAGE_VARIANTS)) {
    console.warn(`[image-variants] unrecognized variant "${variant}" — serving full resolution`)
  }
  const preset = IMAGE_VARIANTS[variant]
  return preset ? { transform: preset } : {}
}

export async function signedUrlWithVariant(supabaseAdmin, bucket, objectKey, variant, expiresIn = 3600) {
  if (!bucket || !objectKey) return null
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectKey, expiresIn, transformOptions(variant))
  if (error) return null
  return data?.signedUrl ?? null
}

export async function signedUrlsWithVariant(supabaseAdmin, bucket, objectKeys, variant, expiresIn = 3600) {
  if (!bucket || !objectKeys?.length) return []
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrls(objectKeys, expiresIn, transformOptions(variant))
  if (error || !Array.isArray(data)) return objectKeys.map(() => null)
  return data.map((entry) => entry?.signedUrl ?? null)
}

export function publicUrlWithVariant(supabaseAdmin, bucket, objectKey, variant) {
  if (!bucket || !objectKey) return null
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectKey, transformOptions(variant))
  return data?.publicUrl ?? null
}
