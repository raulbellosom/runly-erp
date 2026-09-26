// apps/api/src/lib/signed-url-by-file-id.js
//
// Resolves a single FileAsset id to a signed Storage URL. Shared between the
// self-service profile routes (still inline in index.js) and the identity
// admin avatar routes (identity-routes.js). Extracted from index.js on
// 2026-09-25 so identity-routes.js doesn't need to import from index.js.
import { signedUrlWithVariant } from "./image-variants.js";

export async function getSignedUrlByFileId(fileId, variant = "full", { prisma, supabaseAdmin }) {
  if (!fileId) return null;
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileId },
  });
  if (!fileAsset) return null;
  return signedUrlWithVariant(
    supabaseAdmin,
    fileAsset.bucket,
    fileAsset.objectKey,
    variant,
  );
}
