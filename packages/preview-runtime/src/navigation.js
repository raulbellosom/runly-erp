export function navigationTarget({ moduleKey, routeInfo, mode, recordId, isSheetMode = false }) {
  if (isSheetMode && mode === 'create') return null;
  const base = routeInfo.moduleRoutePath || (routeInfo.collectionPath ? `/app/m/${moduleKey}/${routeInfo.collectionPath}` : null);
  if (!base) return null;
  if (mode === 'create') return `${base}/new`;
  if ((mode === 'detail' || mode === 'edit') && recordId) return `${base}/${encodeURIComponent(String(recordId))}${mode === 'edit' ? '/edit' : ''}`;
  return base;
}
