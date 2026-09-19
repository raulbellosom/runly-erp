-- Public notes show collaborators by default; owners/editors can hide the footer.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE notes
  ADD COLUMN show_public_collaborators BOOLEAN NOT NULL DEFAULT true;
COMMIT;
