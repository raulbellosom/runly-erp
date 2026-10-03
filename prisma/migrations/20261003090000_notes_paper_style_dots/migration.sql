-- Adds the 'dots' (dot grid) option to notes.paper_style.
ALTER TABLE notes
  DROP CONSTRAINT chk_notes_paper_style;

ALTER TABLE notes
  ADD CONSTRAINT chk_notes_paper_style CHECK (paper_style IN ('none', 'lined', 'grid', 'dots'));
