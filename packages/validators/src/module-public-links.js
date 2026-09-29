import { z } from 'zod';

// POST /modules/:key/public-links (spec: 2026-09-28-module-public-links-design.md).
export const modulePublicLinkCreateSchema = z.object({
  resource: z.string().trim().min(2).max(64),
  recordId: z.string().uuid().optional().nullable(),
  label: z.string().trim().max(120).optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable()
    .refine((d) => !d || d.getTime() > Date.now(), 'La vigencia debe ser una fecha futura'),
  maxUses: z.coerce.number().int().min(1).max(100000).optional().nullable(),
});
