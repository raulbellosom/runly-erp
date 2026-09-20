import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveModuleRoots } from './module-root-resolver.js';

const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;    // 50 MB
const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;  // 150 MB

// Returns the resolved authoritative custom-modules root.
export async function resolveModulesDir() {
  const roots = await resolveModuleRoots();
  return roots.customModulesDir;
}

// Returns true if the resolved path stays within targetBase (prevents path traversal).
// Handles forward-slash ZIP entry names on Windows by normalizing to path.sep.
function isSafePath(targetBase, relativeEntryPath) {
  const normalized = relativeEntryPath.split('/').join(path.sep);
  const resolved = path.resolve(targetBase, normalized);
  return resolved === targetBase || resolved.startsWith(targetBase + path.sep);
}

// ZIP paths are specified with forward slashes, but common Windows tooling such
// as Compress-Archive can emit backslashes. Normalize before structure and
// traversal checks so those archives remain portable and equally protected.
function normalizeZipPath(entryName) {
  return entryName.replaceAll('\\', '/');
}

// Returns '' if module.manifest.js is at the ZIP root.
// Returns 'folderName/' if the ZIP has a single root folder containing the manifest.
// Returns null if the structure is ambiguous (reject).
function detectRootPrefix(filenames) {
  if (filenames.some(f => f === 'module.manifest.js')) return '';
  const rootEntries = [...new Set(filenames.map(f => f.split('/')[0]))].filter(Boolean);
  if (
    rootEntries.length === 1 &&
    filenames.some(f => f === rootEntries[0] + '/module.manifest.js')
  ) {
    return rootEntries[0] + '/';
  }
  return null;
}

// Extracts the `key:` literal string from a manifest file using a regex.
// Does NOT execute the file. Returns null if the pattern is not found (dynamic key).
function extractManifestKey(content) {
  const match = content.match(/key\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * Validates a ZIP buffer and extracts it to {modulesDir}/{key}/.
 * Throws an Error with statusCode and optional details on validation failure.
 * Returns { fileCount } on success.
 */
export async function validateAndExtractZip(key, fileBuffer, modulesDir) {
  if (fileBuffer.length > MAX_COMPRESSED_BYTES) {
    throw Object.assign(new Error('ZIP_TOO_LARGE'), { statusCode: 413 });
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(fileBuffer);
  } catch {
    throw Object.assign(new Error('INVALID_ZIP'), { statusCode: 422 });
  }

  const fileEntries = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([name, entry]) => ({ name, normalizedName: normalizeZipPath(name), entry }));
  const filenames = fileEntries.map(({ normalizedName }) => normalizedName);
  if (new Set(filenames).size !== filenames.length) {
    throw Object.assign(new Error('DUPLICATE_ZIP_ENTRY'), { statusCode: 422 });
  }
  const prefix = detectRootPrefix(filenames);

  if (prefix === null) {
    throw Object.assign(new Error('AMBIGUOUS_ZIP_STRUCTURE'), { statusCode: 422 });
  }

  const manifestFile = fileEntries.find(
    ({ normalizedName }) => normalizedName === prefix + 'module.manifest.js',
  );
  if (!manifestFile) {
    throw Object.assign(new Error('MISSING_MANIFEST'), { statusCode: 422 });
  }

  const manifestContent = await manifestFile.entry.async('text');
  const manifestKey = extractManifestKey(manifestContent);
  if (!manifestKey) {
    throw Object.assign(new Error('MANIFEST_KEY_UNREADABLE'), { statusCode: 422 });
  }
  if (manifestKey !== key) {
    throw Object.assign(new Error('MANIFEST_KEY_MISMATCH'), {
      statusCode: 422,
      details: { expected: key, found: manifestKey },
    });
  }

  const targetBase = path.resolve(modulesDir, key);
  let totalUncompressed = 0;

  // Validate all paths and accumulate uncompressed size before writing anything
  for (const { name, normalizedName, entry } of fileEntries) {
    const relative = prefix ? normalizedName.slice(prefix.length) : normalizedName;
    if (!isSafePath(targetBase, relative)) {
      throw Object.assign(new Error('PATH_TRAVERSAL_DETECTED'), {
        statusCode: 422,
        details: { entry: name },
      });
    }
    totalUncompressed += entry._data?.uncompressedSize ?? 0;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw Object.assign(new Error('UNCOMPRESSED_SIZE_EXCEEDED'), { statusCode: 413 });
    }
  }

  // Atomically replace the existing directory (if any)
  if (existsSync(targetBase)) {
    await fs.rm(targetBase, { recursive: true, force: true });
  }
  await fs.mkdir(targetBase, { recursive: true });

  let fileCount = 0;
  try {
    for (const { normalizedName, entry } of fileEntries) {
      const relative = prefix ? normalizedName.slice(prefix.length) : normalizedName;
      // Convert forward slashes to OS separator (Windows compatibility)
      const dest = path.resolve(targetBase, relative.split('/').join(path.sep));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const content = await entry.async('nodebuffer');
      await fs.writeFile(dest, content);
      fileCount++;
    }
  } catch (writeErr) {
    // Cleanup partial write — do not leave a broken module directory
    await fs.rm(targetBase, { recursive: true, force: true }).catch(() => {});
    throw Object.assign(new Error('WRITE_FAILED'), { statusCode: 500, cause: writeErr });
  }

  return { fileCount };
}

/**
 * Deletes the module directory from the filesystem.
 * Returns true if deleted, false if the directory did not exist (not an error).
 */
export async function purgeModuleFiles(key, modulesDir) {
  const targetBase = path.resolve(modulesDir, key);
  if (!existsSync(targetBase)) return false;
  await fs.rm(targetBase, { recursive: true, force: true });
  return true;
}

/**
 * Hard-deletes all DB records for a module inside a Prisma transaction.
 * Requires module.status !== 'INSTALLED' || module.enabled === false.
 * Deletion order: RunlyField → RunlyModel → Blueprint → RunlyModule.
 */
export async function purgeModuleFromDb(key, prisma) {
  return prisma.$transaction(async (tx) => {
    const module = await tx.runlyModule.findUnique({ where: { key } });
    if (!module) {
      throw Object.assign(new Error('MODULE_NOT_FOUND'), { statusCode: 404 });
    }
    if (module.status === 'INSTALLED' && module.enabled) {
      throw Object.assign(new Error('MODULE_MUST_BE_UNINSTALLED'), { statusCode: 409 });
    }

    const models = await tx.runlyModel.findMany({
      where: { moduleKey: key },
      select: { id: true },
    });
    const modelIds = models.map(m => m.id);
    if (modelIds.length > 0) {
      await tx.runlyField.deleteMany({ where: { modelId: { in: modelIds } } });
    }
    await tx.runlyModel.deleteMany({ where: { moduleKey: key } });
    // Blueprint has no moduleKey column — it relates to RunlyModule by moduleId (uuid).
    // (Its FK is ON DELETE CASCADE, so runlyModule.delete below would clean these up
    // on its own; this stays explicit so the deletion order documented above holds.)
    await tx.blueprint.deleteMany({ where: { moduleId: module.id } });
    await tx.runlyModule.delete({ where: { key } });

    return { moduleKey: key };
  });
}
