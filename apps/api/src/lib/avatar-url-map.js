// apps/api/src/lib/avatar-url-map.js
//
// Batch-resolves FileAsset ids to signed URLs, grouped by Storage bucket to
// minimize signing calls. Shared between the identity routes (still inline
// in index.js) and hr-routes.js's org chart — extracted on 2026-09-25 so
// hr-routes.js doesn't need to import from index.js. Cached, not
// signedUrlsWithVariant directly — this feeds GET /identity/users and
// GET /identity/users/:id, both refetched on window focus (TanStack Query's
// default). A fresh signature per avatar per refocus broke structural
// sharing on those queries' data, forcing a full re-render of the user
// list/detail screen each time — the same "glassic flicker" root cause
// already fixed for /memberships/me's company logos, recurring here for
// user avatars.
import { getCachedSignedUrls } from "./signed-url-cache.js";
import { transformOptions as imageVariantTransformOptions } from "./image-variants.js";

export async function buildAvatarUrlMapByFileIds(fileIds, variant = "thumb", { prisma, supabaseAdmin }) {
  const avatarUrlMap = new Map();
  if (!fileIds.length) return avatarUrlMap;

  const fileAssets = await prisma.fileAsset.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, bucket: true, objectKey: true },
  });
  const byBucket = new Map();
  for (const asset of fileAssets) {
    if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
    byBucket.get(asset.bucket).push(asset);
  }
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, assets]) => {
      const paths = assets.map((asset) => asset.objectKey);
      const signedByPath = await getCachedSignedUrls(
        supabaseAdmin,
        bucket,
        paths,
        3600,
        imageVariantTransformOptions(variant),
      );
      assets.forEach((asset) => {
        avatarUrlMap.set(asset.id, signedByPath.get(asset.objectKey) ?? null);
      });
    }),
  );

  return avatarUrlMap;
}
