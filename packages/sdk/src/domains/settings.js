export function createSettingsDomain({ request, withAuthHeaders }) {
  const get = (path, token) => request(path, { headers: withAuthHeaders(token) });
  const write = (path, method, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    // Credentials and test sends must never enter the offline mutation queue.
    onlineOnly: true,
  });
  return {
    getSmtp: (token) => get('/settings/smtp', token),
    saveSmtp: (data, token) => write('/settings/smtp', 'POST', data, token),
    testSmtp: (token) => write('/settings/smtp/test', 'POST', undefined, token),
    getWebsiteSmtp: (token) => get('/website/settings/smtp', token),
    saveWebsiteSmtp: (data, token) => write('/website/settings/smtp', 'POST', data, token),
    testWebsiteSmtp: (token) => write('/website/settings/smtp/test', 'POST', undefined, token),
    getWebPush: (token) => get('/settings/notifications/webpush', token),
    saveWebPush: (data, token) => write('/settings/notifications/webpush', 'POST', data, token),
    generateWebPush: (token) => write('/settings/notifications/webpush/generate', 'POST', undefined, token),
    clearWebPush: (token) => write('/settings/notifications/webpush', 'DELETE', undefined, token),
  };
}
