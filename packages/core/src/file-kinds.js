// Single source of truth for file-type classification, shared by the API
// (Prisma where-clauses) and the desktop app (list rendering + filters).

export const FILE_KINDS = Object.freeze({
  image: { label: 'Imagen', accent: '#0d9488', accentDark: '#2dd4bf', mimePrefixes: ['image/'], mimeTypes: [], extensions: [] },
  // mimeTypes/extensions cover HLS manifests (runly.chat call recordings —
  // ChatRecordingsGallery.jsx/AdvancedFileViewer.jsx), which aren't a
  // video/* mime type themselves even though they render as video.
  video: {
    label: 'Video', accent: '#7c3aed', accentDark: '#a78bfa',
    mimePrefixes: ['video/'], mimeTypes: ['application/vnd.apple.mpegurl', 'application/x-mpegurl'], extensions: ['m3u8'],
  },
  audio: { label: 'Audio', accent: '#db2777', accentDark: '#f472b6', mimePrefixes: ['audio/'], mimeTypes: [], extensions: [] },
  pdf: { label: 'PDF', accent: '#dc2626', accentDark: '#f87171', mimePrefixes: [], mimeTypes: ['application/pdf'], extensions: ['pdf'] },
  csv: {
    label: 'CSV', accent: '#0f7b6c', accentDark: '#5bbfae',
    mimePrefixes: [], mimeTypes: ['text/csv', 'application/csv'], extensions: ['csv', 'tsv'],
  },
  sheet: {
    label: 'Hoja de cálculo', accent: '#107c41', accentDark: '#57c78e',
    mimePrefixes: ['application/vnd.openxmlformats-officedocument.spreadsheetml'],
    mimeTypes: ['application/vnd.ms-excel'], extensions: ['xlsx', 'xls'],
  },
  doc: {
    label: 'Documento', accent: '#185abd', accentDark: '#6aa5f8',
    mimePrefixes: ['application/vnd.openxmlformats-officedocument.wordprocessingml'],
    mimeTypes: ['application/msword'], extensions: ['docx', 'doc'],
  },
  presentation: {
    label: 'Presentación', accent: '#b7472a', accentDark: '#f69d82',
    mimePrefixes: ['application/vnd.openxmlformats-officedocument.presentationml'],
    mimeTypes: ['application/vnd.ms-powerpoint'], extensions: ['pptx', 'ppt'],
  },
  archive: {
    label: 'Comprimido', accent: '#a16207', accentDark: '#d4a017',
    mimePrefixes: [],
    mimeTypes: ['application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed', 'application/gzip', 'application/x-tar'],
    extensions: ['zip', '7z', 'rar', 'gz', 'tar'],
  },
  text: {
    label: 'Texto', accent: '#475569', accentDark: '#94a3b8',
    mimePrefixes: ['text/'], mimeTypes: ['application/json'], extensions: ['txt', 'md', 'log', 'json'],
  },
  generic: { label: 'Archivo', accent: '#64748b', accentDark: '#94a3b8', mimePrefixes: [], mimeTypes: [], extensions: [] },
});

// Evaluation priority. csv before sheet/text so a .csv with a spreadsheet or
// text/plain mime still lands on csv. generic is the fallback, never matched here.
const KIND_PRIORITY = ['image', 'video', 'audio', 'pdf', 'csv', 'sheet', 'doc', 'presentation', 'archive', 'text'];

function extensionOf(name = '') {
  const clean = String(name || '').trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  return dot > 0 && dot < clean.length - 1 ? clean.slice(dot + 1) : '';
}

export function fileKindOf(file = {}) {
  const mime = String(file?.mimeType || '').toLowerCase().split(';')[0].trim();
  const ext = extensionOf(file?.originalName ?? file?.fileName ?? file?.name ?? '');
  const genericMime = !mime || mime === 'application/octet-stream';

  for (const kind of KIND_PRIORITY) {
    const def = FILE_KINDS[kind];
    if (kind === 'text' && (ext === 'csv' || ext === 'tsv')) continue;
    if (!genericMime && def.mimeTypes.includes(mime)) return kind;
    if (!genericMime && def.mimePrefixes.some((p) => mime.startsWith(p))) return kind;
    if (ext && def.extensions.includes(ext)) return kind;
  }
  return 'generic';
}

export function fileKindLabel(kind) {
  return FILE_KINDS[kind]?.label ?? FILE_KINDS.generic.label;
}

export function fileKindAccent(kind, { dark = false } = {}) {
  const def = FILE_KINDS[kind] ?? FILE_KINDS.generic;
  return dark ? def.accentDark : def.accent;
}

// Prisma where-clause per kind, MIME-only (the DB has no separate extension
// column; the server keeps its historical mime-only selectivity, the client
// additionally uses the extension fallback in fileKindOf).
export function fileKindWhereClauses() {
  const mimeClause = (def) => {
    const parts = [
      ...def.mimeTypes.map((m) => ({ mimeType: m })),
      ...def.mimePrefixes.map((p) => ({ mimeType: { startsWith: p } })),
    ];
    return parts.length === 1 ? parts[0] : { OR: parts };
  };
  const clauses = {};
  for (const [kind, def] of Object.entries(FILE_KINDS)) {
    if (kind === 'generic') continue;
    if (kind === 'text') {
      clauses.text = {
        AND: [
          { OR: [{ mimeType: { startsWith: 'text/' } }, { mimeType: 'application/json' }] },
          { NOT: { mimeType: 'text/csv' } },
        ],
      };
      continue;
    }
    clauses[kind] = mimeClause(def);
  }
  return clauses;
}
