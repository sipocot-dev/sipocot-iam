-- Audit trail is append-only: block UPDATE / DELETE / TRUNCATE for everyone,
-- including the application role. Retention is handled by partition/archival
-- jobs run by a privileged maintenance role that disables the trigger explicitly.
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();
