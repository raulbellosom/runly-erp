// Keeps a Builder project in sync with module packages uploaded as ZIP.
// A package that differs from the Builder output only by code extensions
// (React screens: components/**, views/*.custom.js + their menu entries) is
// captured into the project, which stays in visual mode ("modo mixto"); any
// other change switches the project to developer mode so a Builder publish
// can never overwrite hand-written code. Also backs "Volver al modo visual".
// See docs/superpowers/specs/2026-09-28-rme3-builder-code-extensions-design.md.
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { classifyModulePackage, hasExtensions, normalizeModuleDefinition } from "@runly/module-compiler";
import { loadModuleManifest } from "./module-discovery-service.js";

const SKIPPED_DIRS = new Set([".bundle", "node_modules", ".git"]);

// encoding null returns Buffers (backup ZIP); classification uses text.
export async function readPackageFiles(dir, { base = dir, encoding = "utf8" } = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...await readPackageFiles(path.join(dir, entry.name), { base, encoding }));
    } else if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      files.push({ path: path.relative(base, full).split(path.sep).join("/"), content: await fs.readFile(full, encoding ?? undefined) });
    }
  }
  return files;
}

export async function loadPackageManifest(dir) {
  const loaded = await loadModuleManifest({ manifestPath: path.join(dir, "module.manifest.js"), source: "custom" });
  return loaded.status === "VALID" ? loaded.manifest : null;
}

function describeForeign(result) {
  if (!result.managed) return [result.reason];
  return result.foreign.map((item) => `${item.path} (${item.reason})`);
}

function extensionCounts(extensions) {
  return {
    views: extensions?.views?.length ?? 0,
    files: extensions?.files?.length ?? 0,
    navigation: extensions?.navigation?.length ?? 0,
  };
}

export function createBuilderPackageSync({ prisma }) {
  async function projectFor(moduleKey) {
    if (typeof prisma?.moduleBuilderProject?.findUnique !== "function") return null;
    return prisma.moduleBuilderProject.findUnique({ where: { moduleKey } }).catch(() => null);
  }

  async function classify({ moduleKey, dir, manifest }) {
    const files = await readPackageFiles(dir);
    return classifyModulePackage({ key: moduleKey, files, manifest: manifest ?? await loadPackageManifest(dir) });
  }

  // For the upload review: what will happen to the Builder project.
  async function evaluateUpload({ moduleKey, dir, manifest }) {
    const project = await projectFor(moduleKey);
    if (!project || project.detachedAt) return { action: "none" };
    const result = await classify({ moduleKey, dir, manifest });
    if (result.managed && !result.foreign.length) return { action: "keep", extensions: extensionCounts(result.extensions) };
    return { action: "detach", reasons: describeForeign(result) };
  }

  async function captureExtensions(project, result, { version, actorId, reattach = false }) {
    const extensions = result.extensions;
    const draft = { ...project.definition };
    const installed = { ...(result.embeddedDefinition ?? project.definition) };
    if (hasExtensions(extensions)) {
      draft.extensions = extensions;
      installed.extensions = extensions;
    } else {
      delete draft.extensions;
      delete installed.extensions;
    }
    let publishedDefinition = null;
    try {
      publishedDefinition = normalizeModuleDefinition(installed);
    } catch {
      publishedDefinition = null;
    }
    return prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: {
        definition: draft,
        ...(publishedDefinition ? { publishedDefinition, publishedAt: new Date() } : {}),
        ...(version ? { publishedVersion: version } : {}),
        ...(reattach ? { detachedAt: null } : {}),
        ...(actorId ? { updatedById: actorId } : {}),
      },
    });
  }

  // After a successful ZIP upload (the package is already installed in dir).
  async function afterUpload({ moduleKey, dir, outcome, actorId = null }) {
    if (outcome === "NO_CHANGES") return {};
    const project = await projectFor(moduleKey);
    if (!project || project.detachedAt) return {};
    const manifest = await loadPackageManifest(dir);
    const result = await classify({ moduleKey, dir, manifest });
    if (result.managed && !result.foreign.length) {
      await captureExtensions(project, result, { version: manifest?.version, actorId });
      return { builderKept: true, builderExtensions: extensionCounts(result.extensions) };
    }
    await prisma.moduleBuilderProject.update({
      where: { id: project.id },
      data: { detachedAt: new Date(), ...(actorId ? { updatedById: actorId } : {}) },
    });
    return { builderDetached: true, builderReasons: describeForeign(result) };
  }

  // "Volver al modo visual". Without confirm, refuses when the installed
  // package has changes the Builder cannot keep, and says which.
  async function reattach({ project, modulesDir, confirm = false, actorId = null }) {
    const dir = modulesDir ? path.join(modulesDir, project.moduleKey) : null;
    const installedExists = dir ? await fs.access(path.join(dir, "module.manifest.js")).then(() => true, () => false) : false;
    if (!installedExists) {
      return { reattached: true, project: await prisma.moduleBuilderProject.update({ where: { id: project.id }, data: { detachedAt: null } }) };
    }
    const manifest = await loadPackageManifest(dir);
    const result = await classify({ moduleKey: project.moduleKey, dir, manifest });
    const lost = describeForeign(result);
    const kept = result.managed ? extensionCounts(result.extensions) : extensionCounts(null);
    if (lost.length && !confirm) return { reattached: false, lost, kept };
    const updated = result.managed
      ? await captureExtensions(project, result, { version: manifest?.version, actorId, reattach: true })
      : await prisma.moduleBuilderProject.update({ where: { id: project.id }, data: { detachedAt: null } });
    return { reattached: true, lost, kept, project: updated };
  }

  // Backup of the installed package before leaving developer mode.
  async function installedPackageZip({ moduleKey, modulesDir }) {
    const files = await readPackageFiles(path.join(modulesDir, moduleKey), { encoding: null });
    if (!files.length) return null;
    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.content);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  return { evaluateUpload, afterUpload, reattach, installedPackageZip };
}
