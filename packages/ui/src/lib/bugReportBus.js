// Lets ErrorState and ApiErrorScreen (used in ~80 call sites across every
// module) trigger a bug report without each call site wiring a prop through.
// The app mounts exactly one listener (apps/desktop's BugReportHost, inside
// AuthProvider so it has a session/company to attach) that owns the dialog,
// the screenshot capture and the actual API call — this module only relays
// the request. If nothing has registered yet (e.g. a crash before auth
// mounts), the request is silently dropped; there is no queueing.
const listeners = new Set();

export function requestBugReport(payload) {
  listeners.forEach((fn) => fn(payload));
}

// Lets a caller hide its "Reportar bug" entry point when nothing would answer
// it (e.g. the outermost ErrorBoundary, where BugReportHost was torn down too).
export function hasBugReportListener() {
  return listeners.size > 0;
}

export function onBugReportRequest(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
