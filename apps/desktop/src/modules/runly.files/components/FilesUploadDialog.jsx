import {
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FileUploader,
} from "@runly/ui";

// Uploads made here are private to the uploader unless they opt into sharing
// them with the whole company.
export function FilesUploadDialog({
  open,
  onOpenChange,
  onUploadMany,
  disabled,
  shareWithCompany,
  onShareWithCompanyChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subir archivos</DialogTitle>
          <DialogDescription>
            Los archivos que subas son privados: solo tú y las personas que
            invites pueden verlos.
          </DialogDescription>
        </DialogHeader>
        <CheckboxField
          id="files-share-with-company"
          label="Compartir con toda la empresa"
          hint="Cualquier persona de la empresa con acceso a Archivos podrá verlos."
          checked={shareWithCompany}
          onChange={(event) => onShareWithCompanyChange(event.target.checked)}
          disabled={disabled}
        />
        <FileUploader
          multiple
          onUploadMany={onUploadMany}
          maxSizeMB={10}
          accept="image/*,application/pdf,text/*,.csv,.xlsx,.doc,.docx,.pptx,.md"
          disabled={disabled}
        />
      </DialogContent>
    </Dialog>
  );
}
