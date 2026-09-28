import test from "node:test";
import assert from "node:assert/strict";
import { extensionViewMeta, removeExtensionView } from "../codeExtensions.js";

const extensions = {
  files: [
    { path: "components/Panel.jsx", content: "x" },
    { path: "views/panel.custom.js", content: "defineView({ schema: { path: '/app/m/custom.v/panel', title: 'Panel' } })" },
  ],
  views: [{ file: "views/panel.custom.js" }],
  navigation: [{ label: "Panel", path: "/app/m/custom.v/panel" }, { label: "Otro", path: "/app/m/custom.v/otro" }],
};

test("reads a view's title and path and removes it with its menu entry", () => {
  assert.deepEqual(extensionViewMeta(extensions.files[1]), { title: "Panel", path: "/app/m/custom.v/panel" });
  const next = removeExtensionView(extensions, "views/panel.custom.js");
  assert.deepEqual(next.files.map((file) => file.path), ["components/Panel.jsx"]);
  assert.deepEqual(next.views, []);
  assert.deepEqual(next.navigation.map((item) => item.path), ["/app/m/custom.v/otro"]);
});
