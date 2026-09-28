import { useEffect, useMemo, useState } from "react";
import { FileArchive, FileCode2, Folder, Loader2 } from "lucide-react";
import { formatBytes } from "../lib/file-kind.js";

const MAX_XML_BYTES = 3 * 1024 * 1024;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

function useFetched(url, as) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return as === "text" ? res.text() : res.arrayBuffer();
      })
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((error) => !cancelled && setState({ loading: false, data: null, error }));
    return () => {
      cancelled = true;
    };
  }, [url, as]);
  return state;
}

function PanelShell({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="absolute inset-0 overflow-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">{title}</p>
            {subtitle && <p className="text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 text-sm text-[hsl(var(--muted-foreground))]">
      {children}
    </div>
  );
}

// ─── XML ────────────────────────────────────────────────────────────────

function prettyXml(doc) {
  const lines = [];
  const walk = (node, depth) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === 3) {
      const text = node.nodeValue.trim();
      if (text) lines.push(pad + text);
      return;
    }
    if (node.nodeType !== 1) return;
    const attrs = Array.from(node.attributes).map((a) => ` ${a.name}="${a.value}"`).join("");
    const children = Array.from(node.childNodes).filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()));
    if (!children.length) {
      lines.push(`${pad}<${node.nodeName}${attrs} />`);
      return;
    }
    lines.push(`${pad}<${node.nodeName}${attrs}>`);
    children.forEach((child) => walk(child, depth + 1));
    lines.push(`${pad}</${node.nodeName}>`);
  };
  walk(doc.documentElement, 0);
  return lines.join("\n");
}

const CFDI_TYPES = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };

function byLocalName(doc, name) {
  return Array.from(doc.getElementsByTagName("*")).find((el) => el.localName === name) ?? null;
}

// Extracts the headline fields of a CFDI (3.3 / 4.0) when the XML is one.
export function readCfdiSummary(doc) {
  const root = doc?.documentElement;
  if (!root || root.localName !== "Comprobante") return null;
  const emisor = byLocalName(doc, "Emisor");
  const receptor = byLocalName(doc, "Receptor");
  const timbre = byLocalName(doc, "TimbreFiscalDigital");
  const get = (el, attr) => el?.getAttribute(attr) ?? null;
  const total = Number(get(root, "Total"));
  return {
    version: get(root, "Version"),
    type: CFDI_TYPES[get(root, "TipoDeComprobante")] ?? get(root, "TipoDeComprobante"),
    serieFolio: [get(root, "Serie"), get(root, "Folio")].filter(Boolean).join("-") || null,
    date: get(root, "Fecha"),
    total: Number.isFinite(total)
      ? total.toLocaleString("es-MX", { style: "currency", currency: get(root, "Moneda") === "USD" ? "USD" : "MXN" })
      : null,
    currency: get(root, "Moneda"),
    emisorRfc: get(emisor, "Rfc"),
    emisorName: get(emisor, "Nombre"),
    receptorRfc: get(receptor, "Rfc"),
    receptorName: get(receptor, "Nombre"),
    usoCfdi: get(receptor, "UsoCFDI"),
    uuid: get(timbre, "UUID"),
  };
}

function Field({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className={`mt-0.5 break-words text-sm text-[hsl(var(--foreground))] ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export function XmlPreview({ url, file }) {
  const tooBig = (file?.sizeBytes ?? 0) > MAX_XML_BYTES;
  const { loading, data, error } = useFetched(tooBig ? null : url, "text");

  const parsed = useMemo(() => {
    if (!data) return null;
    const doc = new DOMParser().parseFromString(data, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return { raw: data, cfdi: null };
    return { raw: prettyXml(doc), cfdi: readCfdiSummary(doc) };
  }, [data]);

  if (tooBig) return <Centered>El XML es demasiado grande para previsualizarlo. Descárgalo para abrirlo.</Centered>;
  if (loading) return <Centered><Loader2 className="h-5 w-5 animate-spin" /></Centered>;
  if (error || !parsed) return <Centered>No se pudo leer el XML.</Centered>;

  const { cfdi } = parsed;
  return (
    <PanelShell
      icon={FileCode2}
      title={file?.originalName ?? "XML"}
      subtitle={cfdi ? `CFDI ${cfdi.version ?? ""} · ${cfdi.type ?? ""}` : "Documento XML"}
    >
      {cfdi && (
        <div className="grid gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:grid-cols-2">
          <Field label="Emisor" value={[cfdi.emisorName, cfdi.emisorRfc].filter(Boolean).join(" · ")} />
          <Field label="Receptor" value={[cfdi.receptorName, cfdi.receptorRfc].filter(Boolean).join(" · ")} />
          <Field label="Total" value={cfdi.total} />
          <Field label="Fecha" value={cfdi.date?.replace("T", " ")} />
          <Field label="Serie / folio" value={cfdi.serieFolio} />
          <Field label="Uso de CFDI" value={cfdi.usoCfdi} />
          <Field label="Folio fiscal (UUID)" value={cfdi.uuid} mono />
        </div>
      )}
      <pre className="max-h-[60vh] overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-4 text-xs leading-relaxed text-[hsl(var(--foreground))]">
        {parsed.raw}
      </pre>
    </PanelShell>
  );
}

// ─── ZIP ────────────────────────────────────────────────────────────────

// Reads the ZIP central directory (no decompression, no dependency) and
// returns [{ name, size, compressedSize, isDir }]. ZIP64 archives return null.
export function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const minEocd = Math.max(0, buffer.byteLength - 65557);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) return null;
  const utf8 = new TextDecoder("utf-8");
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== 0x02014b50) break;
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const name = utf8.decode(new Uint8Array(buffer, offset + 46, nameLen));
    entries.push({ name, size, compressedSize, isDir: name.endsWith("/") });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function isZipFile(file) {
  const mime = String(file?.mimeType ?? "").toLowerCase();
  const name = String(file?.originalName ?? file?.name ?? "").toLowerCase();
  return mime === "application/zip" || mime === "application/x-zip-compressed" || name.endsWith(".zip");
}

export function ZipPreview({ url, file }) {
  const tooBig = (file?.sizeBytes ?? 0) > MAX_ZIP_BYTES;
  const { loading, data, error } = useFetched(tooBig ? null : url, "buffer");
  const entries = useMemo(() => (data ? listZipEntries(data) : null), [data]);

  if (tooBig) return <Centered>El archivo es demasiado grande para listar su contenido. Descárgalo para abrirlo.</Centered>;
  if (loading) return <Centered><Loader2 className="h-5 w-5 animate-spin" /></Centered>;
  if (error || !entries) return <Centered>No se pudo leer el contenido del ZIP. Descárgalo para abrirlo.</Centered>;

  const files = entries.filter((e) => !e.isDir);
  const total = files.reduce((sum, e) => sum + e.size, 0);
  return (
    <PanelShell
      icon={FileArchive}
      title={file?.originalName ?? "Archivo ZIP"}
      subtitle={`${files.length} archivo${files.length === 1 ? "" : "s"} · ${formatBytes(total)} sin comprimir`}
    >
      <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-center gap-3 px-4 py-2 text-sm">
            {entry.isDir ? (
              <Folder className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : (
              <FileCode2 className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
            {!entry.isDir && (
              <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{formatBytes(entry.size)}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Descarga el archivo para extraer su contenido.</p>
    </PanelShell>
  );
}
