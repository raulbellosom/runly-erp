// Module Builder SDK domain (No-Code Module Builder MVP). Thin wrapper over
// apps/api/src/routes/builder-routes.js — see that file and
// apps/api/src/services/module-builder-service.js for the full contract.
export function createBuilderDomain({ request, requestBlob, withAuthHeaders }) {
  const projectPath = (id) => `/module-builder/projects/${encodeURIComponent(id)}`;

  return {
    getCapabilities: (token) =>
      request('/module-builder/capabilities', { headers: withAuthHeaders(token) }),

    listProjects: (token) =>
      request('/module-builder/projects', { headers: withAuthHeaders(token) }),

    createProject: (payload, token) =>
      request('/module-builder/projects', {
        method: 'POST',
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    getProject: (id, token) =>
      request(projectPath(id), { headers: withAuthHeaders(token) }),

    updateDefinition: (id, payload, token) =>
      request(projectPath(id), {
        method: 'PATCH',
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    deleteDraft: (id, token) =>
      request(projectPath(id), { method: 'DELETE', headers: withAuthHeaders(token) }),

    validateProject: (id, token) =>
      request(`${projectPath(id)}/validate`, { method: 'POST', headers: withAuthHeaders(token) }),

    compileProject: (id, token) =>
      request(`${projectPath(id)}/compile`, { method: 'POST', headers: withAuthHeaders(token) }),

    previewProject: (id, viewKey, token) =>
      request(`${projectPath(id)}/preview${viewKey ? `?view=${encodeURIComponent(viewKey)}` : ''}`, {
        headers: withAuthHeaders(token),
      }),

    exportPackage: (id, token) =>
      requestBlob(`${projectPath(id)}/export`, { headers: withAuthHeaders(token) }),

    getPublishImpact: (id, token) =>
      request(`${projectPath(id)}/publish-impact`, { headers: withAuthHeaders(token) }),

    publishProject: (id, token) =>
      request(`${projectPath(id)}/publish`, { method: 'POST', headers: withAuthHeaders(token) }),

    listRevisions: (id, token) =>
      request(`${projectPath(id)}/revisions`, { headers: withAuthHeaders(token) }),

    detachProject: (id, token) =>
      request(`${projectPath(id)}/detach`, { method: 'POST', headers: withAuthHeaders(token) }),
  };
}
