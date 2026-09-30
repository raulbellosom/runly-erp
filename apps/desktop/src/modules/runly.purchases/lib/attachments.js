// AttachmentsPanel config over the generic files stack (spec section 6):
// entity types purchase_order, purchase_invoice, purchase_receipt,
// purchase_quote, purchase_request. Invoice PDF/XML are plain attachments.
export function attachmentsConfig(entityType) {
  return {
    label: 'Archivos',
    listPath: `/files?moduleKey=runly.purchases&entityType=${entityType}&sourceEntityId=:id&pageSize=100`,
    removePath: '/files/:docId',
    createMode: 'stage-until-parent-create',
    editMode: 'upload-immediately',
    upload: { endpoint: '/files/upload', moduleKey: 'runly.purchases', entityType },
    fields: { id: 'id', fileAssetId: 'id', fileName: 'originalName', mimeType: 'mimeType', sizeBytes: 'sizeBytes', createdAt: 'createdAt' },
    signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
    limits: { maxFiles: 30, maxSizeMB: 20, allowMultiple: true },
  }
}
