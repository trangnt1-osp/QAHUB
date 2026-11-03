CREATE TABLE project_modules (id bigserial PRIMARY KEY, project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code text NOT NULL, name text NOT NULL, description text, deleted_at timestamptz, UNIQUE(project_id,code));
ALTER TABLE requirements ADD COLUMN module_id bigint REFERENCES project_modules(id), ADD COLUMN epic_issue_id bigint UNIQUE REFERENCES issues(id);
CREATE TABLE issue_modules (issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE, module_id bigint NOT NULL REFERENCES project_modules(id), PRIMARY KEY(issue_id,module_id));
CREATE TABLE issue_functions (issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE, function_id bigint NOT NULL REFERENCES requirements(id), PRIMARY KEY(issue_id,function_id));
CREATE TABLE epic_modules (epic_id bigint NOT NULL REFERENCES requirements(id) ON DELETE CASCADE, module_id bigint NOT NULL REFERENCES project_modules(id), PRIMARY KEY(epic_id,module_id));
CREATE INDEX requirements_module_idx ON requirements(module_id);
CREATE INDEX issue_modules_module_idx ON issue_modules(module_id);
CREATE INDEX issue_functions_function_idx ON issue_functions(function_id);

-- Preserve each legacy source as its own identity. Never infer identity from a title.
DO $$ DECLARE r record; n bigint; iid bigint; sid bigint; business_code text; BEGIN
 FOR r IN SELECT * FROM requirements WHERE kind='epic' ORDER BY id LOOP
  SELECT initial_manual_status_id INTO sid FROM workflow_settings WHERE project_id=r.project_id;
  IF sid IS NULL THEN SELECT id INTO sid FROM workflow_statuses WHERE project_id=r.project_id ORDER BY position,id LIMIT 1; END IF;
  UPDATE projects SET issue_seq=GREATEST(issue_seq,(SELECT COALESCE(MAX(number),0) FROM issues WHERE project_id=r.project_id))+1 WHERE id=r.project_id RETURNING issue_seq INTO n;
  INSERT INTO issues(project_id,number,type,title,status_id,rank,deleted_at) VALUES(r.project_id,n,'epic',left(r.name,255),sid,r.rank,r.deleted_at) RETURNING id INTO iid;
  UPDATE requirements SET epic_issue_id=iid WHERE id=r.id;
  INSERT INTO issue_labels(issue_id,label_id) SELECT iid,id FROM labels WHERE project_id=r.project_id AND name='manual';
 END LOOP;
 FOR r IN SELECT i.* FROM issues i WHERE i.type='epic' AND NOT EXISTS(SELECT 1 FROM requirements q WHERE q.epic_issue_id=i.id) ORDER BY i.id LOOP
  business_code='WORK-EPIC-'||r.id;
  WHILE EXISTS(SELECT 1 FROM requirements WHERE project_id=r.project_id AND code=business_code) LOOP business_code=business_code||'-'; END LOOP;
  INSERT INTO requirements(project_id,kind,code,name,rank,deleted_at,epic_issue_id) VALUES(r.project_id,'epic',business_code,r.title,r.rank,r.deleted_at,r.id);
 END LOOP;
END $$;

CREATE FUNCTION sync_structure_epic() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; iid bigint; sid bigint; business_code text;
BEGIN
 IF TG_TABLE_NAME='requirements' THEN
  IF NEW.kind <> 'epic' THEN
   IF TG_OP='UPDATE' AND OLD.epic_issue_id IS NOT NULL THEN RAISE EXCEPTION 'A shared Epic cannot change kind'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.epic_issue_id IS NULL THEN
   SELECT initial_manual_status_id INTO sid FROM workflow_settings WHERE project_id=NEW.project_id;
   IF sid IS NULL THEN SELECT id INTO sid FROM workflow_statuses WHERE project_id=NEW.project_id ORDER BY position,id LIMIT 1; END IF;
   UPDATE projects SET issue_seq=GREATEST(issue_seq,(SELECT COALESCE(MAX(number),0) FROM issues WHERE project_id=NEW.project_id))+1 WHERE id=NEW.project_id RETURNING issue_seq INTO n;
   -- The nested Issue trigger is suppressed only while its Requirement is being created.
   PERFORM set_config('ospm.creating_epic','1',true);
   INSERT INTO issues(project_id,number,type,title,status_id,rank,deleted_at) VALUES(NEW.project_id,n,'epic',left(NEW.name,255),sid,NEW.rank,NEW.deleted_at) RETURNING id INTO iid;
   PERFORM set_config('ospm.creating_epic','0',true);
   NEW.epic_issue_id=iid;
   INSERT INTO issue_labels(issue_id,label_id) SELECT iid,id FROM labels WHERE project_id=NEW.project_id AND name='manual';
  ELSE
   IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
   IF NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.epic_issue_id AND project_id=NEW.project_id AND type='epic') THEN RAISE EXCEPTION 'Invalid Epic pair'; END IF;
   UPDATE issues SET title=left(NEW.name,255),deleted_at=NEW.deleted_at,version=version+1,updated_at=now() WHERE id=NEW.epic_issue_id AND (title IS DISTINCT FROM left(NEW.name,255) OR deleted_at IS DISTINCT FROM NEW.deleted_at);
  END IF;
  RETURN NEW;
 ELSE
  IF NEW.type <> 'epic' THEN
   IF EXISTS(SELECT 1 FROM requirements WHERE epic_issue_id=NEW.id) THEN RAISE EXCEPTION 'A shared Epic cannot change type'; END IF;
   RETURN NEW;
  END IF;
  IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  IF current_setting('ospm.creating_epic',true)='1' THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM requirements WHERE epic_issue_id=NEW.id) THEN
   business_code='WORK-EPIC-'||NEW.id;
   WHILE EXISTS(SELECT 1 FROM requirements WHERE project_id=NEW.project_id AND code=business_code) LOOP business_code=business_code||'-'; END LOOP;
   INSERT INTO requirements(project_id,kind,code,name,rank,deleted_at,epic_issue_id) VALUES(NEW.project_id,'epic',business_code,NEW.title,NEW.rank,NEW.deleted_at,NEW.id);
  ELSE
   IF TG_OP='UPDATE' AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
    UPDATE requirements SET deleted_at=NEW.deleted_at WHERE epic_issue_id=NEW.id AND deleted_at IS DISTINCT FROM NEW.deleted_at;
   ELSE
    UPDATE requirements SET name=NEW.title,deleted_at=NEW.deleted_at WHERE epic_issue_id=NEW.id AND (name IS DISTINCT FROM NEW.title OR deleted_at IS DISTINCT FROM NEW.deleted_at);
   END IF;
  END IF;
  RETURN NEW;
 END IF;
