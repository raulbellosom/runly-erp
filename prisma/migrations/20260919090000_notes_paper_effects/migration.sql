-- Independent, toggleable "realistic notebook" paper effects (margin line,
-- grain texture, sheet shadow), separate from the existing paper_style
-- (none/lined/grid) picker — a note can combine any of these.
ALTER TABLE notes
  ADD COLUMN paper_margin  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paper_texture BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paper_shadow  BOOLEAN NOT NULL DEFAULT false;
