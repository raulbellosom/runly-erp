const id = (value) => encodeURIComponent(value)

export function createCanvasDomain({ request, withAuthHeaders, toQueryString }) {
  const send = (method, path, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  return {
    listTemplates: (token) => send('GET', '/canvas/templates', undefined, token),
    getMapConfig: (token) => send('GET', '/canvas/map-config', undefined, token),
    geocode: (q, token) => send('GET', `/canvas/geocode${toQueryString({ q })}`, undefined, token),
    listBoards: (token) => send('GET', '/canvas/boards', undefined, token),
    createBoard: (data, token) => send('POST', '/canvas/boards', data, token),
    getBoard: (boardId, token) => send('GET', `/canvas/boards/${id(boardId)}`, undefined, token),
    updateBoard: (boardId, data, token) => send('PATCH', `/canvas/boards/${id(boardId)}`, data, token),
    archiveBoard: (boardId, token) => send('DELETE', `/canvas/boards/${id(boardId)}`, undefined, token),
    createPage: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/pages`, data, token),
    updatePage: (boardId, pageId, data, token) => send('PATCH', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}`, data, token),
    deletePage: (boardId, pageId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}`, undefined, token),
    createLayer: (boardId, pageId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}/layers`, data, token),
    updateLayer: (boardId, pageId, layerId, data, token) => send('PATCH', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}/layers/${id(layerId)}`, data, token),
    deleteLayer: (boardId, pageId, layerId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}/layers/${id(layerId)}`, undefined, token),
    reorderLayers: (boardId, pageId, layerIds, token) => send('PATCH', `/canvas/boards/${id(boardId)}/pages/${id(pageId)}/layers/reorder`, { layerIds }, token),
    listObjects: (boardId, query, token) => send('GET', `/canvas/boards/${id(boardId)}/objects${toQueryString(query)}`, undefined, token),
    batchObjects: (boardId, operations, token) => send('POST', `/canvas/boards/${id(boardId)}/objects/batch`, { operations }, token),
    createHotspot: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/hotspots`, data, token),
    updateHotspot: (boardId, hotspotId, data, token) => send('PATCH', `/canvas/boards/${id(boardId)}/hotspots/${id(hotspotId)}`, data, token),
    deleteHotspot: (boardId, hotspotId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/hotspots/${id(hotspotId)}`, undefined, token),
    listEntityLinks: (boardId, query, token) => send('GET', `/canvas/boards/${id(boardId)}/entity-links${toQueryString(query)}`, undefined, token),
    createEntityLink: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/entity-links`, data, token),
    removeEntityLink: (boardId, linkId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/entity-links/${id(linkId)}`, undefined, token),
    addCollaborator: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/collaborators`, data, token),
    listCollaborators: (boardId, token) => send('GET', `/canvas/boards/${id(boardId)}/collaborators`, undefined, token),
    listPublicLinks: (boardId, token) => send('GET', `/canvas/boards/${id(boardId)}/public-links`, undefined, token),
    createPublicLink: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/public-links`, data, token),
    revokePublicLink: (boardId, linkId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/public-links/${id(linkId)}`, undefined, token),
    removeCollaborator: (boardId, userId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/collaborators/${id(userId)}`, undefined, token),
    listVersions: (boardId, token) => send('GET', `/canvas/boards/${id(boardId)}/versions`, undefined, token),
    createVersion: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/versions`, data, token),
    restoreVersion: (boardId, versionId, token) => send('POST', `/canvas/boards/${id(boardId)}/versions/${id(versionId)}/restore`, {}, token),
    listAttachments: (boardId, query, token) => send('GET', `/canvas/boards/${id(boardId)}/attachments${toQueryString(query)}`, undefined, token),
    addAttachment: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/attachments`, data, token),
    removeAttachment: (boardId, attachmentId, token) => send('DELETE', `/canvas/boards/${id(boardId)}/attachments/${id(attachmentId)}`, undefined, token),
    listComments: (boardId, query, token) => send('GET', `/canvas/boards/${id(boardId)}/comments${toQueryString(query)}`, undefined, token),
    createComment: (boardId, data, token) => send('POST', `/canvas/boards/${id(boardId)}/comments`, data, token),
    // ERP records a board object or hotspot can be linked to (same catalog the
    // Module Builder relation fields use).
    searchRecords: (type, search, token) => send('GET', `/relation-targets/${id(type)}/search${toQueryString({ search, pageSize: 20 })}`, undefined, token),
    // Data layer: sources an object can bind to, live resolution of bound
    // objects of a Board, and reverse references (Boards an ERP record appears in).
    listDataSources: (token) => send('GET', '/canvas/data-sources', undefined, token),
    searchDataSource: (source, q, token) => send('GET', `/canvas/data-sources/${id(source)}/search${toQueryString({ q })}`, undefined, token),
    resolveBindings: (boardId, refs, token) => send('POST', `/canvas/boards/${id(boardId)}/bindings/resolve`, { refs }, token),
    listReferences: (params, token) => send('GET', `/canvas/references${toQueryString(params)}`, undefined, token),
    // Content-aware Board search (name, description, pages, hotspots, text, linked records).
    search: (q, token) => send('GET', `/canvas/search${toQueryString({ q })}`, undefined, token),
  }
}
