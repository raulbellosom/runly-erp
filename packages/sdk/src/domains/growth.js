export function createGrowthDomain({
  request,
  requestBlob,
  withAuthHeaders,
  toQueryString,
}) {
  const leadPath = (leadId) => `/growth/leads/${encodeURIComponent(leadId)}`;
  const analyticsReport = (report, token, query = {}) =>
    request(`/growth/analytics/${report}${toQueryString(query)}`, {
      headers: withAuthHeaders(token),
    });

  return {
    listAnalyticsSites: (token) =>
      request("/growth/analytics/sites", {
        headers: withAuthHeaders(token),
      }),

    listProperties: (token) =>
      request("/growth/properties", {
        headers: withAuthHeaders(token),
      }),

    createProperty: (payload, token) =>
      request("/growth/properties", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    updateProperty: (propertyId, payload, token) =>
      request(`/growth/properties/${encodeURIComponent(propertyId)}`, {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    verifyProperty: (propertyId, token) =>
      request(`/growth/properties/${encodeURIComponent(propertyId)}/verify`, {
        method: "POST",
        headers: withAuthHeaders(token),
      }),

    listForms: (token, { propertyId } = {}) =>
      request(`/growth/forms${toQueryString({ propertyId })}`, {
        headers: withAuthHeaders(token),
      }),

    listFormAssignees: (token) =>
      request("/growth/forms/assignees", {
        headers: withAuthHeaders(token),
      }),

    getForm: (formId, token) =>
      request(`/growth/forms/${encodeURIComponent(formId)}`, {
        headers: withAuthHeaders(token),
      }),

    createForm: (payload, token) =>
      request("/growth/forms", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    deleteForm: (formId, token) =>
      request(`/growth/forms/${encodeURIComponent(formId)}`, {
        method: "DELETE",
        headers: withAuthHeaders(token),
      }),

    getAnalyticsOverview: (token, query = {}) =>
      analyticsReport("overview", token, query),

    getAnalyticsAcquisition: (token, query = {}) =>
      analyticsReport("acquisition", token, query),

    getAnalyticsContent: (token, query = {}) =>
      analyticsReport("content", token, query),

    getAnalyticsConversions: (token, query = {}) =>
      analyticsReport("conversions", token, query),

    getAnalyticsRetention: (token, query = {}) =>
      analyticsReport("retention", token, query),

    exportAnalyticsCsv: (token, query) =>
      requestBlob(
        `/growth/analytics/export.csv${toQueryString(query)}`,
        { headers: withAuthHeaders(token) },
      ),

    getLeadSummary: (token, query = {}) =>
      request(`/growth/leads/summary${toQueryString(query)}`, {
        headers: withAuthHeaders(token),
      }),

    listLeads: (token, query = {}) =>
      request(`/growth/leads${toQueryString(query)}`, {
        headers: withAuthHeaders(token),
      }),

    listLeadAssignees: (token) =>
      request("/growth/leads/assignees", {
        headers: withAuthHeaders(token),
      }),

    getLead: (leadId, token) =>
      request(leadPath(leadId), {
        headers: withAuthHeaders(token),
      }),

    createLead: (payload, token) =>
      request("/growth/leads", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    updateLead: (leadId, payload, token) =>
      request(leadPath(leadId), {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    addLeadNote: (leadId, noteOrPayload, token, updatedAt) =>
      request(`${leadPath(leadId)}/notes`, {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(
          typeof noteOrPayload === "string"
            ? { note: noteOrPayload, updatedAt }
            : noteOrPayload,
        ),
      }),

    convertLead: (leadId, payload, token) =>
      request(`${leadPath(leadId)}/convert`, {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    setLeadEnabled: (leadId, enabledOrPayload, token, updatedAt) =>
      request(`${leadPath(leadId)}/enabled`, {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(
          typeof enabledOrPayload === "boolean"
            ? { enabled: enabledOrPayload, updatedAt }
            : enabledOrPayload,
        ),
      }),

    listLeadComments: (leadId, token) =>
      request(`${leadPath(leadId)}/comments`, {
        headers: withAuthHeaders(token),
      }),

    createLeadComment: (leadId, body, token) =>
      request(`${leadPath(leadId)}/comments`, {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify({ body }),
      }),

    updateLeadComment: (leadId, commentId, body, token) =>
      request(`${leadPath(leadId)}/comments/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify({ body }),
      }),

    deleteLeadComment: (leadId, commentId, token) =>
      request(`${leadPath(leadId)}/comments/${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        headers: withAuthHeaders(token),
      }),

    toggleLeadCommentReaction: (leadId, commentId, emoji, token) =>
      request(`${leadPath(leadId)}/comments/${encodeURIComponent(commentId)}/reactions`, {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify({ emoji }),
      }),
  };
}
