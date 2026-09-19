-- Adds notes.paper_style — per-note "Estilo de hoja" background (none/lined/grid).
ALTER TABLE notes
  ADD COLUMN paper_style TEXT NOT NULL DEFAULT 'none';

ALTER TABLE notes
  ADD CONSTRAINT chk_notes_paper_style CHECK (paper_style IN ('none', 'lined', 'grid'));
