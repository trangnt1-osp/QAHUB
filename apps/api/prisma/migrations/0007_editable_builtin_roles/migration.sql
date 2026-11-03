-- Builtin permission overrides share role_definitions; assignment identity remains role + role_id=NULL.
ALTER TABLE role_definitions DROP CONSTRAINT role_definitions_key_check;
ALTER TABLE role_definitions ADD CONSTRAINT role_definitions_key_check
  CHECK (key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$');
