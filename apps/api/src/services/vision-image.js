import sharp from 'sharp';

// Shared by receipt and inventory extraction. Originals are kept for review.
export async function prepareVisionImage(buf) {
  let out;
  for (const quality of [85, 70, 55, 40]) {
    out = await sharp(buf, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (out.length <= 3 * 1024 * 1024) return out;
  }
  throw new Error('La imagen es demasiado grande. Recorta la etiqueta e intenta de nuevo.');
}
