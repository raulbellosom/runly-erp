// Real packages on disk (compiled by the Builder, loaded with the real
// manifest loader); only the project row is faked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { compileModule } from "@runly/module-compiler";
import { createBuilderPackageSync } from "../module-builder-package-sync.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const KEY = "custom.visitas";
const DEFINITION = {
  schemaVersion: 1, key: KEY, name: "Visitas", version: "1.0.0", icon: "Users", color: "#2563EB",
  pwa: { shortName: "Visitas", startPath: "/visitas" },
  entities: [{ key: "visita", label: "Visita", pluralLabel: "Visitas", fields: [{ key: "nombre", type: "text", label: "Nombre" }] }],
};

async function install(t, { withScreen = false, touchApi = false } = {}) {
  const modulesDir = await fs.mkdtemp(path.join(REPO_ROOT, ".tmp-builder-sync-"));
  t.after(() => fs.rm(modulesDir, { recursive: true, force: true }));
  const dir = path.join(modulesDir, KEY);
  for (const file of compileModule(structuredClone(DEFINITION)).files) {
    await fs.mkdir(path.dirname(path.join(dir, file.path)), { recursive: true });
    await fs.writeFile(path.join(dir, file.path), file.content);
  }
  if (withScreen) {
    await fs.mkdir(path.join(dir, "components"), { recursive: true });
    await fs.writeFile(path.join(dir, "components/index.js"), "export async function register(registry) {}\n");
    await fs.writeFile(path.join(dir, "components/Panel.jsx"), "export default function Panel() { return null }\n");
    await fs.writeFile(path.join(dir, "views/panel.custom.js"), "import { defineView } from '@runly/module-engine'\nexport default defineView({ key: 'visitas.panel', kind: 'CUSTOM', version: '0.1.0', schema: { path: '/app/m/custom.visitas/panel', component: 'custom.visitas:Panel', title: 'Panel' } })\n");
    const manifestPath = path.join(dir, "module.manifest.js");
    let manifest = await fs.readFile(manifestPath, "utf8");
    manifest = manifest.replace("  views: [\n", "  views: [\n  './views/panel.custom.js',\n");
    manifest = manifest.replace("  navigation: [\n", "  navigation: [\n  { label: 'Panel', path: '/app/m/custom.visitas/panel', icon: 'LayoutDashboard', layout: 'main', permissionKey: 'visitas.visita.read' },\n");
    await fs.writeFile(manifestPath, manifest);
  }
  if (touchApi) await fs.appendFile(path.join(dir, "api/visita-service.js"), "\n// cambio a mano\n");
  return { modulesDir, dir };
}

function fakePrisma(project) {
  const updates = [];
  return {
    updates,
    moduleBuilderProject: {
      findUnique: async () => project,
      update: async ({ data }) => { updates.push(data); Object.assign(project, data); return project; },
    },
  };
}

const newProject = (extra = {}) => ({ id: "p1", moduleKey: KEY, definition: structuredClone(DEFINITION), detachedAt: null, ...extra });

test("an upload that only adds React screens keeps the Builder and captures them", async (t) => {
  const { dir } = await install(t, { withScreen: true });
  const project = newProject();
  const prisma = fakePrisma(project);
  const result = await createBuilderPackageSync({ prisma }).afterUpload({ moduleKey: KEY, dir, outcome: "UPDATED" });
  assert.equal(result.builderKept, true, JSON.stringify(result));
  assert.equal(project.detachedAt, null);
  assert.deepEqual(project.definition.extensions.views, [{ file: "views/panel.custom.js" }]);
  assert.deepEqual(project.definition.extensions.files.map((file) => file.path).sort(), ["components/Panel.jsx", "components/index.js", "views/panel.custom.js"]);
  assert.equal(project.definition.extensions.navigation[0].path, "/app/m/custom.visitas/panel");
  // The next Builder publish reproduces the screens.
  const republished = compileModule(project.definition);
  assert.ok(republished.files.some((file) => file.path === "components/Panel.jsx"));
  assert.match(republished.files.find((file) => file.path === "module.manifest.js").content, /panel\.custom\.js/);
});

test("changing generated code switches to developer mode; going back asks first and keeps the screens", async (t) => {
  const { modulesDir, dir } = await install(t, { withScreen: true, touchApi: true });
  const project = newProject();
  const sync = createBuilderPackageSync({ prisma: fakePrisma(project) });
  const result = await sync.afterUpload({ moduleKey: KEY, dir, outcome: "UPDATED" });
  assert.equal(result.builderDetached, true);
  assert.deepEqual(result.builderReasons, ["api/visita-service.js (modificado)"]);

  const refused = await sync.reattach({ project, modulesDir });
  assert.equal(refused.reattached, false);
  assert.deepEqual(refused.lost, ["api/visita-service.js (modificado)"]);
  assert.equal(refused.kept.views, 1);

  const confirmed = await sync.reattach({ project, modulesDir, confirm: true });
  assert.equal(confirmed.reattached, true);
  assert.equal(project.detachedAt, null);
  assert.equal(project.definition.extensions.views.length, 1);
});

test("an untouched package keeps everything; backups include every file", async (t) => {
  const { modulesDir, dir } = await install(t);
  const project = newProject({ detachedAt: new Date() });
  const sync = createBuilderPackageSync({ prisma: fakePrisma(project) });
  const back = await sync.reattach({ project, modulesDir });
  assert.equal(back.reattached, true);
  assert.deepEqual(back.lost, []);
  assert.equal(await sync.afterUpload({ moduleKey: KEY, dir, outcome: "NO_CHANGES" }).then((r) => Object.keys(r).length), 0);
  const zip = await sync.installedPackageZip({ moduleKey: KEY, modulesDir });
  assert.ok(zip.length > 1000);
});

test("an identical upload still brings a lagging Builder project up to the installed version", async (t) => {
  const { dir } = await install(t);
  const project = newProject({ definition: { ...structuredClone(DEFINITION), version: "0.1.0" }, publishedVersion: null });
  const sync = createBuilderPackageSync({ prisma: fakePrisma(project) });
  await sync.afterUpload({ moduleKey: KEY, dir, outcome: "NO_CHANGES" });
  assert.equal(project.publishedVersion, "1.0.0");
  assert.equal(project.definition.version, "1.0.0");
});
