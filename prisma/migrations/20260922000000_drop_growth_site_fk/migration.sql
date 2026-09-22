-- Growth's site_id columns were designed to be opaque references (no
-- @relation in schema.prisma, intentionally — see GrowthProperty), but six
-- tables still carried a hard FOREIGN KEY to website_site(id) left over
-- from before GrowthProperty existed, when website_site was the only site
-- concept. This blocked every write (analytics events, sessions, leads)
-- for any GrowthProperty that isn't mirrored from a WebsiteSite, i.e. every
-- externally-connected property.

-- DropForeignKey
ALTER TABLE "growth_visitor" DROP CONSTRAINT "growth_visitor_site_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_session" DROP CONSTRAINT "growth_session_site_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_event" DROP CONSTRAINT "growth_event_site_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_lead" DROP CONSTRAINT "growth_lead_site_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_lead_activity" DROP CONSTRAINT "growth_lead_activity_site_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_daily_metric" DROP CONSTRAINT "growth_daily_metric_site_id_fkey";
