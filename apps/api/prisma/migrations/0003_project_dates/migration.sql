ALTER TABLE projects
  ADD COLUMN start_date DATE,
  ADD COLUMN end_date DATE,
  ADD CONSTRAINT projects_date_range_check CHECK (end_date >= start_date);
