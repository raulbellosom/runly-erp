// apps/desktop/scripts/copy-vendor-assets.mjs
//
// Copies a couple of vendored runtime assets from node_modules into public/
// so Vite serves them as static files instead of bundling them as JS
// modules — both need to be fetched by URL at runtime, not imported.
// Run automatically via the "postinstall" script on every `pnpm install`;
// neither destination file is committed to git (see .gitignore /
// git history for pdf.worker.min.mjs, which IS committed as a fallback —
// ffmpeg-core.wasm is ~30MB and is not).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function copyPdfWorker() {
  try {
    const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    if (existsSync(src)) cpSync(src, "public/pdf.worker.min.mjs");
  } catch { /* pdfjs-dist not installed — nothing to copy */ }
}

function copyFfmpegCore() {
  try {
    // @ffmpeg/core's package.json "exports" only maps "." (CJS -> dist/umd,
    // ESM -> dist/esm) and "./wasm" the same way — no "./package.json"
    // subpath, so its install directory can't be found via require.resolve
    // directly. Resolving the CJS entry and walking up from
    // dist/umd/ffmpeg-core.js to dist/ sidesteps that.
    //
    // The ESM build is required, not the UMD one: @ffmpeg/ffmpeg's worker
    // always runs as `type: "module"` (classes.js), so `importScripts()`
    // (the UMD-loading path) throws immediately inside it and it falls back
    // to a dynamic `import()` of whatever coreURL was given — which fails
    // ("failed to import ffmpeg-core.js") if that file is the UMD build,
    // since it isn't a valid ES module. Confirmed against production.
    const umdEntry = require.resolve("@ffmpeg/core");
    const distDir = path.dirname(path.dirname(umdEntry));
    const esmDir = path.join(distDir, "esm");
    mkdirSync("public/ffmpeg", { recursive: true });
    cpSync(path.join(esmDir, "ffmpeg-core.js"), "public/ffmpeg/ffmpeg-core.js");
    cpSync(path.join(esmDir, "ffmpeg-core.wasm"), "public/ffmpeg/ffmpeg-core.wasm");
  } catch { /* @ffmpeg/core not installed — nothing to copy */ }
}

copyPdfWorker();
copyFfmpegCore();
