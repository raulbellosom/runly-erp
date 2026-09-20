import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Business screens must use the company transport or the SDK. Public examples,
// signed asset URLs and guest capabilities are deliberately separate.
const root = fileURLToPath(new URL('../apps/desktop/src/modules/', import.meta.url));
const exceptions = new Map([
  ['runly.website/screens/FormApiPanel.jsx', 'Public storefront example snippets'],
  ['runly.website/lib/colorExtract.js', 'Public image pixels'],
  ['runly.chat/lib/chatUtils.js', 'Signed asset downloads'],
  ['runly.chat/calls/callSounds.js', 'Static audio assets'],
  ['runly.chat/calls/callLifecycle.js', 'Leaving a call uses resource ACL even after a company switch'],
  ['runly.chat/hooks/useChatUpload.js', 'Presigned storage upload URL'],
  ['runly.chat/components/MessageAttachments.jsx', 'Signed attachment URLs'],
  ['runly.notes/lib/canvasImages.js', 'Signed image URLs'],
  ['runly.notes/lib/noteClipboard.js', 'Public clipboard image with credentials omitted'],
  ['runly.inventory/lib/intake.js', 'Explicit companyId header and request signal'],
]);
let checked = 0;
const failures = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!/\.jsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
    checked++;
    const source = await readFile(path, 'utf8');
    const key = relative(root, path).replaceAll('\\', '/');
    if (/\bfetch\s*\(/.test(source) && !exceptions.has(key)) failures.push(key);
  }
}
await visit(root);
if (failures.length) {
  console.error('Peticiones sin transporte empresarial:', failures.join(', '));
  process.exitCode = 1;
} else console.log(`Empresa activa: ${checked} archivos de módulos revisados; sin fetch directo no revisado.`);
