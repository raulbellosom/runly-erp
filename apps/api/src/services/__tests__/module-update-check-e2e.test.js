// End-to-end (no database): a Builder-compiled module extended with a React
// screen exactly as GUIA_DESARROLLO_RUNLY.md describes, zipped, then reviewed
// with the real staging service and the real esbuild bundler.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { archiveModule, compileModule } from "@runly/module-compiler";
import { createModulePackageService, previewBundlePath } from "../module-package-service.js";
import { createModulePackageStagingService } from "../module-package-staging-service.js";
import { createModuleBundlerService } from "../module-bundler-service.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");

test("a Builder ZIP extended with a React screen is reviewed and previewed without installing", async (t) => {
  const compiled = compileModule({
    schemaVersion: 1, key: "custom.visitas", name: "Visitas", version: "1.0.0", icon: "Users", color: "#2563EB",
    pwa: { shortName: "Visitas", startPath: "/visitas" },
    entities: [{ key: "visita", label: "Visita", pluralLabel: "Visitas", fields: [{ key: "nombre", type: "text", label: "Nombre" }] }],
  });
  const files = compiled.files.map((file) => ({ ...file }));
  const manifest = files.find((file) => file.path === "module.manifest.js");
  manifest.content = manifest.content.replace("  views: [\n", "  views: [\n  './views/visitas-panel.custom.js',\n");
  files.push(
    { path: "components/VisitasPanel.jsx", content: "import { PageHeader } from '@runly/ui'\nexport default function VisitasPanel() { return <PageHeader title=\"Panel\" /> }\n" },
    { path: "components/index.js", content: "export async function register(registry) {\n  if (typeof window === 'undefined') return\n  const { default: VisitasPanel } = await import('./VisitasPanel.jsx')\n  registry.register('custom.visitas:VisitasPanel', VisitasPanel)\n}\n" },
    { path: "views/visitas-panel.custom.js", content: "import { defineView } from '@runly/module-engine'\nexport default defineView({ key: 'visitas.panel', kind: 'CUSTOM', version: '0.1.0', schema: { path: '/app/m/custom.visitas/visitas-panel', component: 'custom.visitas:VisitasPanel', title: 'Panel' } })\n" },
  );
  const zip = await archiveModule({ files });

  const modulesDir = await fs.mkdtemp(path.join(REPO_ROOT, ".tmp-update-check-"));
  t.after(() => fs.rm(modulesDir, { recursive: true, force: true }));
  const bundlerSvc = createModuleBundlerService({ prisma: {}, supabaseAdmin: null });
  const service = createModulePackageService({
    prisma: { runlyModule: { findUnique: async () => null } },
    stagingService: createModulePackageStagingService(),
    bundlerSvc,
    preflightPackage: async () => ({ schemaMigration: { required: false, canAutoApply: true, operations: [], drift: [] } }),
  });

  const report = await service.checkZip({ key: "custom.visitas", fileBuffer: zip, modulesDir });
  assert.equal(report.valid, true, JSON.stringify(report.blockers));
  assert.equal(report.blocked, false);
  assert.equal(report.installed, false);
  assert.deepEqual(report.customViews.map((view) => view.component), ["custom.visitas:VisitasPanel"]);
  assert.ok(report.preview?.id, JSON.stringify(report.warnings));
  const bundle = await fs.readFile(previewBundlePath(modulesDir, "custom.visitas", report.preview.id), "utf8");
  assert.match(bundle, /custom\.visitas:VisitasPanel/);
  assert.match(bundle, /from "@runly\/ui"/, "shared libraries stay external");
  assert.equal(await fs.stat(path.join(modulesDir, "custom.visitas")).catch(() => null), null, "nothing installed");
});
