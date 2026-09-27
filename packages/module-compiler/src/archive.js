import JSZip from 'jszip'

// Fixed instead of `new Date()` so the same CompiledModule always produces
// byte-identical ZIP contents — ZIP local file headers embed a timestamp,
// and letting it vary would make packageHash-equal packages hash differently
// as files (the archive itself isn't hashed; compileModule()'s packageHash
// already covers path+content and stays the source of truth for identity).
const DETERMINISTIC_DATE = new Date('2020-01-01T00:00:00.000Z')

// Turns a CompiledModule (compileModule() output: { files: [{ path, content }] })
// into the one canonical RME3 ZIP format also produced by CLI/CI package
// export and accepted as-is by POST /modules/:key/upload — see
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md §15/§20.
export async function archiveModule(compiled) {
  const zip = new JSZip()
  const files = [...compiled.files].sort((left, right) => left.path.localeCompare(right.path))
  for (const file of files) {
    zip.file(file.path, file.content, { date: DETERMINISTIC_DATE, unixPermissions: 0o644, createFolders: false })
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
