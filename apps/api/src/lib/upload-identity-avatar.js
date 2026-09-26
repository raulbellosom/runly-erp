// apps/api/src/lib/upload-identity-avatar.js
//
// Shared by the self-service profile avatar upload (PUT /profile/me/avatar,
// still inline in index.js) and the admin-triggered user avatar upload
// (identity-routes.js). Extracted from index.js on 2026-09-25 so
// identity-routes.js doesn't need to import from index.js.
export async function uploadIdentityAvatar({ profileId, file, prisma, supabaseAdmin, bucket }) {
  const ext = file.name.split(".").pop() || "png";
  const objectKey = `modules/atlas-identity/userprofile/${profileId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectKey, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });
  if (uploadError) {
    throw new Error("UPLOAD_FAILED");
  }

  const asset = await prisma.fileAsset.create({
    data: {
      bucket,
      objectKey,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      moduleKey: "runly.identity",
      entityType: "UserProfile",
      entityId: profileId,
    },
  });

  await prisma.userProfile.update({
    where: { id: profileId },
    data: { avatarFileId: asset.id },
  });

  return asset;
}
