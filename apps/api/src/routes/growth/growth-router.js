import { Hono } from "hono";

import { createNotificationService } from "../../services/notification-service.js";
import { createGrowthAnalyticsRoutes } from "./growth-analytics-routes.js";
import { createGrowthAnalyticsService } from "./growth-analytics-service.js";
import { createGrowthCommentRoutes } from "./growth-comment-routes.js";
import { createCommentsService } from "../../services/comments-service.js";
import { createGrowthLeadRoutes } from "./growth-lead-routes.js";
import { createGrowthLeadService } from "./growth-lead-service.js";
import { createGrowthPropertyRoutes } from "./growth-property-routes.js";
import { createGrowthPropertyService } from "./growth-property-service.js";

export function createGrowthRouter({
  prisma,
  requirePermission,
  notificationService = createNotificationService({ prisma }),
  enrichFileAssets = null,
}) {
  const app = new Hono();
  const service = createGrowthLeadService({
    prisma,
    notificationService,
  });
  const propertyService = createGrowthPropertyService({ prisma });
  const analyticsService = createGrowthAnalyticsService({ prisma, growthPropertyService: propertyService });
  const commentsService = createCommentsService({ prisma });
  app.route("", createGrowthLeadRoutes({ service, requirePermission, enrichFileAssets }));
  app.route("", createGrowthCommentRoutes({ service: commentsService, requirePermission }));
  app.route(
    "",
    createGrowthAnalyticsRoutes({
      service: analyticsService,
      prisma,
      requirePermission,
    }),
  );
  app.route(
    "",
    createGrowthPropertyRoutes({ service: propertyService, requirePermission }),
  );
  return app;
}
