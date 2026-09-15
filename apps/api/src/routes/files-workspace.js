import { Hono } from "hono";
import { z } from "zod";
import { createFilesWorkspace } from "../services/files/workspace.js";
import { FileAccessError } from "../services/files/access.js";
import { FilesServiceError } from "../services/files-service.js";
import { tenantActiveContext } from "../lib/active-context.js";

export function createFilesWorkspaceRouter({
  prisma,
  supabaseAdmin,
  filesService,
  authMiddleware,
  requirePermission,
}) {
  const app = new Hono();
  const service = createFilesWorkspace({ prisma, supabaseAdmin, filesService });
  const id = z.uuid();
  const createSchema = z.strictObject({
    name: z.string().min(1).max(180),
    format: z.enum(["docx", "xlsx", "pptx"]),
    requestKey: z.string().regex(/^[a-zA-Z0-9_-]{20,100}$/),
  });
  const accessSchema = z.union([
    z.strictObject({ scope: z.enum(["COMPANY", "RESTRICTED"]) }),
    z.strictObject({
      userId: id,
      role: z.enum(["VIEWER", "EDITOR"]),
      revoke: z.boolean().optional(),
    }),
  ]);
  const protect = (handler) => async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return c.json({ error: "Solicitud inválida." }, 400);
      if (
        error instanceof FileAccessError ||
        error instanceof FilesServiceError
      )
        return c.json({ error: error.message }, error.status);
      // Anything else is unexpected — log it so a real bug (a DB constraint,
      // a missing bucket, ...) doesn't hide behind this generic message with
      // no trace of what actually happened.
      console.error("[runly.files] workspace route error", error);
      return c.json(
        { error: "No se pudo completar la operación de documentos." },
        500,
      );
    }
  };
  const auth = [authMiddleware, requirePermission("files.assets.read")];
  app.post(
    "/files/documents",
    ...auth,
    requirePermission("files.assets.create"),
    protect(async (c) =>
      c.json(
        {
          data: await service.create({
            authUserId: c.get("authUserId"),
            activeContext: tenantActiveContext(c),
            ...createSchema.parse(await c.req.json()),
          }),
        },
        201,
      ),
    ),
  );
  app.get(
    "/files/invitations",
    ...auth,
    protect(async (c) =>
      c.json(
        await service.invitations({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          page: c.req.query("page"),
        }),
      ),
    ),
  );
  app.post(
    "/files/invitations/:id/respond",
    ...auth,
    protect(async (c) =>
      c.json({
        data: await service.respond({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          invitationId: id.parse(c.req.param("id")),
          ...z.strictObject({ accept: z.boolean() }).parse(await c.req.json()),
        }),
      }),
    ),
  );
  app.get(
    "/files/:id/access",
    ...auth,
    protect(async (c) =>
      c.json({
        data: await service.sharing({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          fileId: id.parse(c.req.param("id")),
        }),
      }),
    ),
  );
  app.get(
    "/files/:id/members",
    ...auth,
    protect(async (c) =>
      c.json({
        data: await service.members({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          fileId: id.parse(c.req.param("id")),
          q: c.req.query("q"),
        }),
      }),
    ),
  );
  app.patch(
    "/files/:id/access",
    ...auth,
    protect(async (c) =>
      c.json({
        data: await service.changeSharing({
          authUserId: c.get("authUserId"),
          activeContext: tenantActiveContext(c),
          fileId: id.parse(c.req.param("id")),
          ...accessSchema.parse(await c.req.json()),
        }),
      }),
    ),
  );
  return app;
}
