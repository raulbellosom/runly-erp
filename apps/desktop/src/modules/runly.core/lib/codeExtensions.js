// Module Builder — helpers for definition.extensions (React screens captured
// from an uploaded ZIP), used by CodeExtensionsCard.

export function extensionViewMeta(file) {
  const content = file?.content ?? "";
  const title = /title:\s*['"]([^'"]+)['"]/.exec(content)?.[1];
  const path = /path:\s*['"]([^'"]+)['"]/.exec(content)?.[1];
  return { title, path };
}

export function removeExtensionView(extensions, viewFile) {
  const file = extensions.files.find((item) => item.path === viewFile);
  const { path } = extensionViewMeta(file);
  return {
    files: extensions.files.filter((item) => item.path !== viewFile),
    views: extensions.views.filter((view) => view.file !== viewFile),
    navigation: extensions.navigation.filter((item) => item.path !== path),
  };
}
