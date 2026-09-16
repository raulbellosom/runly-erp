import { createWebsiteDomain } from "./domains/website.js";
import { createGrowthDomain } from "./domains/growth.js";
import { createDocumentsDomain } from "./domains/documents.js";
import { createChatDomain } from "./domains/chat.js";
import { createCallsDomain } from "./domains/calls.js";

export function createRunlyClient({ baseUrl, getActiveCompanyId } = {}) {
  let _offlineTransport = null;

  function withAuthHeaders(token, headers = {}) {
    const merged = token ? { ...headers, Authorization: `Bearer ${token}` } : { ...headers };
    const companyId = typeof getActiveCompanyId === "function" ? getActiveCompanyId() : null;
    if (companyId) merged["X-Runly-Company-Id"] = companyId;
    return merged;
  }

  function toQueryString(query) {
    if (!query) return "";
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  async function requestBlob(path, options = {}) {
    const { headers, ...rest } = options;
    const response = await fetch(`${baseUrl}${path}`, {
      headers: headers ?? {},
      ...rest,
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `Runly API error ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  async function request(path, options = {}) {
    const { onlineOnly = false, ...fetchOptions } = options;
    const isFormData = options.body instanceof FormData;
    const method = (options.method ?? "GET").toUpperCase();
    // DELETE is intentionally excluded: Runly ERP uses soft-delete (PATCH enabled=false) for
    // offline-safe deletions. Hard DELETEs are not queued to avoid replay-after-recreate races.
    const MUTATION_METHODS = ["POST", "PUT", "PATCH"];
    const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    if (
      !isOnline &&
      !onlineOnly &&
      _offlineTransport &&
      MUTATION_METHODS.includes(method) &&
      !isFormData
    ) {
      const queued = await _offlineTransport.queue(path, options);
      if (queued) return queued;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      headers: isFormData
        ? (options.headers ?? {})
        : { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      const text = await response.text();
      let details = null;
      let message = text || `Runly API error ${response.status}`;
      try {
        details = text ? JSON.parse(text) : null;
        if (details?.error) {
          message = details.error;
        }
      } catch {}

      const error = new Error(message);
      error.status = response.status;
      error.responseText = text;
      error.details = details;
      throw error;
    }
    return response.json();
  }

  return {
    health: () => request("/health"),
    instance: { status: () => request("/instance/status") },
    setup: {
      initialize: (formData) =>
        request("/setup/initialize", { method: "POST", body: formData }),
    },
    auth: {
      me: (token) =>
        request("/user/me", { headers: { Authorization: `Bearer ${token}` } }),
    },
    profile: {
      me: (token) =>
        request("/profile/me", { headers: withAuthHeaders(token) }),
      updateMe: (data, token) =>
        request("/profile/me", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      uploadAvatar: (file, token) => {
        const formData = new FormData();
        formData.append("avatar", file);
        return request("/profile/me/avatar", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: formData,
        });
      },
      getAvatarSignedUrl: (token, options = {}) =>
        request(`/profile/me/avatar/signed-url${toQueryString({ variant: options.variant })}`, {
          headers: withAuthHeaders(token),
        }),
      changePassword: (data, token) =>
        request("/profile/me/password", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getPreference: (key, token) =>
        request(`/profile/me/preferences/${encodeURIComponent(key)}`, {
          headers: withAuthHeaders(token),
        }),
      setPreference: (key, value, token) =>
        request(`/profile/me/preferences/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ value }),
        }),
      getTablePreference: (tableKey, token) =>
        request(
          `/profile/me/table-preferences/${encodeURIComponent(tableKey)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      setTablePreference: (tableKey, config, token) =>
        request(
          `/profile/me/table-preferences/${encodeURIComponent(tableKey)}`,
          {
            method: "PUT",
            headers: withAuthHeaders(token),
            body: JSON.stringify(config),
          },
        ),
      deleteTablePreference: (tableKey, token) =>
        request(
          `/profile/me/table-preferences/${encodeURIComponent(tableKey)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
    },
    instanceConfig: {
      get: (token) =>
        request("/instance/config", { headers: withAuthHeaders(token) }),
      update: (data, token) =>
        request("/instance/config", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
    },
    company: {
      // Platform-level: creates a brand-new company/tenant (system-admin
      // only). Distinct from the rest of this group, which always operates
      // on the requester's currently-active company.
      create: (data, token) =>
        request("/companies", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getProfile: (token) =>
        request("/company/profile", { headers: withAuthHeaders(token) }),
      updateProfile: (data, token) =>
        request("/company/profile", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getAddress: (token) =>
        request("/company/address", { headers: withAuthHeaders(token) }),
      updateAddress: (data, token) =>
        request("/company/address", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getBranding: (token) =>
        request("/company/branding", { headers: withAuthHeaders(token) }),
      updateBranding: (data, token) =>
        request("/company/branding", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
    },
    memberships: {
      me: (token) =>
        request("/memberships/me", {
          headers: withAuthHeaders(token),
        }),
    },
    modules: {
      list: (token) => request("/modules", { headers: withAuthHeaders(token) }),
      getAvailable: (token) =>
        request("/modules/available", { headers: withAuthHeaders(token) }),
      install: (manifest, token) =>
        request("/modules/install", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ manifest }),
        }),
      sync: (token, options = null) =>
        request("/modules/sync", {
          method: "POST",
          headers: withAuthHeaders(token),
          ...(options && typeof options === "object"
            ? { body: JSON.stringify(options) }
            : {}),
        }),
      getLifecycle: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/lifecycle`, {
          headers: withAuthHeaders(token),
        }),
      getError: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/error`, {
          headers: withAuthHeaders(token),
        }),
      retryInstall: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/retry-install`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      clearError: (key, mode = "preserve-data", token) =>
        request(`/modules/${encodeURIComponent(key)}/clear-error`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ mode }),
        }),
      cleanupDryRun: (key, mode = "purge-empty-tables", token) =>
        request(`/modules/${encodeURIComponent(key)}/cleanup-dry-run`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ mode }),
        }),
      cleanup: (key, mode = "purge-empty-tables", confirmation, token) =>
        request(`/modules/${encodeURIComponent(key)}/cleanup`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ mode, confirmation }),
        }),
      listMigrations: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/migrations`, {
          headers: withAuthHeaders(token),
        }),
      disable: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/disable`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      enable: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/enable`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      uninstall: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      uninstallDryRun: (key, token, mode = "preserve-data") =>
        request(`/modules/${encodeURIComponent(key)}/uninstall/dry-run`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ mode }),
        }),
      uninstallExplicit: (key, mode, confirmation, token) =>
        request(`/modules/${encodeURIComponent(key)}/uninstall`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ mode, confirmation }),
        }),
      resetDryRun: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/reset/dry-run`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      reset: (key, confirmation, token) =>
        request(`/modules/${encodeURIComponent(key)}/reset`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ confirmation }),
        }),
      seed: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/seed`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      uploadModuleZip: (key, formData, token) =>
        request(`/modules/${encodeURIComponent(key)}/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          // Do NOT set Content-Type — fetch sets the multipart boundary automatically
          body: formData,
        }),
      purgeModule: (key, token) =>
        request(`/modules/${encodeURIComponent(key)}/purge`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
    },
    runtime: {
      modules: (token) =>
        request("/runtime/modules", {
          headers: withAuthHeaders(token),
        }),
    },
    search: {
      global: (q, { limit } = {}, token) =>
        request(`/search${toQueryString({ q, limit })}`, {
          headers: withAuthHeaders(token),
        }),
    },
    blueprints: {
      list: (token) =>
        request("/blueprints", {
          headers: withAuthHeaders(token),
        }),
    },
    identity: {
      listUsers: (token, query = null) =>
        request(`/identity/users${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      getUser: (id, token) =>
        request(`/identity/users/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateMembership: (userId, membershipId, data, token) =>
        request(
          `/identity/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(membershipId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      createMembership: (userId, data, token) =>
        request(`/identity/users/${encodeURIComponent(userId)}/memberships`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listCompanyOptions: (token) =>
        request("/identity/companies-options", { headers: withAuthHeaders(token) }),
      listRoleMembers: (roleId, token) =>
        request(`/identity/roles/${encodeURIComponent(roleId)}/members`, {
          headers: withAuthHeaders(token),
        }),
      updateUser: (id, data, token) =>
        request(`/identity/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setUsersEnabled: (ids, enabled, token) =>
        request("/identity/users/bulk/enabled", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids, enabled }),
        }),
      deleteUsersBulk: (ids, token) =>
        request("/identity/users/bulk", {
          method: "DELETE",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
      exportUsersExcel: (ids, token) =>
        requestBlob("/identity/users/export/excel", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
      exportUsersPdf: (ids, token) =>
        requestBlob("/identity/users/export/pdf", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
      uploadUserAvatar: (id, file, token) => {
        const formData = new FormData();
        formData.append("avatar", file);
        return request(`/identity/users/${encodeURIComponent(id)}/avatar`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: formData,
        });
      },
      getUserAvatarSignedUrl: (id, token, options = {}) =>
        request(`/identity/users/${encodeURIComponent(id)}/avatar/signed-url${toQueryString({ variant: options.variant })}`, {
          headers: withAuthHeaders(token),
        }),
      listRoles: (token) =>
        request("/identity/roles", { headers: withAuthHeaders(token) }),
      createRole: (data, token) =>
        request("/identity/roles", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateRole: (id, data, token) =>
        request(`/identity/roles/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setRoleEnabled: (id, enabled, token) =>
        request(`/identity/roles/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listPermissions: (token) =>
        request("/identity/permissions", { headers: withAuthHeaders(token) }),
      setRolePermissions: (id, permissionKeys, token) =>
        request(`/identity/roles/${encodeURIComponent(id)}/permissions`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ permissionKeys }),
        }),
      // Additive per-user permission grants (ALLOW-only).
      getUserPermissionGrants: (userId, token) =>
        request(`/identity/users/${encodeURIComponent(userId)}/permission-grants`, {
          headers: withAuthHeaders(token),
        }),
      setUserPermissionGrants: (userId, data, token) =>
        request(`/identity/users/${encodeURIComponent(userId)}/permission-grants`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      createUser: (data, token) =>
        request("/identity/users", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteUser: (id, token) =>
        request(`/identity/users/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      deleteRole: (id, token) =>
        request(`/identity/roles/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
    },
    hr: {
      listDepartments: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.enabled !== undefined) {
          params.set("enabled", String(options.enabled));
        }
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/hr/departments?${query}` : "/hr/departments";
        return request(path, { headers: withAuthHeaders(token) });
      },
      createDepartment: (data, token) =>
        request("/hr/departments", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateDepartment: (id, data, token) =>
        request(`/hr/departments/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setDepartmentEnabled: (id, enabled, token) =>
        request(`/hr/departments/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listJobTitles: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.enabled !== undefined) {
          params.set("enabled", String(options.enabled));
        }
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/hr/job-titles?${query}` : "/hr/job-titles";
        return request(path, { headers: withAuthHeaders(token) });
      },
      createJobTitle: (data, token) =>
        request("/hr/job-titles", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateJobTitle: (id, data, token) =>
        request(`/hr/job-titles/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setJobTitleEnabled: (id, enabled, token) =>
        request(`/hr/job-titles/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      getOrgChart: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.rootEmployeeId) {
          params.set("rootEmployeeId", options.rootEmployeeId);
        }
        if (options.enabled !== undefined) {
          params.set("enabled", String(options.enabled));
        }
        const query = params.toString();
        const path = query ? `/hr/org-chart?${query}` : "/hr/org-chart";
        return request(path, { headers: withAuthHeaders(token) });
      },
      listEmployees: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.status) params.set("status", options.status);
        if (options.enabled !== undefined) {
          params.set("enabled", String(options.enabled));
        }
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/hr/employees?${query}` : "/hr/employees";
        return request(path, { headers: withAuthHeaders(token) });
      },
      getEmployee: (id, token) =>
        request(`/hr/employees/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      createEmployee: (data, token) =>
        request("/hr/employees", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateEmployee: (id, data, token) =>
        request(`/hr/employees/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setEmployeeEnabled: (id, enabled, token) =>
        request(`/hr/employees/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      getEmployeeAudit: (id, token, options = {}) => {
        const params = new URLSearchParams();
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query
          ? `/hr/employees/${encodeURIComponent(id)}/audit?${query}`
          : `/hr/employees/${encodeURIComponent(id)}/audit`;
        return request(path, { headers: withAuthHeaders(token) });
      },
      listUserOptions: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/hr/user-options?${query}` : "/hr/user-options";
        return request(path, { headers: withAuthHeaders(token) });
      },
      exportEmployeesExcel: (ids, token) => {
        const query = ids?.length ? `?ids=${ids.join(",")}` : "";
        return requestBlob(`/hr/employees/export${query}`, {
          headers: withAuthHeaders(token),
        });
      },
      exportEmployeesPdf: (ids, token) => {
        const query = ids?.length ? `?ids=${ids.join(",")}` : "";
        return requestBlob(`/hr/employees/export/pdf${query}`, {
          headers: withAuthHeaders(token),
        });
      },
    },
    contacts: {
      list: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/contacts?${query}` : "/contacts";
        return request(path, { headers: withAuthHeaders(token) });
      },
      picker: (token, options = {}) => {
        const params = new URLSearchParams();
        if (options.q) params.set("q", options.q);
        if (options.limit) params.set("limit", String(options.limit));
        const query = params.toString();
        const path = query ? `/contacts/picker?${query}` : "/contacts/picker";
        return request(path, { headers: withAuthHeaders(token) });
      },
      create: (data, token) =>
        request("/contacts", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getById: (id, token) =>
        request(`/contacts/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      update: (id, data, token) =>
        request(`/contacts/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setEnabled: (id, enabled, token) =>
        request(`/contacts/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      delete: (id, token) =>
        request(`/contacts/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      setContactsEnabled: (ids, enabled, token) =>
        request("/contacts/bulk/enabled", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids, enabled }),
        }),
      deleteContactsBulk: (ids, token) =>
        request("/contacts/bulk", {
          method: "DELETE",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
      exportContactsExcel: (ids, token) =>
        requestBlob("/contacts/export/excel", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
      exportContactsPdf: (ids, token) =>
        requestBlob("/contacts/export/pdf", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ ids }),
        }),
    },
    files: {
      createDocument: (data, token) => request('/files/documents', { method: 'POST', headers: withAuthHeaders(token), body: JSON.stringify(data), onlineOnly: true }),
      getAccess: (id, token) => request(`/files/${encodeURIComponent(id)}/access`, { headers: withAuthHeaders(token), onlineOnly: true }),
      updateAccess: (id, data, token) => request(`/files/${encodeURIComponent(id)}/access`, { method: 'PATCH', headers: withAuthHeaders(token), body: JSON.stringify(data), onlineOnly: true }),
      accessMembers: (id, q, token) => request(`/files/${encodeURIComponent(id)}/members${toQueryString({ q })}`, { headers: withAuthHeaders(token), onlineOnly: true }),
      invitations: (page, token) => request(`/files/invitations${toQueryString({ page })}`, { headers: withAuthHeaders(token), onlineOnly: true }),
      respondInvitation: (id, accept, token) => request(`/files/invitations/${encodeURIComponent(id)}/respond`, { method: 'POST', headers: withAuthHeaders(token), body: JSON.stringify({ accept }), onlineOnly: true }),
      officeStatus: (token) => request('/files/office/status', { headers: withAuthHeaders(token) }),
      downloadOfficeFile: (id, token) => requestBlob(`/files/${encodeURIComponent(id)}/office/download`, { headers: withAuthHeaders(token) }),
      createOfficeSession: (id, mode = 'auto', token) => request(`/files/${encodeURIComponent(id)}/office/session`, {
        method: 'POST', headers: withAuthHeaders(token), body: JSON.stringify({ mode }), onlineOnly: true,
      }),
      upload: (formData, token) =>
        request("/files/upload", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: formData,
        }),
      list: (params = {}, token) => {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null || value === "") continue;
          search.set(key, String(value));
        }
        const query = search.toString();
        return request(query ? `/files?${query}` : "/files", {
          headers: withAuthHeaders(token),
        });
      },
      get: (id, token) =>
        request(`/files/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      getSignedUrl: (id, token, options = {}) =>
        request(`/files/${encodeURIComponent(id)}/signed-url${toQueryString({ variant: options.variant })}`, {
          headers: withAuthHeaders(token),
        }),
      batchSignedUrls: (fileIds, token) =>
        request("/files/batch-signed-urls", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ fileIds }),
        }),
      rename: (id, data, token) =>
        request(`/files/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      bulkDownload: (payload, token) =>
        request("/files/bulk-download", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
      setEnabled: (id, enabled, token) =>
        request(`/files/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      delete: (id, token) =>
        request(`/files/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      setCover: (id, token) =>
        request(`/files/${encodeURIComponent(id)}/cover`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      reorder: (items, token) =>
        request("/files/reorder", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
    },
    ledger: {
      listAccounts: (token, options = {}) =>
        request(`/ledger/accounts${toQueryString(options)}`, {
          headers: withAuthHeaders(token),
        }),
      createAccount: (data, token) =>
        request("/ledger/accounts", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getAccount: (id, token) =>
        request(`/ledger/accounts/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateAccount: (id, data, token) =>
        request(`/ledger/accounts/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setAccountEnabled: (id, enabled, token) =>
        request(`/ledger/accounts/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listAccountTransactions: (id, token, query = {}) =>
        request(
          `/ledger/accounts/${encodeURIComponent(id)}/transactions${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      createTransaction: (id, data, token) =>
        request(`/ledger/accounts/${encodeURIComponent(id)}/transactions`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTransaction: (accountId, txId, data, token) =>
        request(
          `/ledger/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      setTransactionEnabled: (accountId, txId, enabled, token) =>
        request(
          `/ledger/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}/enabled`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify({ enabled }),
          },
        ),
      getAccountSummary: (id, token, query = {}) =>
        request(
          `/ledger/accounts/${encodeURIComponent(id)}/summary${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      listCategories: (token, query = {}) =>
        request(`/ledger/categories${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createCategory: (data, token) =>
        request("/ledger/categories", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCategory: (id, data, token) =>
        request(`/ledger/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setCategoryEnabled: (id, enabled, token) =>
        request(`/ledger/categories/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listTypes: (token, query = {}) =>
        request(`/ledger/types${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createType: (data, token) =>
        request("/ledger/types", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateType: (id, data, token) =>
        request(`/ledger/types/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setTypeEnabled: (id, enabled, token) =>
        request(`/ledger/types/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      previewImport: (accountId, payload, token) =>
        request(
          `/ledger/accounts/${encodeURIComponent(accountId)}/import/preview`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(payload ?? {}),
          },
        ),
      commitImport: (accountId, payload, token) =>
        request(
          `/ledger/accounts/${encodeURIComponent(accountId)}/import/commit`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(payload ?? {}),
          },
        ),
      exportAccountXlsx: (id, token, query = {}) =>
        requestBlob(
          `/ledger/accounts/${encodeURIComponent(id)}/export/xlsx${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      exportAccountCsv: (id, token, query = {}) =>
        requestBlob(
          `/ledger/accounts/${encodeURIComponent(id)}/export/csv${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      exportAccountPdf: (id, token, query = {}) =>
        requestBlob(
          `/ledger/accounts/${encodeURIComponent(id)}/export/pdf${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
    },
    pfm: {
      listWallets: (token) =>
        request("/pfm/wallets", { headers: withAuthHeaders(token) }),
      getWallet: (id, token) =>
        request(`/pfm/wallets/${encodeURIComponent(id)}`, { headers: withAuthHeaders(token) }),
      createWallet: (data, token) =>
        request("/pfm/wallets", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateWallet: (id, data, token) =>
        request(`/pfm/wallets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setWalletEnabled: (id, enabled, token) =>
        request(`/pfm/wallets/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listWalletMembers: (id, token) =>
        request(`/pfm/wallets/${encodeURIComponent(id)}/members`, {
          headers: withAuthHeaders(token),
        }),
      upsertWalletMember: (id, data, token) =>
        request(`/pfm/wallets/${encodeURIComponent(id)}/members`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      removeWalletMember: (id, userId, token) =>
        request(
          `/pfm/wallets/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
      listCategories: (token, query = {}) =>
        request(`/pfm/categories${toQueryString(query)}`, { headers: withAuthHeaders(token) }),
      createCategory: (data, token) =>
        request("/pfm/categories", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCategory: (id, data, token) =>
        request(`/pfm/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setCategoryEnabled: (id, enabled, token) =>
        request(`/pfm/categories/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listWalletMovements: (walletId, token, query = {}) =>
        request(
          `/pfm/wallets/${encodeURIComponent(walletId)}/movements${toQueryString(query)}`,
          {
            headers: withAuthHeaders(token),
          },
        ),
      createWalletMovement: (walletId, data, token) =>
        request(`/pfm/wallets/${encodeURIComponent(walletId)}/movements`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      adjustWalletBalance: (walletId, data, token) =>
        request(`/pfm/wallets/${encodeURIComponent(walletId)}/adjust`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateMovement: (movementId, data, token) =>
        request(`/pfm/movements/${encodeURIComponent(movementId)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setMovementEnabled: (movementId, enabled, token) =>
        request(`/pfm/movements/${encodeURIComponent(movementId)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      confirmMovement: (movementId, amount, token) =>
        request(`/pfm/movements/${encodeURIComponent(movementId)}/confirm`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(amount === undefined ? {} : { amount }),
        }),
      skipMovement: (movementId, token) =>
        request(`/pfm/movements/${encodeURIComponent(movementId)}/skip`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      enrichLedgerMovement: (walletId, ltxId, data, token) =>
        request(
          `/pfm/wallets/${encodeURIComponent(walletId)}/ledger-movements/${encodeURIComponent(ltxId)}/enrichment`,
          {
            method: "PUT",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      getSummary: (token, query = {}) =>
        request(`/pfm/summary${toQueryString(query)}`, { headers: withAuthHeaders(token) }),
      listRecurringRules: (token) =>
        request("/pfm/recurring", { headers: withAuthHeaders(token) }),
      createRecurringRule: (data, token) =>
        request("/pfm/recurring", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateRecurringRule: (id, data, token) =>
        request(`/pfm/recurring/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setRecurringRuleEnabled: (id, enabled, token) =>
        request(`/pfm/recurring/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listUpcoming: (token, query = {}) =>
        request(`/pfm/upcoming${toQueryString(query)}`, { headers: withAuthHeaders(token) }),
      listReceipts: (token) =>
        request("/pfm/receipts", { headers: withAuthHeaders(token) }),
      getReceipt: (id, token) =>
        request(`/pfm/receipts/${encodeURIComponent(id)}`, { headers: withAuthHeaders(token) }),
      uploadReceipt: (formData, token) =>
        request("/pfm/receipts", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: formData,
        }),
      confirmReceipt: (id, data, token) =>
        request(`/pfm/receipts/${encodeURIComponent(id)}/confirm`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      retryReceipt: (id, token) =>
        request(`/pfm/receipts/${encodeURIComponent(id)}/retry`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      listBudgets: (token, query = {}) =>
        request(`/pfm/budgets${toQueryString(query)}`, { headers: withAuthHeaders(token) }),
      createBudget: (data, token) =>
        request("/pfm/budgets", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateBudget: (id, data, token) =>
        request(`/pfm/budgets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setBudgetEnabled: (id, enabled, token) =>
        request(`/pfm/budgets/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      listGoals: (token) => request("/pfm/goals", { headers: withAuthHeaders(token) }),
      createGoal: (data, token) =>
        request("/pfm/goals", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateGoal: (id, data, token) =>
        request(`/pfm/goals/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      setGoalEnabled: (id, enabled, token) =>
        request(`/pfm/goals/${encodeURIComponent(id)}/enabled`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        }),
      contributeGoal: (id, amount, token) =>
        request(`/pfm/goals/${encodeURIComponent(id)}/contribute`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ amount }),
        }),
      assistant: {
        status: (token) =>
          request("/pfm/assistant/status", { headers: withAuthHeaders(token) }),
        listThreads: (token) =>
          request("/pfm/assistant/threads", { headers: withAuthHeaders(token) }),
        createThread: (token) =>
          request("/pfm/assistant/threads", {
            method: "POST",
            headers: withAuthHeaders(token),
          }),
        getThread: (id, token) =>
          request(`/pfm/assistant/threads/${encodeURIComponent(id)}`, {
            headers: withAuthHeaders(token),
          }),
        sendMessage: (id, content, token) =>
          request(`/pfm/assistant/threads/${encodeURIComponent(id)}/messages`, {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify({ content }),
          }),
        deleteThread: (id, token, { purge = false } = {}) =>
          request(
            `/pfm/assistant/threads/${encodeURIComponent(id)}${purge ? "?purge=1" : ""}`,
            { method: "DELETE", headers: withAuthHeaders(token) },
          ),
      },
    },
    catalog: {
      // Products
      listProducts: (token, options = {}) =>
        request(`/catalog/products${toQueryString(options)}`, {
          headers: withAuthHeaders(token),
        }),
      getProduct: (id, token) =>
        request(`/catalog/products/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      createProduct: (data, token) =>
        request("/catalog/products", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateProduct: (id, data, token) =>
        request(`/catalog/products/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteProduct: (id, token) =>
        request(`/catalog/products/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      publishProduct: (id, token) =>
        request(`/catalog/products/${encodeURIComponent(id)}/publish`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      unpublishProduct: (id, token) =>
        request(`/catalog/products/${encodeURIComponent(id)}/unpublish`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      // Options
      listOptions: (productId, token) =>
        request(`/catalog/products/${encodeURIComponent(productId)}/options`, {
          headers: withAuthHeaders(token),
        }),
      createOption: (productId, data, token) =>
        request(`/catalog/products/${encodeURIComponent(productId)}/options`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateOption: (productId, optionId, data, token) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/options/${encodeURIComponent(optionId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteOption: (productId, optionId, token) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/options/${encodeURIComponent(optionId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      // Variants
      listVariants: (productId, token) =>
        request(`/catalog/products/${encodeURIComponent(productId)}/variants`, {
          headers: withAuthHeaders(token),
        }),
      createVariant: (productId, data, token) =>
        request(`/catalog/products/${encodeURIComponent(productId)}/variants`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateVariant: (productId, variantId, data, token) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteVariant: (productId, variantId, token) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      // Stock
      recordStockMovement: (productId, data, token) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/stock-movements`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      listStockMovements: (productId, token, options = {}) =>
        request(
          `/catalog/products/${encodeURIComponent(productId)}/stock-movements${toQueryString(options)}`,
          { headers: withAuthHeaders(token) },
        ),
      // Categories
      listCategories: (token, options = {}) =>
        request(`/catalog/categories${toQueryString(options)}`, {
          headers: withAuthHeaders(token),
        }),
      createCategory: (data, token) =>
        request("/catalog/categories", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCategory: (id, data, token) =>
        request(`/catalog/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteCategory: (id, token) =>
        request(`/catalog/categories/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
    },
    pos: {
      getSettings: (token) =>
        request("/pos/settings", { headers: withAuthHeaders(token) }),
      updateSettings: (data, token) =>
        request("/pos/settings", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listOutlets: (token) =>
        request("/pos/outlets", { headers: withAuthHeaders(token) }),
      createOutlet: (data, token) =>
        request("/pos/outlets", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateOutlet: (id, data, token) =>
        request(`/pos/outlets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listTerminals: (token) =>
        request("/pos/terminals", { headers: withAuthHeaders(token) }),
      createTerminal: (data, token) =>
        request("/pos/terminals", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTerminal: (id, data, token) =>
        request(`/pos/terminals/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listPaymentMethods: (token) =>
        request("/pos/payment-methods", { headers: withAuthHeaders(token) }),
      createPaymentMethod: (data, token) =>
        request("/pos/payment-methods", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updatePaymentMethod: (id, data, token) =>
        request(`/pos/payment-methods/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      openSession: (data, token) =>
        request("/pos/sessions/open", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getCurrentSession: (query, token) =>
        request(`/pos/sessions/current${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      listSessions: (query, token) =>
        request(`/pos/sessions${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      getSession: (id, token) =>
        request(`/pos/sessions/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      addCashMovement: (id, data, token) =>
        request(`/pos/sessions/${encodeURIComponent(id)}/cash-movements`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getExpectedCashAmount: (id, token) =>
        request(`/pos/sessions/${encodeURIComponent(id)}/expected-cash`, {
          headers: withAuthHeaders(token),
        }),
      closeSession: (id, data, token) =>
        request(`/pos/sessions/${encodeURIComponent(id)}/close`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listWaiterShifts: (query, token) =>
        request(`/pos/waiter-shifts${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      currentWaiterShift: (query, token) =>
        request(`/pos/waiter-shifts/current${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      openWaiterShift: (data, token) =>
        request("/pos/waiter-shifts/open", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      closeWaiterShift: (id, data, token) =>
        request(`/pos/waiter-shifts/${encodeURIComponent(id)}/close`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listOrders: (query, token) =>
        request(`/pos/orders${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createOrder: (data, token) =>
        request("/pos/orders", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getOrder: (id, token) =>
        request(`/pos/orders/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateOrder: (id, data, token) =>
        request(`/pos/orders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      addGuest: (orderId, data, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/guests`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      addOrderLine: (orderId, data, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/lines`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateOrderLine: (orderId, lineId, data, token) =>
        request(
          `/pos/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteOrderLine: (orderId, lineId, token) =>
        request(
          `/pos/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      addPayment: (orderId, data, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/payments`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      sendToKitchen: (orderId, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/send-to-kitchen`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      cancelOrder: (orderId, data, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data ?? {}),
        }),
      reprintReceipt: (orderId, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/receipts/reprint`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      listFloors: (query, token) =>
        request(`/pos/floors${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createFloor: (data, token) =>
        request("/pos/floors", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getFloor: (id, query, token) =>
        request(`/pos/floors/${encodeURIComponent(id)}${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      updateFloor: (id, data, token) =>
        request(`/pos/floors/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      publishFloor: (id, token) =>
        request(`/pos/floors/${encodeURIComponent(id)}/publish`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      saveFloorLayout: (id, data, token) =>
        request(`/pos/floors/${encodeURIComponent(id)}/layout`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      createTable: (data, token) =>
        request("/pos/tables", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTable: (tableId, data, token) =>
        request(`/pos/tables/${encodeURIComponent(tableId)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTableStatus: (tableId, data, token) =>
        request(`/pos/tables/${encodeURIComponent(tableId)}/status`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      assignOrderWaiter: (orderId, data, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/waiter`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      claimOrder: (orderId, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/claim`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      getOrderSeatTotals: (orderId, token) =>
        request(`/pos/orders/${encodeURIComponent(orderId)}/seat-totals`, {
          headers: withAuthHeaders(token),
        }),
      assignTableWaiter: (tableId, data, token) =>
        request(`/pos/tables/${encodeURIComponent(tableId)}/waiter`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getActiveMap: (query, token) =>
        request(`/pos/tables/active-map${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      listReservations: (query, token) =>
        request(`/pos/reservations${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createReservation: (data, token) =>
        request("/pos/reservations", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getReservation: (id, token) =>
        request(`/pos/reservations/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateReservation: (id, data, token) =>
        request(`/pos/reservations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      seatReservation: (id, data, token) =>
        request(`/pos/reservations/${encodeURIComponent(id)}/seat`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listStations: (query, token) =>
        request(`/pos/stations${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      createStation: (data, token) =>
        request("/pos/stations", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateStation: (id, data, token) =>
        request(`/pos/stations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listStationTickets: (stationId, query, token) =>
        request(`/pos/stations/${encodeURIComponent(stationId)}/tickets${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      updateTicketStatus: (ticketId, data, token) =>
        request(`/pos/kitchen/tickets/${encodeURIComponent(ticketId)}/status`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTicketLineStatus: (ticketId, lineId, data, token) =>
        request(
          `/pos/kitchen/tickets/${encodeURIComponent(ticketId)}/lines/${encodeURIComponent(lineId)}/status`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      listProductModifierGroups: (productId, query, token) =>
        request(`/pos/products/${encodeURIComponent(productId)}/modifier-groups${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      listModifierGroups: (query, token) =>
        request(`/pos/modifier-groups${toQueryString(query)}`, { headers: withAuthHeaders(token) }),
      createModifierGroup: (productId, data, token) =>
        request(`/pos/products/${encodeURIComponent(productId)}/modifier-groups`, {
          method: "POST", headers: withAuthHeaders(token), body: JSON.stringify(data),
        }),
      updateModifierGroup: (id, data, token) =>
        request(`/pos/modifier-groups/${encodeURIComponent(id)}`, {
          method: "PATCH", headers: withAuthHeaders(token), body: JSON.stringify(data),
        }),
      createModifierOption: (groupId, data, token) =>
        request(`/pos/modifier-groups/${encodeURIComponent(groupId)}/options`, {
          method: "POST", headers: withAuthHeaders(token), body: JSON.stringify(data),
        }),
      updateModifierOption: (id, data, token) =>
        request(`/pos/modifier-options/${encodeURIComponent(id)}`, {
          method: "PATCH", headers: withAuthHeaders(token), body: JSON.stringify(data),
        }),
      listProductConfigs: (token) =>
        request("/pos/product-configs", { headers: withAuthHeaders(token) }),
      updateProductConfig: (productId, data, token) =>
        request(`/pos/products/${encodeURIComponent(productId)}/config`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
    },
    notifications: {
      list: (token, query = {}) =>
        request(`/notifications${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      getWebPushPublicKey: (token) =>
        request("/notifications/subscriptions/webpush/public-key", {
          headers: withAuthHeaders(token),
        }),
      markRead: (token, id) =>
        request(`/notifications/${encodeURIComponent(id)}/read`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      markAllRead: (token) =>
        request("/notifications/read-all", {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      markReadBySource: (token, sourceType, sourceId) =>
        request("/notifications/read-by-source", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ sourceType, sourceId }),
        }),
      publish: (token, payload) =>
        request("/notifications/publish", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
      subscribeWebPush: (token, payload) =>
        request("/notifications/subscriptions/webpush", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
      unsubscribeWebPush: (token, id) =>
        request(
          `/notifications/subscriptions/webpush/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
      listPreferences: (token) =>
        request("/notifications/preferences", {
          headers: withAuthHeaders(token),
        }),
      upsertPreference: (token, payload) =>
        request("/notifications/preferences", {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
    },
    activity: {
      list: (query, token) =>
        request(`/activity${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      recent: (token, limit = 20) =>
        request(`/activity/recent${toQueryString({ limit })}`, {
          headers: withAuthHeaders(token),
        }),
      listForEntity: (entityType, entityId, token, limit = 50) =>
        request(
          `/activity/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}${toQueryString({ limit })}`,
          { headers: withAuthHeaders(token) },
        ),
      publish: (payload, token) =>
        request("/activity", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(payload),
        }),
      subscribeToken: (token) =>
        request("/activity/subscribe-token", {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      exportExcel: (queryOrOptions, token) => {
        const body =
          queryOrOptions && Array.isArray(queryOrOptions.ids)
            ? { ids: queryOrOptions.ids, query: queryOrOptions.query ?? {} }
            : { query: queryOrOptions ?? {} };
        return requestBlob("/activity/export/excel", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(body),
        });
      },
      getRealtimeChannel: ({ supabase, companyId, onInsert }) => {
        if (!supabase || typeof supabase.channel !== "function") return null;
        if (!companyId) return null;
        const channel = supabase.channel(`activity:company:${companyId}`);
        channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "activity",
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => {
            if (typeof onInsert === "function") onInsert(payload.new);
          },
        );
        return channel;
      },
    },
    website: createWebsiteDomain({ request, withAuthHeaders }),
    growth: createGrowthDomain({
      request,
      requestBlob,
      withAuthHeaders,
      toQueryString,
    }),
    documents: createDocumentsDomain({
      request,
      requestBlob,
      withAuthHeaders,
      toQueryString,
    }),
    chat: createChatDomain(request, withAuthHeaders, toQueryString),
    calls: createCallsDomain(request, withAuthHeaders),
    calendar: {
      getGoogleStatus: (token) =>
        request("/calendar/google/status", {
          headers: withAuthHeaders(token),
        }),
      startGoogleConnect: (token) =>
        request("/calendar/google/connect/start", {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      finishGoogleConnect: (query, token) =>
        request(`/calendar/google/connect/callback${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      listGoogleCalendars: (token) =>
        request("/calendar/google/calendars", {
          headers: withAuthHeaders(token),
        }),
      listGoogleSources: (token) =>
        request("/calendar/google/sources", {
          headers: withAuthHeaders(token),
        }),
      saveGoogleSources: (data, token) =>
        request("/calendar/google/sources", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      disconnectGoogleCalendar: (token, { deleteEvents = false } = {}) =>
        request("/calendar/google/disconnect", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ deleteEvents }),
        }),
      listCalendars: (token) =>
        request("/calendar/calendars", { headers: withAuthHeaders(token) }),
      createCalendar: (data, token) =>
        request("/calendar/calendars", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCalendar: (id, data, token) =>
        request(`/calendar/calendars/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteCalendar: (id, token) =>
        request(`/calendar/calendars/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      shareCalendar: (calendarId, data, token) =>
        request(`/calendar/calendars/${encodeURIComponent(calendarId)}/share`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateShare: (calendarId, shareId, data, token) =>
        request(
          `/calendar/calendars/${encodeURIComponent(calendarId)}/share/${encodeURIComponent(shareId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteShare: (calendarId, shareId, token) =>
        request(
          `/calendar/calendars/${encodeURIComponent(calendarId)}/share/${encodeURIComponent(shareId)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
      listEvents: (token, query = {}) => {
        const params = new URLSearchParams();
        if (query.start) params.set("start", query.start);
        if (query.end) params.set("end", query.end);
        if (query.source_module) params.set("source_module", query.source_module);
        if (query.source_entity_id) params.set("source_entity_id", query.source_entity_id);
        if (Array.isArray(query.calendar_ids)) {
          query.calendar_ids.forEach((id) => params.append("calendar_ids", id));
        }
        const qs = params.toString();
        return request(qs ? `/calendar/events?${qs}` : "/calendar/events", {
          headers: withAuthHeaders(token),
        });
      },
      getEvent: (id, token) =>
        request(`/calendar/events/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      createEvent: (data, token) =>
        request("/calendar/events", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateEvent: (id, data, token) =>
        request(`/calendar/events/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteEvent: (id, token) =>
        request(`/calendar/events/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      createReminder: (eventId, data, token) =>
        request(`/calendar/events/${encodeURIComponent(eventId)}/reminders`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteReminder: (eventId, reminderId, token) =>
        request(
          `/calendar/events/${encodeURIComponent(eventId)}/reminders/${encodeURIComponent(reminderId)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
      listNotifications: (token, query = {}) =>
        request(`/calendar/notifications${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      markNotificationRead: (id, token) =>
        request(`/calendar/notifications/${encodeURIComponent(id)}/read`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      markAllNotificationsRead: (token) =>
        request("/calendar/notifications/read-all", {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
    },
    projects: {
      listProjects: (token) =>
        request("/projects", { headers: withAuthHeaders(token) }),
      createProject: (data, token) =>
        request("/projects", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getProject: (id, token) =>
        request(`/projects/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateProject: (id, data, token) =>
        request(`/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      archiveProject: (id, token) =>
        request(`/projects/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      listMembers: (projectId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/members`, {
          headers: withAuthHeaders(token),
        }),
      addMember: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/members`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateMember: (projectId, userId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      removeMember: (projectId, userId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      listStatuses: (projectId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/statuses`, {
          headers: withAuthHeaders(token),
        }),
      createStatus: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/statuses`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateStatus: (projectId, statusId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/statuses/${encodeURIComponent(statusId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteStatus: (projectId, statusId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/statuses/${encodeURIComponent(statusId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      listTasks: (projectId, query, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks${toQueryString(query)}`,
          { headers: withAuthHeaders(token) },
        ),
      createTask: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getTask: (projectId, taskId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
          { headers: withAuthHeaders(token) },
        ),
      updateTask: (projectId, taskId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteTask: (projectId, taskId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      moveTask: (projectId, taskId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/move`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      listTaskAssignees: (projectId, taskId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/assignees`,
          { headers: withAuthHeaders(token) },
        ),
      addTaskAssignee: (projectId, taskId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/assignees`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      removeTaskAssignee: (projectId, taskId, userId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/assignees/${encodeURIComponent(userId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      listTaskComments: (projectId, taskId, query, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments${toQueryString(query)}`,
          { headers: withAuthHeaders(token) },
        ),
      createTaskComment: (projectId, taskId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      updateTaskComment: (projectId, taskId, commentId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteTaskComment: (projectId, taskId, commentId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      toggleTaskCommentReaction: (projectId, taskId, commentId, emoji, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}/reactions`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify({ emoji }),
          },
        ),
      listTaskAttachments: (projectId, taskId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments`,
          { headers: withAuthHeaders(token) },
        ),
      addTaskAttachment: (projectId, taskId, data, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteTaskAttachment: (projectId, taskId, fileAssetId, token) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(fileAssetId)}`,
          { method: "DELETE", headers: withAuthHeaders(token) },
        ),
      bulkUpdateTasks: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/bulk`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      bulkDeleteTasks: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/bulk`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      // dependencies
      listTaskDependencies: (projectId, taskId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dependencies`, {
          headers: withAuthHeaders(token),
        }),
      addTaskDependency: (projectId, taskId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dependencies`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      removeTaskDependency: (projectId, taskId, depId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(depId)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      // custom fields
      listProjectFields: (projectId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/fields`, {
          headers: withAuthHeaders(token),
        }),
      createProjectField: (projectId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/fields`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateProjectField: (projectId, fieldId, data, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/fields/${encodeURIComponent(fieldId)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteProjectField: (projectId, fieldId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/fields/${encodeURIComponent(fieldId)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      // task field values
      getTaskFieldValues: (projectId, taskId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/field-values`, {
          headers: withAuthHeaders(token),
        }),
      upsertTaskFieldValues: (projectId, taskId, entries, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/field-values`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(entries),
        }),
      // export
      exportProjectCsv: (projectId, token) =>
        requestBlob(`/projects/${encodeURIComponent(projectId)}/export?format=csv`, {
          headers: withAuthHeaders(token),
        }),
      syncProjectCalendar: (projectId, token) =>
        request(`/projects/${encodeURIComponent(projectId)}/calendar/sync`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
    },
    fleet: {
      getVehicleDocuments: (vehicleId, token) =>
        request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/documents`, {
          headers: withAuthHeaders(token),
        }),
      getReport: (id, token) =>
        request(`/fleet/reports/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
    },
    inventory: {
      // Items
      listItems: (params, token) =>
        request(`/inventory/items${toQueryString(params)}`, {
          headers: withAuthHeaders(token),
        }),
      getItem: (id, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      createItem: (data, token) =>
        request("/inventory/items", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateItem: (id, data, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteItem: (id, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      assignItem: (id, data, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}/assign`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      returnItem: (id, data, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}/return`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getItemAssignments: (id, token) =>
        request(`/inventory/items/${encodeURIComponent(id)}/assignments`, {
          headers: withAuthHeaders(token),
        }),
      getItemsByEmployee: (empId, token) =>
        request(`/inventory/items/by-employee/${encodeURIComponent(empId)}`, {
          headers: withAuthHeaders(token),
        }),
      // Comments
      listComments: (itemId, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/comments`, {
          headers: withAuthHeaders(token),
        }),
      createComment: (itemId, data, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/comments`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateComment: (itemId, commentId, data, token) =>
        request(
          `/inventory/items/${encodeURIComponent(itemId)}/comments/${encodeURIComponent(commentId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      deleteComment: (itemId, commentId, token) =>
        request(
          `/inventory/items/${encodeURIComponent(itemId)}/comments/${encodeURIComponent(commentId)}`,
          {
            method: "DELETE",
            headers: withAuthHeaders(token),
          },
        ),
      toggleReaction: (itemId, commentId, data, token) =>
        request(
          `/inventory/items/${encodeURIComponent(itemId)}/comments/${encodeURIComponent(commentId)}/reactions`,
          {
            method: "POST",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      // Assignments list
      listAssignments: (params, token) =>
        request(`/inventory/assignments${toQueryString(params)}`, {
          headers: withAuthHeaders(token),
        }),
      // Categories
      listCategories: (token) =>
        request("/inventory/categories", {
          headers: withAuthHeaders(token),
        }),
      createCategory: (data, token) =>
        request("/inventory/categories", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCategory: (id, data, token) =>
        request(`/inventory/categories/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteCategory: (id, token) =>
        request(`/inventory/categories/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      // Brands
      listBrands: (token) =>
        request("/inventory/brands", {
          headers: withAuthHeaders(token),
        }),
      createBrand: (data, token) =>
        request("/inventory/brands", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateBrand: (id, data, token) =>
        request(`/inventory/brands/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteBrand: (id, token) =>
        request(`/inventory/brands/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      // Locations
      listLocations: (token) =>
        request("/inventory/locations", {
          headers: withAuthHeaders(token),
        }),
      createLocation: (data, token) =>
        request("/inventory/locations", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateLocation: (id, data, token) =>
        request(`/inventory/locations/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteLocation: (id, token) =>
        request(`/inventory/locations/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      // Custom fields
      listCustomFields: (params, token) =>
        request(`/inventory/custom-fields${toQueryString(params)}`, {
          headers: withAuthHeaders(token),
        }),
      createCustomField: (data, token) =>
        request("/inventory/custom-fields", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateCustomField: (id, data, token) =>
        request(`/inventory/custom-fields/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteCustomField: (id, token) =>
        request(`/inventory/custom-fields/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      reorderCategories: (items, token) =>
        request("/inventory/categories/reorder", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
      reorderBrands: (items, token) =>
        request("/inventory/brands/reorder", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
      reorderLocations: (items, token) =>
        request("/inventory/locations/reorder", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
      reorderCustomFields: (items, token) =>
        request("/inventory/custom-fields/reorder", {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
      setItemFileCover: (itemId, docId, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/files/${encodeURIComponent(docId)}/cover`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
        }),
      reorderItemFiles: (itemId, items, token) =>
        request(`/inventory/items/${encodeURIComponent(itemId)}/files/reorder`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ items }),
        }),
    },
    notes: {
      list: (params, token) =>
        request(`/notes${toQueryString(params)}`, {
          headers: withAuthHeaders(token),
        }),
      create: (data, token) =>
        request("/notes", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      get: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      update: (id, data, token) =>
        request(`/notes/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      trash: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      restore: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/restore`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      permanentDelete: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/permanent`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      getYDoc: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/ydoc`, {
          headers: withAuthHeaders(token),
        }),
      saveYDoc: (id, stateBase64, token) =>
        request(`/notes/${encodeURIComponent(id)}/ydoc`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ state: stateBase64 }),
        }),
      getCanvas: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/canvas`, {
          headers: withAuthHeaders(token),
        }),
      saveCanvas: (id, scene, token) =>
        request(`/notes/${encodeURIComponent(id)}/canvas`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify(scene),
        }),
      getPublicCanvas: (slug) =>
        request(`/public/notes/${encodeURIComponent(slug)}/canvas`, {
          method: "GET",
        }),
      listFolders: (token) =>
        request("/notes/folders", {
          headers: withAuthHeaders(token),
        }),
      createFolder: (data, token) =>
        request("/notes/folders", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateFolder: (id, data, token) =>
        request(`/notes/folders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteFolder: (id, token) =>
        request(`/notes/folders/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      listTags: (token) =>
        request("/notes/tags", {
          headers: withAuthHeaders(token),
        }),
      createTag: (data, token) =>
        request("/notes/tags", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateTag: (id, data, token) =>
        request(`/notes/tags/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      deleteTag: (id, token) =>
        request(`/notes/tags/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      setNoteTags: (id, tagIds, token) =>
        request(`/notes/${encodeURIComponent(id)}/tags`, {
          method: "PUT",
          headers: withAuthHeaders(token),
          body: JSON.stringify({ tagIds }),
        }),
      listShares: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/shares`, {
          headers: withAuthHeaders(token),
        }),
      listShareableUsers: (search, token) =>
        request(`/notes/shareable-users${toQueryString(search ? { search } : null)}`, {
          headers: withAuthHeaders(token),
        }),
      shareNote: (id, data, token) =>
        request(`/notes/${encodeURIComponent(id)}/shares`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      updateShare: (id, shareId, data, token) =>
        request(`/notes/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      revokeShare: (id, shareId, token) =>
        request(`/notes/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`, {
          method: "DELETE",
          headers: withAuthHeaders(token),
        }),
      publish: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/publish`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      unpublish: (id, token) =>
        request(`/notes/${encodeURIComponent(id)}/unpublish`, {
          method: "POST",
          headers: withAuthHeaders(token),
        }),
      presignImage: (data, token) =>
        request("/notes/presign-image", {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      getPublic: (slug) =>
        request(`/public/notes/${encodeURIComponent(slug)}`, {
          method: "GET",
        }),
    },
    setOfflineTransport(transport) {
      _offlineTransport = transport;
    },
  };
}

// Kept for the @atlas/* package-scope compatibility system (vite.config.js):
// a custom RME3 module authored against the old @atlas/sdk import must still
// find this exact export.
export { createRunlyClient as createAtlasClient };
