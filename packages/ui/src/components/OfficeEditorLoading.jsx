import { Check, FileText, FileSpreadsheet, Presentation, Loader2 } from 'lucide-react';
import './OfficeEditorLoading.css';

const FORMATS = {
  docx: { Icon: FileText, label: 'Documento' },
  xlsx: { Icon: FileSpreadsheet, label: 'Hoja de cálculo' },
  pptx: { Icon: Presentation, label: 'Presentación' },
};

export function OfficeEditorLoading({ fileName, sessionReady = false }) {
  const extension = fileName?.split('.').pop().toLowerCase();
  const format = Object.hasOwn(FORMATS, extension) ? extension : 'default';
  const { Icon, label } = FORMATS[format] ?? { Icon: FileText, label: 'Office' };

  return (
    <div className="office-loading" data-format={format} role="status" aria-live="polite" aria-atomic="true">
      <div className="office-loading-content">
        <div className="office-loading-art" aria-hidden="true">
          <div className="office-loading-orbit" />
          <div className="office-loading-sheet office-loading-sheet-back" />
          <div className="office-loading-sheet office-loading-sheet-front">
            <div className="office-loading-sheet-heading"><Icon /><span>{label}</span></div>
            <div className="office-loading-preview"><i /><i /><i /><i /><i /><i /></div>
            <span className="office-loading-sheet-scan" />
          </div>
          <div className="office-loading-brand">
            <img src="/runly/runly-isotipo-light.png" width="48" height="48" alt="" className="dark:hidden" />
            <img src="/runly/runly-isotipo-dark.png" width="48" height="48" alt="" className="hidden dark:block" />
          </div>
          <span className="office-loading-spark office-loading-spark-one" />
          <span className="office-loading-spark office-loading-spark-two" />
        </div>
        <p className="office-loading-eyebrow">RUNLY ERP <span>/</span> DOCUMENTOS</p>
        <h2>{sessionReady ? 'Abriendo tu documento' : 'Preparando tu espacio'}</h2>
        <p className="office-loading-description">{sessionReady ? 'Estamos cargando el contenido en el editor.' : 'Estamos conectando con el editor de documentos.'}</p>
        {fileName && <div className="office-loading-filename" title={fileName}><Icon aria-hidden="true" /><span>{fileName}</span></div>}
        <div className="office-loading-track" aria-hidden="true"><span /></div>
        <div className="office-loading-steps" aria-hidden="true">
          <span data-active={!sessionReady}>{sessionReady ? <Check /> : <Loader2 className="office-loading-spin" />} Sesión</span>
          <span className="office-loading-step-line" />
          <span data-active={sessionReady}>{sessionReady ? <Loader2 className="office-loading-spin" /> : <Icon />} Documento</span>
        </div>
      </div>
    </div>
  );
}
