import { randomUUID } from "node:crypto";

export class CanvasServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CanvasServiceError";
    this.status = status;
  }
}

// Hard ceiling for a persisted scene. A rich canvas is a few hundred KB;
// past this is abuse or a client bug.
const MAX_SCENE_BYTES = 10 * 1024 * 1024; // 10 MiB

// Only these appState keys are persisted. Everything else (scroll, zoom,
// collaborators, selection, theme...) is per-viewport and must never be
// written to the shared scene.
const ALLOWED_APP_STATE_KEYS = [
  "gridModeEnabled",
  "gridSize",
  "snapToGrid",
  "objectsSnapModeEnabled",
  "viewBackgroundColor",
];

export function whitelistAppState(appState) {
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) return {};
  const out = {};
  for (const key of ALLOWED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) out[key] = appState[key];
  }
  return out;
}

export function extractSceneText(elements) {
  if (!Array.isArray(elements)) return "";
  return elements
    .filter((el) => el && el.type === "text" && !el.isDeleted && typeof el.text === "string")
    .map((el) => el.text.trim())
    .filter(Boolean)
    .join(" ");
}

export function defaultLayer() {
  return {
    id: randomUUID(),
    name: "Capa 1",
    visible: true,
    locked: false,
    opacity: 1,
    order: 0,
  };
}

export function createCanvasService({ prisma }) {
  async function assertReadAccess(noteId, userId) {
    const [note] = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE id = ${noteId}::uuid
        AND public.runly_note_user_access(id, ${userId}::uuid, false)
        AND deleted_at IS NULL
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
          )
        )
    `;
    if (!note) throw new CanvasServiceError("Nota no encontrada", 404);
  }

  async function assertEditAccess(noteId, userId) {
    const [note] = await prisma.$queryRaw`
      SELECT id FROM notes
      WHERE id = ${noteId}::uuid
        AND public.runly_note_user_access(id, ${userId}::uuid, false)
        AND deleted_at IS NULL
        AND (
          owner_user_id = ${userId}::uuid
          OR id IN (
            SELECT note_id FROM note_shares
            WHERE shared_with_user_id = ${userId}::uuid
              AND permission = 'edit'
          )
        )
    `;
    if (!note) throw new CanvasServiceError("Sin permisos de edicion", 403);
  }

  async function getScene(noteId, userId) {
    await assertReadAccess(noteId, userId);
    const [row] = await prisma.$queryRaw`
      SELECT elements, app_state, layers, files, version
      FROM note_canvas_scene
      WHERE note_id = ${noteId}::uuid
    `;
    if (!row) {
      return { elements: [], appState: {}, layers: [defaultLayer()], files: {}, version: 0 };
    }
    return {
      elements: row.elements ?? [],
      appState: row.app_state ?? {},
      layers: Array.isArray(row.layers) && row.layers.length ? row.layers : [defaultLayer()],
      files: row.files ?? {},
      version: row.version,
    };
  }

  async function saveScene(noteId, userId, scene) {
    await assertEditAccess(noteId, userId);
    const elements = Array.isArray(scene?.elements) ? scene.elements : [];
    const layers = Array.isArray(scene?.layers) ? scene.layers : [];
    const files = scene?.files && typeof scene.files === "object" ? scene.files : {};
    const appState = whitelistAppState(scene?.appState);

    const payload = JSON.stringify({ elements, appState, layers, files });
    if (payload.length > MAX_SCENE_BYTES) {
      throw new CanvasServiceError("El lienzo excede el tamano maximo permitido", 413);
    }

    const [row] = await prisma.$queryRaw`
      INSERT INTO note_canvas_scene (note_id, elements, app_state, layers, files, version, updated_at, updated_by)
      VALUES (
        ${noteId}::uuid,
        ${JSON.stringify(elements)}::jsonb,
        ${JSON.stringify(appState)}::jsonb,
        ${JSON.stringify(layers)}::jsonb,
        ${JSON.stringify(files)}::jsonb,
        1,
        NOW(),
        ${userId}::uuid
      )
      ON CONFLICT (note_id) DO UPDATE SET
        elements = EXCLUDED.elements,
        app_state = EXCLUDED.app_state,
        layers = EXCLUDED.layers,
        files = EXCLUDED.files,
        version = note_canvas_scene.version + 1,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING version
    `;

    const contentText = extractSceneText(elements);
    await prisma.$executeRaw`
      UPDATE notes
      SET content_text = ${contentText}::text,
          updated_at = NOW()
      WHERE id = ${noteId}::uuid
        AND public.runly_note_user_access(id, ${userId}::uuid, false)
    `;

    return { ok: true, version: row.version };
  }

  async function getPublicScene(slug) {
    const [row] = await prisma.$queryRaw`
      SELECT
        n.id            AS note_id,
        n.title,
        n.icon,
        s.elements,
        s.app_state,
        s.layers,
        s.files,
        s.version
      FROM notes n
      LEFT JOIN note_canvas_scene s ON s.note_id = n.id
      WHERE n.public_slug = ${slug}
        AND n.is_public = true AND public.notes_realtime_is_public(n.id)
        AND n.deleted_at IS NULL
        AND n.is_trashed = false
        AND n.note_type = 'canvas'
    `;
    if (!row) throw new CanvasServiceError("Nota no encontrada", 404);
    return {
      noteId: row.note_id,
      title: row.title ?? "",
      icon: row.icon ?? "",
      elements: row.elements ?? [],
      appState: row.app_state ?? {},
      layers: Array.isArray(row.layers) && row.layers.length ? row.layers : [defaultLayer()],
      files: row.files ?? {},
      version: row.version ?? 0,
    };
  }

  return { getScene, saveScene, getPublicScene };
}
