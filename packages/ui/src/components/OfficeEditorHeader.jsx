import { ArrowLeft, Check, Download, FileText, Loader2, LockKeyhole, Save, TriangleAlert } from 'lucide-react';
import { Button } from './Button.jsx';
import { PageHeader } from './PageHeader.jsx';
import './OfficeEditorHeader.css';

const EDITORS = ['docx', 'xlsx', 'pptx'];

export function OfficeEditorHeader({ fileName, mode, ready, dirty, saving, saved, error, onBack, onDownload }) {
  const extension = fileName?.split('.').pop().toLowerCase();
  const format = EDITORS.includes(extension) ? extension : 'default';
  const readOnly = ready && mode !== 'edit';
  let status = { label: ready ? 'Listo para editar' : 'Abriendo documento…', Icon: ready ? FileText : Loader2 };
  if (readOnly) status = { label: 'Solo lectura', Icon: LockKeyhole };
  else if (saving) status = { label: 'Guardando…', Icon: Loader2 };
  else if (dirty) status = { label: 'Cambios sin guardar', Icon: Save };
  else if (saved) status = { label: 'Guardado', Icon: Check };
  if (error) status = { label: 'Requiere atención', Icon: TriangleAlert };
  const StatusIcon = status.Icon;

  return (
    <header className="office-editor-header" data-format={format} aria-label="Documento en Runly ERP">
      <div className="office-editor-header-main">
        <Button variant="ghost" className="office-editor-back" onClick={onBack} disabled={saving} aria-label="Volver a Runly ERP" title="Volver a Runly ERP">
          <ArrowLeft aria-hidden="true" />
          <img className="office-editor-logo dark:hidden" src="/runly/runly-isotipo-light.png" width="24" height="24" alt="" />
          <img className="office-editor-logo hidden dark:block" src="/runly/runly-isotipo-dark.png" width="24" height="24" alt="" />
          <span className="office-editor-back-label">Runly ERP</span>
        </Button>
        <div className="office-editor-document">
          <PageHeader compact className="office-editor-heading" title={<span title={fileName}>{fileName ?? 'Preparando documento…'}</span>} />
        </div>
        <span className="office-editor-status" role="status" aria-live="polite" aria-atomic="true" title={status.label}>
          <StatusIcon className={StatusIcon === Loader2 ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />
          <span className="office-editor-status-label">{status.label}</span>
        </span>
        {onDownload && <Button variant="ghost" className="office-editor-action" onClick={onDownload} disabled={!fileName || saving} aria-label="Descargar versión guardada" title="Descargar la última versión guardada">
          <Download aria-hidden="true" />
        </Button>}
      </div>
    </header>
  );
}
