import type { ColumnType, Generated } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type GeneratedTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;

export interface MigrationMetadataTable {
  version: number;
  name: string;
  applied_at: GeneratedTimestamp;
}

export interface SourceRecordsTable {
  id: string;
  catalog_file_name: string;
  catalog_physical_row: number;
  source_category: 'ddoa-grantee' | 'non-grantee' | 'library' | 'government';
  organization_name: string;
  collection_state: 'enabled' | 'disabled';
  adapter_key: string | null;
  import_fingerprint: string;
  last_success_at: NullableTimestamp;
  version: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SourceUrlFieldsTable {
  source_record_id: string;
  field_kind: 'organization' | 'sitemap' | 'event';
  field_state: 'values' | 'known-absence' | 'unspecified';
}

export interface SourceUrlsTable {
  id: Generated<string>;
  source_record_id: string;
  field_kind: 'organization' | 'sitemap' | 'event';
  ordinal: number;
  url: string;
  scheme: 'http' | 'https';
  host: string;
  last_etag: string | null;
  last_modified: string | null;
}

export interface EventRecordsTable {
  id: string;
  identity_version: number;
  canonical_identity: string;
  organization_profile_id: string | null;
  title: string;
  description: string | null;
  category_values: string[];
  organization_name: string | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  cost_text: string | null;
  audience_text: string | null;
  accessibility_text: string | null;
  address_json: unknown | null;
  latitude: string | null;
  longitude: string | null;
  online_location_url: string | null;
  public_source_url: string | null;
  ticket_url: string | null;
  registration_url: string | null;
  source_category: 'ddoa-grantee' | 'non-grantee' | 'library' | 'government';
  publication_status: 'pending' | 'published' | 'rejected' | 'archived';
  validation_state: 'valid' | 'needs-review';
  public_attribution: string | null;
  rights_notice: string | null;
  version: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface EventOccurrencesTable {
  id: string;
  event_id: string;
  ordinal: number;
  time_kind: 'date' | 'instant';
  start_date: string | null;
  end_date: string | null;
  start_at: NullableTimestamp;
  end_at: NullableTimestamp;
  source_timezone: string | null;
  source_local_start_time: string | null;
  original_start: string;
  original_end: string | null;
}

export interface EventProvenanceTable {
  id: Generated<string>;
  event_id: string;
  source_record_id: string;
  source_url: string;
  source_supplied_id: string | null;
  retrieved_at: Timestamp;
  payload_digest: string;
  adapter_key: string;
  adapter_version: string;
  extraction_format: string;
}

export interface EventIngestionHistoryTable {
  id: Generated<string>;
  event_id: string;
  provenance_id: string;
  run_id: string | null;
  retrieved_at: Timestamp;
  payload_digest: string;
  action: 'created' | 'updated' | 'duplicate';
}

export interface EventValidationIssuesTable {
  id: Generated<string>;
  event_id: string;
  issue_code: string;
  field_name: string;
  safe_message: string;
  original_start: string | null;
  original_end: string | null;
  resolution_state: 'open' | 'resolved';
  created_at: GeneratedTimestamp;
}

export interface AuditRecordsTable {
  id: string;
  editor_identity: string;
  action_type: string;
  target_type: string;
  target_identifier: string;
  action_timestamp: Timestamp;
  correlation_id: string | null;
  idempotency_key: string | null;
  safe_metadata: unknown;
}

export interface SourceStateRevisionsTable {
  id: Generated<string>;
  source_record_id: string;
  preceding_state: 'enabled' | 'disabled';
  selected_state: 'enabled' | 'disabled';
  editor_identity: string;
  action_timestamp: Timestamp;
  audit_id: string;
}

export interface EventRevisionsTable {
  id: Generated<string>;
  event_id: string;
  field_name: string;
  source_supplied_value: unknown | null;
  preceding_value: unknown | null;
  selected_value: unknown | null;
  editor_identity: string;
  action_timestamp: Timestamp;
  reason: string | null;
  audit_id: string;
}

export interface RuntimeSettingsTable {
  setting_key: string;
  value_json: unknown;
  version: Generated<number>;
  updated_by: string | null;
  updated_at: GeneratedTimestamp;
}

export interface PublicDataRevisionTable {
  singleton: boolean;
  revision: Generated<string>;
}

export interface JobsTable {
  id: Generated<string>;
  job_type: string;
  payload_version: number;
  payload: unknown;
  state: 'queued' | 'running' | 'completed' | 'failed';
  available_at: Timestamp;
  lease_owner: string | null;
  lease_expires_at: NullableTimestamp;
  heartbeat_at: NullableTimestamp;
  attempts: Generated<number>;
  max_attempts: number;
  idempotency_key: string;
  result: unknown | null;
  failure_category: string | null;
  created_at: GeneratedTimestamp;
  completed_at: NullableTimestamp;
}

export interface DatabaseSchema {
  migration_metadata: MigrationMetadataTable;
  source_records: SourceRecordsTable;
  source_url_fields: SourceUrlFieldsTable;
  source_urls: SourceUrlsTable;
  event_records: EventRecordsTable;
  event_occurrences: EventOccurrencesTable;
  event_provenance: EventProvenanceTable;
  event_ingestion_history: EventIngestionHistoryTable;
  event_validation_issues: EventValidationIssuesTable;
  audit_records: AuditRecordsTable;
  source_state_revisions: SourceStateRevisionsTable;
  event_revisions: EventRevisionsTable;
  runtime_settings: RuntimeSettingsTable;
  public_data_revision: PublicDataRevisionTable;
  jobs: JobsTable;
}
