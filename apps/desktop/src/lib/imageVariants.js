// Mirrors apps/api/src/lib/image-variants.js's IMAGE_VARIANTS — kept separate
// because this one applies to public-bucket URLs already embedded as literal
// strings in note content (no FileAsset id to re-resolve server-side), so the
// rewrite happens client-side instead of via a backend endpoint.
export const IMAGE_VARIANT_PRESETS = {
  thumb: { width: 40, height: 40, resize: 'cover', quality: 70 },
  card: { width: 96, height: 96, resize: 'cover', quality: 75 },
  banner: { width: 1600, height: 400, resize: 'cover', quality: 80 },
  // Forces a height, so it letterboxes/pads into a fixed box — use only where
  // the source image's aspect ratio is known/controlled (e.g. product photos).
  product: { width: 480, height: 480, resize: 'contain', quality: 80 },
  // No forced height — scales to fit the width, preserving aspect ratio, no
  // crop and no letterbox. Use for arbitrary-aspect content images (e.g. note
  // body images) where cropping to a fixed box would cut off real content.
  content: { width: 1600, quality: 80 },
  // Tiny, heavily-compressed version used as a blurred loading placeholder
  // for arbitrary-aspect content images (note body images) — no forced
  // height, same aspect-preserving shape as `content`, just far smaller.
  lqip: { width: 24, quality: 30 },
};

const PUBLIC_OBJECT_PATH = '/storage/v1/object/public/';
const RENDER_IMAGE_PUBLIC_PATH = '/storage/v1/render/image/public/';

export function withImageVariant(publicUrl, variant) {
  if (!publicUrl) return publicUrl;
  if (variant === 'full') return publicUrl;
  const preset = IMAGE_VARIANT_PRESETS[variant];
  if (!preset) return publicUrl;
  if (!publicUrl.includes(PUBLIC_OBJECT_PATH)) return publicUrl;

  const rewritten = publicUrl.replace(PUBLIC_OBJECT_PATH, RENDER_IMAGE_PUBLIC_PATH);
  const separator = rewritten.includes('?') ? '&' : '?';
  const params = { width: String(preset.width) };
  if (preset.height !== undefined) params.height = String(preset.height);
  if (preset.resize !== undefined) params.resize = preset.resize;
  params.quality = String(preset.quality);
  const query = new URLSearchParams(params);
  return `${rewritten}${separator}${query.toString()}`;
}
