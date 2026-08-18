BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS migration_metadata (
  version integer PRIMARY KEY CHECK (version >= 1),
  name text NOT NULL CHECK (btrim(name) <> ''),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$ BEGIN
  CREATE TYPE source_category AS ENUM ('ddoa-grantee', 'non-grantee', 'library', 'government');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE publication_status AS ENUM ('pending', 'published', 'rejected', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE collection_state AS ENUM ('enabled', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE url_field_state AS ENUM ('values', 'known-absence', 'unspecified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE job_state AS ENUM ('queued', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS source_records (
  id uuid PRIMARY KEY,
  catalog_file_name text NOT NULL CHECK (catalog_file_name IN (
    'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
    'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
    'Library Events.csv',
    'Government Events.csv'
  )),
  catalog_physical_row integer NOT NULL CHECK (catalog_physical_row >= 2),
  source_category source_category NOT NULL,
  organization_name varchar(300) NOT NULL CHECK (btrim(organization_name) <> ''),
  collection_state collection_state NOT NULL DEFAULT 'enabled',
  adapter_key text,
  import_fingerprint char(64) NOT NULL CHECK (import_fingerprint ~ '^[0-9a-f]{64}$'),
  last_success_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (catalog_file_name, catalog_physical_row)
);

CREATE TABLE IF NOT EXISTS source_url_fields (
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  field_kind text NOT NULL CHECK (field_kind IN ('organization', 'sitemap', 'event')),
  field_state url_field_state NOT NULL,
  PRIMARY KEY (source_record_id, field_kind),
  CHECK (field_kind <> 'organization' OR field_state = 'values')
);

CREATE TABLE IF NOT EXISTS source_urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL,
  field_kind text NOT NULL CHECK (field_kind IN ('organization', 'sitemap', 'event')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  url text NOT NULL CHECK (url ~ '^https?://'),
  scheme text NOT NULL CHECK (scheme IN ('http', 'https')),
  host text NOT NULL CHECK (btrim(host) <> ''),
  last_etag text,
  last_modified text,
  FOREIGN KEY (source_record_id, field_kind)
    REFERENCES source_url_fields(source_record_id, field_kind) ON DELETE RESTRICT,
  UNIQUE (source_record_id, field_kind, ordinal)
);

CREATE TABLE IF NOT EXISTS event_records (
  id uuid PRIMARY KEY,
  identity_version smallint NOT NULL DEFAULT 1 CHECK (identity_version >= 1),
  canonical_identity char(64) NOT NULL CHECK (canonical_identity ~ '^[0-9a-f]{64}$'),
  organization_profile_id uuid,
  title varchar(300) NOT NULL CHECK (btrim(title) <> ''),
  description text,
  category_values text[] NOT NULL DEFAULT '{}',
  organization_name text,
  venue_name text,
  city text,
  region text,
  cost_text text,
  audience_text text,
  accessibility_text text,
  address_json jsonb,
  latitude numeric,
  longitude numeric,
  online_location_url text CHECK (online_location_url IS NULL OR online_location_url ~ '^https?://'),
  public_source_url text CHECK (public_source_url IS NULL OR public_source_url ~ '^https?://'),
  ticket_url text CHECK (ticket_url IS NULL OR ticket_url ~ '^https?://'),
  registration_url text CHECK (registration_url IS NULL OR registration_url ~ '^https?://'),
  source_category source_category NOT NULL,
  publication_status publication_status NOT NULL DEFAULT 'pending',
  validation_state text NOT NULL DEFAULT 'valid' CHECK (validation_state IN ('valid', 'needs-review')),
  public_attribution text,
  rights_notice text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (identity_version, canonical_identity),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS event_occurrences (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES event_records(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  time_kind text NOT NULL CHECK (time_kind IN ('date', 'instant')),
  start_date date,
  end_date date,
  start_at timestamptz,
  end_at timestamptz,
  source_timezone text,
  source_local_start_time time,
  original_start text NOT NULL,
  original_end text,
  CHECK (
    (time_kind = 'date' AND start_date IS NOT NULL AND start_at IS NULL AND source_timezone IS NULL) OR
    (time_kind = 'instant' AND start_at IS NOT NULL AND start_date IS NULL AND source_timezone IS NOT NULL)
  ),
  UNIQUE (event_id, ordinal)
);

CREATE TABLE IF NOT EXISTS event_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_records(id) ON DELETE RESTRICT,
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  source_supplied_id text,
  retrieved_at timestamptz NOT NULL,
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  adapter_key text NOT NULL,
  adapter_version text NOT NULL,
  extraction_format text NOT NULL,
  UNIQUE (event_id, source_record_id, source_url, retrieved_at, payload_digest)
);

CREATE TABLE IF NOT EXISTS event_ingestion_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_records(id) ON DELETE RESTRICT,
  provenance_id uuid NOT NULL REFERENCES event_provenance(id) ON DELETE RESTRICT,
  run_id uuid,
  retrieved_at timestamptz NOT NULL,
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('created', 'updated', 'duplicate')),
  UNIQUE (event_id, provenance_id, retrieved_at, payload_digest)
);

CREATE TABLE IF NOT EXISTS event_validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_records(id) ON DELETE RESTRICT,
  issue_code text NOT NULL,
  field_name text NOT NULL,
  safe_message text NOT NULL,
  original_start text,
  original_end text,
  resolution_state text NOT NULL DEFAULT 'open' CHECK (resolution_state IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS editor_accounts (
  id uuid PRIMARY KEY,
  account_identifier varchar(128) NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('editor', 'contributor')),
  active boolean NOT NULL DEFAULT true,
  credential_reference varchar(128) NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS credential_secrets (
  credential_reference varchar(128) PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES editor_accounts(id) ON DELETE RESTRICT,
  encrypted_hash bytea NOT NULL,
  key_version integer NOT NULL CHECK (key_version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rotated_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_digest char(64) PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES editor_accounts(id) ON DELETE RESTRICT,
  role_snapshot text NOT NULL CHECK (role_snapshot IN ('editor', 'contributor')),
  csrf_secret_digest char(64) NOT NULL CHECK (csrf_secret_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version >= 1)
);

CREATE TABLE IF NOT EXISTS audit_records (
  id uuid PRIMARY KEY,
  editor_identity text NOT NULL CHECK (btrim(editor_identity) <> ''),
  action_type text NOT NULL CHECK (btrim(action_type) <> ''),
  target_type text NOT NULL CHECK (btrim(target_type) <> ''),
  target_identifier text NOT NULL CHECK (btrim(target_identifier) <> ''),
  action_timestamp timestamptz NOT NULL,
  correlation_id text,
  idempotency_key text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS source_state_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  preceding_state collection_state NOT NULL,
  selected_state collection_state NOT NULL,
  editor_identity text NOT NULL,
  action_timestamp timestamptz NOT NULL,
  audit_id uuid NOT NULL REFERENCES audit_records(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS event_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_records(id) ON DELETE RESTRICT,
  field_name text NOT NULL,
  source_supplied_value jsonb,
  preceding_value jsonb,
  selected_value jsonb,
  editor_identity text NOT NULL,
  action_timestamp timestamptz NOT NULL,
  reason text,
  audit_id uuid NOT NULL REFERENCES audit_records(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS runtime_settings (
  setting_key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public_data_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO public_data_revision (singleton, revision) VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (btrim(job_type) <> ''),
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version >= 1),
  payload jsonb NOT NULL,
  state job_state NOT NULL DEFAULT 'queued',
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  idempotency_key text NOT NULL UNIQUE,
  result jsonb,
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (state <> 'running')
  )
);

CREATE TABLE IF NOT EXISTS submission_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  history_kind text NOT NULL,
  payload jsonb NOT NULL,
  actor_identifier text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS source_category_idx ON source_records (source_category, catalog_physical_row);
CREATE INDEX IF NOT EXISTS source_state_idx ON source_records (collection_state, source_category);
CREATE INDEX IF NOT EXISTS event_public_order_idx ON event_records (publication_status, id);
CREATE INDEX IF NOT EXISTS event_title_trgm_idx ON event_records USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS event_region_idx ON event_records (publication_status, region);
CREATE INDEX IF NOT EXISTS event_occurrence_date_idx ON event_occurrences (start_date, event_id);
CREATE INDEX IF NOT EXISTS event_occurrence_instant_idx ON event_occurrences (start_at, event_id);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (state, available_at, created_at);
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS audit_target_idx ON audit_records (target_type, target_identifier, action_timestamp);

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS event_provenance_append_only ON event_provenance;
CREATE TRIGGER event_provenance_append_only
BEFORE UPDATE OR DELETE ON event_provenance
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS event_history_append_only ON event_ingestion_history;
CREATE TRIGGER event_history_append_only
BEFORE UPDATE OR DELETE ON event_ingestion_history
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_records_append_only ON audit_records;
CREATE TRIGGER audit_records_append_only
BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS source_revisions_append_only ON source_state_revisions;
CREATE TRIGGER source_revisions_append_only
BEFORE UPDATE OR DELETE ON source_state_revisions
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS event_revisions_append_only ON event_revisions;
CREATE TRIGGER event_revisions_append_only
BEFORE UPDATE OR DELETE ON event_revisions
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS submission_history_append_only ON submission_history;
CREATE TRIGGER submission_history_append_only
BEFORE UPDATE OR DELETE ON submission_history
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DO $$
BEGIN
  IF current_setting('is_superuser', true) = 'on' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delaware_scene_app') THEN
      CREATE ROLE delaware_scene_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delaware_scene_auth') THEN
      CREATE ROLE delaware_scene_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
  END IF;
END;
$$;

DO $$
DECLARE
  schema_name text := current_schema();
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delaware_scene_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO delaware_scene_app', schema_name);
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      source_records, source_url_fields, source_urls, event_records, event_occurrences,
      event_validation_issues, runtime_settings, public_data_revision, jobs
      TO delaware_scene_app;
    GRANT SELECT, INSERT ON
      event_provenance, event_ingestion_history, audit_records, source_state_revisions,
      event_revisions, submission_history
      TO delaware_scene_app;
    GRANT SELECT ON migration_metadata, editor_accounts TO delaware_scene_app;
    REVOKE ALL ON credential_secrets, auth_sessions FROM delaware_scene_app;
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO delaware_scene_app', schema_name);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delaware_scene_auth') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO delaware_scene_auth', schema_name);
    GRANT SELECT, INSERT, UPDATE ON editor_accounts, credential_secrets, auth_sessions
      TO delaware_scene_auth;
    GRANT SELECT, INSERT ON audit_records TO delaware_scene_auth;
  END IF;
END;
$$;

INSERT INTO migration_metadata (version, name)
VALUES (1, 'initial-source-event-job-audit-schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
