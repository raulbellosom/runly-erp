import { defineConfig } from "vite";
import { nativeHostHeaders } from './native-host/web-policy.js';
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bare specifiers that RME3 module bundles declare as external (must stay in sync
// with BUNDLE_EXTERNALS in apps/api/src/services/module-bundler-service.js).
// The importmap plugins below map these specifiers to URLs the browser can resolve
// both in dev (Vite /@id/ virtual modules) and in production (shim entry files).
import { MODULE_EXTERNALS_IMPORTMAP } from '@runly/preview-runtime/externals';

// Dev-mode: route bare specifiers through the same explicit shim entry points
// used by production. Pointing dynamic bundles directly at Vite's /@id/ URLs
// is unreliable for CommonJS packages such as Sonner: Vite can expose only a
// default export there, so named imports like `toast` fail before register()
// gets a chance to populate the module component registry.
function runlyDevImportmapPlugin() {
  return {
    name: "runly-module-externals-importmap-dev",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler() {
        const imports = Object.fromEntries(
          Object.entries(MODULE_EXTERNALS_IMPORTMAP).map(
            ([specifier, shimName]) => [
              specifier,
              `/src/shims/${shimName}.js`,
            ],
          ),
        );
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports }),
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}

// Build-mode: inject importmap that resolves bare specifiers to the shim JS files
// baked into the production build at shims/ext-*.js (non-hashed paths for
// predictable importmap entries).
function runlyBuildImportmapPlugin() {
  let resolvedBasePath = "";
  return {
    name: "runly-module-externals-importmap-build",
    apply: "build",
    configResolved(config) {
      resolvedBasePath = (config.base ?? "/").replace(/\/$/, "");
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        const basePath = resolvedBasePath || "";
        const imports = Object.fromEntries(
          Object.entries(MODULE_EXTERNALS_IMPORTMAP).map(
            ([specifier, shimName]) => [
              specifier,
              `${basePath}/shims/${shimName}.js`,
            ],
          ),
        );
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports }),
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  // Read shared monorepo env vars from repository root (.env, .env.local, etc.).
  envDir: "../..",
  plugins: [
    nativeHostHeaders(),
    tailwindcss(),
    react(),
    runlyDevImportmapPlugin(),
    runlyBuildImportmapPlugin(),
    {
      // Async proxy for browser page navigations in dev.
      // Proxies text/html GET requests (non-ERP, non-Vite) to the API dist-serve.
      // Falls back to Vite's own SPA handler (index.html) when the API returns
      // non-200 HTML — this keeps builder mode and no-website state working.
      name: 'runly-dist-proxy',
      configureServer(server) {
        const apiTarget = process.env.VITE_RUNLY_API_URL ?? 'http://127.0.0.1:4010'
        const DIST_STATIC_RE = /\.(txt|xml|webmanifest|ico|rss|atom)$/i
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET') return next()
          const url = req.url ?? '/'
          const accept = req.headers['accept'] ?? ''
          if (url.startsWith('/app') || url.startsWith('/pwa/')) return next()
          if (url.startsWith('/@') || url.startsWith('/node_modules/')) return next()
          if ((req.headers.upgrade ?? '') === 'websocket') return next()
          const isPageNav = accept.includes('text/html')
          const isStaticDistFile = DIST_STATIC_RE.test(url.split('?')[0])
          if (!isPageNav && !isStaticDistFile) return next()
          try {
            const upstream = await fetch(`${apiTarget}${url}`, {
              headers: { accept, host: new URL(apiTarget).host },
              redirect: 'follow',
            })
            const ct = upstream.headers.get('content-type') ?? ''
            // Serve HTML pages and static dist files (robots.txt, sitemap.xml, etc.)
            if (upstream.ok && (ct.includes('text/html') || isStaticDistFile)) {
              const body = await upstream.arrayBuffer()
              res.writeHead(200, { 'content-type': ct || 'application/octet-stream', 'cache-control': 'no-store' })
              res.end(Buffer.from(body))
              return
            }
          } catch { /* API not ready yet — fall through to Vite SPA */ }
          return next()
        })
      },
    },
  ],
  resolve: {
    // Prevents duplicate React instances across chunks (e.g. workspace packages
    // that list react in devDependencies). Without this, Rollup's auto-splitting
    // can place React in a cross-chunk reference cycle where e.useRef is accessed
    // before the React module finishes initializing (null reference crash).
    // React Query must be a single copy too: packages/ui and the app can
    // resolve different versions ("latest" ranges), and two copies mean two
    // QueryClient contexts ("No QueryClient set" at startup).
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-query-persist-client"],
    alias: {
      "node:crypto": resolve(__dirname, "src/shims/node-crypto.js"),
      "@atlas/core/native-runtime": resolve(__dirname, "../../packages/core/src/native-runtime.js"),
      "@atlas/core": resolve(__dirname, "../../packages/core/src/index.js"),
      "@atlas/module-engine": resolve(__dirname, "../../packages/module-engine/src/index.js"),
      "@atlas/sdk": resolve(__dirname, "../../packages/sdk/src/index.js"),
      "@atlas/ui": resolve(__dirname, "../../packages/ui/src/index.js"),
      "@atlas/validators": resolve(__dirname, "../../packages/validators/src/index.js"),
      "@runly/core/browser": resolve(__dirname, "../../packages/core/src/browser.js"),
      "@runly/core/native-runtime": resolve(__dirname, "../../packages/core/src/native-runtime.js"),
      "@runly/core": resolve(__dirname, "../../packages/core/src/index.js"),
      // Before "@runly/module-engine": browser-safe subpaths used by
      // @runly/module-compiler/browser (Builder automations).
      "@runly/module-engine/browser": resolve(__dirname, "../../packages/module-engine/src/browser.js"),
      "@runly/module-engine/contracts": resolve(__dirname, "../../packages/module-engine/src/contracts.js"),
      "@runly/module-engine": resolve(__dirname, "../../packages/module-engine/src/index.js"),
      "@runly/sdk": resolve(__dirname, "../../packages/sdk/src/index.js"),
      // Before "@runly/ui": aliases match by prefix, first entry wins.
      "@runly/ui/preview": resolve(__dirname, "../../packages/ui/src/preview.js"),
      "@runly/ui/runtime-adapters": resolve(__dirname, "../../packages/ui/src/lib/module-runtime/RuntimeAdapters.jsx"),
      "@runly/ui/renderer-adapters": resolve(__dirname, "../../packages/ui/src/runly-renderer/renderer-adapters.js"),
      "@runly/ui/icons": resolve(__dirname, "../../packages/ui/src/lib/icon-library/index.js"),
      "@runly/ui": resolve(__dirname, "../../packages/ui/src/index.js"),
      "@runly/validators": resolve(
        __dirname,
        "../../packages/validators/src/index.js",
      ),
      // Ensure non-hoisted packages used by modules/custom/* components resolve
      // to the desktop app's installation, not a missing root-level location.
      "react-router-dom": resolve(__dirname, "node_modules/react-router-dom"),
      "@tanstack/react-query": resolve(__dirname, "node_modules/@tanstack/react-query"),
      "sonner": resolve(__dirname, "node_modules/sonner"),
      "lucide-react": resolve(__dirname, "node_modules/lucide-react"),
      "recharts": resolve(__dirname, "node_modules/recharts"),
      "qrcode": resolve(__dirname, "node_modules/qrcode"),
      "@zxing/browser": resolve(__dirname, "node_modules/@zxing/browser"),
      "@tauri-apps/plugin-store": resolve(
        __dirname,
        "node_modules/@tauri-apps/plugin-store/dist-js/index.js",
      ),
    },
  },
  build: {
    rollupOptions: {
      // 'allow-extension' tells Rolldown/Rollup: preserve every export declared in
      // entry modules, even if no other module in the build graph imports it.
      // Without this, Rolldown tree-shakes exports like `Alert` from the atlas-ui
      // chunk when the main app never imports them directly — the shim's
      // `export * from '@runly/ui'` then appears to provide no such export at
      // runtime, breaking RME3 module bundles that use those components.
      preserveEntrySignatures: "allow-extension",
      input: {
        index: resolve(__dirname, "index.html"),
        // Shim entry points — each becomes shims/<name>.js (non-hashed) in the
        // production build and is referenced by the importmap injected above.
        "ext-react":               resolve(__dirname, "src/shims/ext-react.js"),
        "ext-react-dom":           resolve(__dirname, "src/shims/ext-react-dom.js"),
        "ext-react-jsx-runtime":   resolve(__dirname, "src/shims/ext-react-jsx-runtime.js"),
        "ext-react-jsx-dev-runtime": resolve(__dirname, "src/shims/ext-react-jsx-dev-runtime.js"),
        "ext-tanstack-react-query": resolve(__dirname, "src/shims/ext-tanstack-react-query.js"),
        "ext-zustand":             resolve(__dirname, "src/shims/ext-zustand.js"),
        "ext-atlas-ui":            resolve(__dirname, "src/shims/ext-atlas-ui.js"),
        "ext-atlas-sdk":           resolve(__dirname, "src/shims/ext-atlas-sdk.js"),
        "ext-atlas-validators":    resolve(__dirname, "src/shims/ext-atlas-validators.js"),
        "ext-react-router-dom":    resolve(__dirname, "src/shims/ext-react-router-dom.js"),
        "ext-sonner":              resolve(__dirname, "src/shims/ext-sonner.js"),
        "ext-lucide-react":        resolve(__dirname, "src/shims/ext-lucide-react.js"),
        "ext-recharts":            resolve(__dirname, "src/shims/ext-recharts.js"),
        "ext-qrcode":              resolve(__dirname, "src/shims/ext-qrcode.js"),
        "ext-zxing-browser":       resolve(__dirname, "src/shims/ext-zxing-browser.js"),
      },
      output: {
        // Shim entries get non-hashed names at a predictable path so the
        // importmap entries above never need to be updated.
        entryFileNames: (chunk) =>
          chunk.name.startsWith("ext-")
            ? "shims/[name].js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (id.includes("/node_modules/@supabase/")) {
            return "supabase-vendor";
          }
          if (
            id.includes("/node_modules/@tanstack/") ||
            id.includes("/node_modules/zustand/")
          ) {
            return "state-vendor";
          }
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/@tiptap/") ||
            id.includes("/node_modules/lucide-react/") ||
            id.includes("/node_modules/sonner/")
          ) {
            return "ui-vendor";
          }
          // NOTE: @runly/ui, @runly/sdk, @runly/validators are intentionally NOT
          // in manualChunks. Rolldown has a CJS-interop bug when React is imported
          // from a separate manual chunk — the chunk captures React as null, breaking
          // hooks in RME3 module bundles that use those packages via the shim.
          // Letting Rolldown auto-split them into a shared chunk (created from the
          // main HTML entry) avoids the issue. preserveEntrySignatures ensures all
          // exports remain accessible through the shims.
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Pre-transform the entry graph at server start so the first page load
    // does not wait for hundreds of on-demand transforms (white screen).
    warmup: { clientFiles: ["./src/main.jsx"] },
    proxy: (function () {
      const apiTarget = process.env.VITE_RUNLY_API_URL ?? "http://127.0.0.1:4010";

      function suppressStartup(proxy, label) {
        proxy.on("error", (err, _req, res) => {
          if (err.code === "ECONNREFUSED") {
            if (!res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "API starting" }));
            }
            return;
          }
          console.error(`[proxy] ${label} error:`, err.message);
        });
      }

      return {
        // PWA push endpoints
        "^/pwa/": {
          target: apiTarget,
          changeOrigin: true,
          configure: (p) => suppressStartup(p, "/pwa/"),
        },

        // All known API path prefixes — needed so storefront SDK calls
        // (using RUNLY_APP_URL=localhost:5173) reach the API backend.
        "^/(public|modules|blueprints|files|contacts|company|identity|finance|hr|website|ledger|calendar|projects|catalog|pos|storefront|activity|notifications|inventory|chat|calls|auth|health|erp-badge-check|p)/": {
          target: apiTarget,
          changeOrigin: true,
          configure: (p) => suppressStartup(p, "api-paths"),
        },

        // Note: browser page navigation fallback (source_type=dist) is handled by
        // the 'runly-dist-proxy' plugin below, not a proxy rule. The plugin is async
        // and can fall back to Vite's SPA handler when the API returns non-2xx
        // (builder mode, no-website, etc.). A synchronous proxy rule can't do this.
      };
    })(),
  },
  clearScreen: false,
});
