-- Tracks which CalendarEvent rows came from a .ics import, keyed by the
-- source file's per-occurrence UID, so re-importing the same (or an updated)
-- export into the same calendar skips events already brought in.
CREATE TABLE calendar_event_import_source (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  calendar_id  UUID NOT NULL REFERENCES calendar_calendar(id) ON DELETE CASCADE,
  external_uid TEXT NOT NULL,
  event_id     UUID NOT NULL UNIQUE REFERENCES calendar_event(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX calendar_event_import_source_calendar_uid_key
  ON calendar_event_import_source(calendar_id, external_uid);
