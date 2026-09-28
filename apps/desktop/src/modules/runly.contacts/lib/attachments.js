// AttachmentsPanel config for contact files. Uploads go through the generic
// /files/upload (stored with entityId = company, metadata.sourceEntityId =
// contact), listed back by sourceEntityId. XML/ZIP/RAR are accepted for
// fiscal paperwork.
export const CONTACT_ATTACHMENTS_CONFIG = {
  label: "Archivos",
  listPath: "/files?moduleKey=runly.contacts&entityType=Contact&sourceEntityId=:id&pageSize=100",
  removePath: "/files/:docId",
  createMode: "stage-until-parent-create",
  editMode: "upload-immediately",
  upload: { endpoint: "/files/upload", moduleKey: "runly.contacts", entityType: "Contact" },
  fields: {
    id: "id",
    fileAssetId: "id",
    fileName: "originalName",
    mimeType: "mimeType",
    sizeBytes: "sizeBytes",
    createdAt: "createdAt",
  },
  signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
  limits: { maxFiles: 30, maxSizeMB: 20, allowMultiple: true },
};