END $$;
CREATE TRIGGER requirement_epic_sync BEFORE INSERT OR UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION sync_structure_epic();
CREATE TRIGGER issue_epic_sync AFTER INSERT OR UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION sync_structure_epic();

CREATE VIEW epic_function_coverage AS
 SELECT l.epic_id, l.function_id FROM requirement_links l
 JOIN requirements e ON e.id=l.epic_id AND e.deleted_at IS NULL
 JOIN requirements f ON f.id=l.function_id AND f.deleted_at IS NULL
 UNION
 SELECT e.id, j.function_id FROM requirements e
 JOIN issues i ON (i.id=e.epic_issue_id OR i.parent_id=e.epic_issue_id OR i.parent_id IN (SELECT id FROM issues WHERE parent_id=e.epic_issue_id AND deleted_at IS NULL)) AND i.deleted_at IS NULL
 JOIN issue_functions j ON j.issue_id=i.id
 JOIN requirements f ON f.id=j.function_id AND f.deleted_at IS NULL
 WHERE e.kind='epic' AND e.deleted_at IS NULL;

-- Validate domain joins at the database boundary as well as in API transactions.
CREATE FUNCTION validate_structure_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid bigint; target_pid bigint; target_kind text; target_deleted timestamptz;
BEGIN
 IF TG_TABLE_NAME='requirements' THEN
  IF NEW.module_id IS NOT NULL THEN
   SELECT project_id,deleted_at INTO target_pid,target_deleted FROM project_modules WHERE id=NEW.module_id FOR SHARE;
   IF NEW.kind<>'function' OR target_pid IS DISTINCT FROM NEW.project_id OR target_deleted IS NOT NULL THEN RAISE EXCEPTION 'Invalid Function module'; END IF;
  END IF;
  IF NEW.epic_issue_id IS NOT NULL THEN
   IF NEW.kind<>'epic' OR NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.epic_issue_id AND type='epic' AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Invalid Epic pair'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='epic_modules' THEN
  SELECT project_id INTO pid FROM requirements WHERE id=NEW.epic_id AND kind='epic' AND deleted_at IS NULL FOR SHARE;
  SELECT project_id,deleted_at INTO target_pid,target_deleted FROM project_modules WHERE id=NEW.module_id FOR SHARE;
  IF pid IS NULL OR target_pid IS DISTINCT FROM pid OR target_deleted IS NOT NULL THEN RAISE EXCEPTION 'Invalid Epic module'; END IF;
 ELSE
  SELECT project_id INTO pid FROM issues WHERE id=NEW.issue_id AND deleted_at IS NULL FOR SHARE;
  IF TG_TABLE_NAME='issue_modules' THEN
   SELECT project_id,deleted_at INTO target_pid,target_deleted FROM project_modules WHERE id=NEW.module_id FOR SHARE;
  ELSE
   SELECT project_id,deleted_at,kind INTO target_pid,target_deleted,target_kind FROM requirements WHERE id=NEW.function_id FOR SHARE;
   IF target_kind IS DISTINCT FROM 'function' THEN RAISE EXCEPTION 'Invalid item Function'; END IF;
  END IF;
  IF pid IS NULL OR target_pid IS DISTINCT FROM pid OR target_deleted IS NOT NULL THEN RAISE EXCEPTION 'Invalid item structure reference'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER structure_requirement_validate BEFORE INSERT OR UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION validate_structure_reference();
CREATE TRIGGER structure_issue_module_validate BEFORE INSERT OR UPDATE ON issue_modules FOR EACH ROW EXECUTE FUNCTION validate_structure_reference();
CREATE TRIGGER structure_issue_function_validate BEFORE INSERT OR UPDATE ON issue_functions FOR EACH ROW EXECUTE FUNCTION validate_structure_reference();
CREATE TRIGGER structure_epic_module_validate BEFORE INSERT OR UPDATE ON epic_modules FOR EACH ROW EXECUTE FUNCTION validate_structure_reference();
