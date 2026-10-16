-- T05: storage constraints only. Transactions/authorization services are subsequent tasks.
CREATE TABLE brands (
 id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 current_revision INTEGER CHECK(current_revision > 0),
 FOREIGN KEY(id,current_revision) REFERENCES brand_revisions(brand_id,revision) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE brand_revisions (
 brand_id TEXT NOT NULL REFERENCES brands(id), revision INTEGER NOT NULL CHECK(revision > 0),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)), hash TEXT NOT NULL CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'),
 provenance TEXT NOT NULL CHECK(provenance IN ('user-confirmed','legacy-import')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(brand_id,revision)
) STRICT;
CREATE TRIGGER immutable_brand_revision BEFORE UPDATE ON brand_revisions BEGIN SELECT RAISE(ABORT,'immutable brand revision'); END;
CREATE TABLE assets (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id),
 hash TEXT NOT NULL CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'), relative_path TEXT NOT NULL,
 kind TEXT NOT NULL, width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)), UNIQUE(brand_id,id), UNIQUE(relative_path)
) STRICT;
CREATE TRIGGER immutable_asset BEFORE UPDATE ON assets BEGIN SELECT RAISE(ABORT,'immutable asset'); END;
CREATE TABLE runs (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id), brand_revision INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64 AND snapshot_hash NOT GLOB '*[^0-9a-f]*'),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','running','waiting-approval','blocked','interrupted','completed','cancelled')),
 current_step TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), lease_owner TEXT, lease_expires_at INTEGER,
 fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0), source_run_id TEXT,
 CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL)), UNIQUE(brand_id,id),
 FOREIGN KEY(brand_id,brand_revision) REFERENCES brand_revisions(brand_id,revision),
 FOREIGN KEY(brand_id,source_run_id) REFERENCES runs(brand_id,id)
) STRICT;
CREATE TRIGGER immutable_run_snapshot BEFORE UPDATE OF brand_id,brand_revision,snapshot_json,snapshot_hash ON runs BEGIN SELECT RAISE(ABORT,'immutable run snapshot'); END;
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), hash TEXT NOT NULL CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'),
 relative_path TEXT NOT NULL UNIQUE, metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
 UNIQUE(brand_id,run_id,id), UNIQUE(brand_id,run_id,kind,version),
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id)
) STRICT;
CREATE TRIGGER immutable_artifact BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;
CREATE TABLE steps (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, run_id TEXT NOT NULL, step_key TEXT NOT NULL,
 fingerprint TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','waiting-approval','running','succeeded','failed','invalidated')),
 UNIQUE(brand_id,run_id,id), UNIQUE(brand_id,run_id,step_key),
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id)
) STRICT;
CREATE TABLE step_attempts (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
 attempt_number INTEGER NOT NULL CHECK(attempt_number>0), executor TEXT NOT NULL,
 fencing_token INTEGER NOT NULL CHECK(fencing_token>0), started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
 status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed','interrupted','cancelled')),
 result_artifact_id TEXT, error_code TEXT,
 UNIQUE(brand_id,run_id,id), UNIQUE(brand_id,run_id,step_id,attempt_number),
 FOREIGN KEY(brand_id,run_id,step_id) REFERENCES steps(brand_id,run_id,id),
 FOREIGN KEY(brand_id,run_id,result_artifact_id) REFERENCES artifacts(brand_id,run_id,id)
) STRICT;
CREATE TABLE confirmation_requests (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id), run_id TEXT,
 kind TEXT NOT NULL, object_fingerprint TEXT NOT NULL, object_artifact_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','cancelled','expired')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, resolved_at TEXT,
 CHECK(object_artifact_id IS NULL OR run_id IS NOT NULL), UNIQUE(brand_id,run_id,id),
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id),
 FOREIGN KEY(brand_id,run_id,object_artifact_id) REFERENCES artifacts(brand_id,run_id,id)
) STRICT;
CREATE TABLE approvals (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, run_id TEXT NOT NULL,
 kind TEXT NOT NULL, object_fingerprint TEXT NOT NULL, object_artifact_id TEXT,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
 confirmation_request_id TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id),
 FOREIGN KEY(brand_id,run_id,object_artifact_id) REFERENCES artifacts(brand_id,run_id,id),
 FOREIGN KEY(brand_id,run_id,confirmation_request_id) REFERENCES confirmation_requests(brand_id,run_id,id)
) STRICT;
CREATE TABLE run_events (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, run_id TEXT NOT NULL, attempt_id TEXT,
 event_type TEXT NOT NULL, correlation_id TEXT NOT NULL, diagnostic_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id),
 FOREIGN KEY(brand_id,run_id,attempt_id) REFERENCES step_attempts(brand_id,run_id,id)
) STRICT;
CREATE TABLE operations (
 request_id TEXT PRIMARY KEY NOT NULL, brand_id TEXT REFERENCES brands(id), run_id TEXT, operation TEXT NOT NULL,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
 canonical_version INTEGER NOT NULL CHECK(canonical_version>0), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(run_id IS NULL OR brand_id IS NOT NULL), FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id)
) STRICT;
CREATE TABLE schema_migrations (
 version INTEGER PRIMARY KEY CHECK(version>0), name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE workspace_settings (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>0),
 resources_json TEXT NOT NULL CHECK(json_valid(resources_json)), authorized_font_directory TEXT
) STRICT;
CREATE TABLE maintenance_coordination (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT, purpose TEXT, expires_at INTEGER,
 fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
 CHECK((owner IS NULL AND purpose IS NULL AND expires_at IS NULL) OR (owner IS NOT NULL AND purpose IS NOT NULL AND expires_at IS NOT NULL))
) STRICT;
INSERT INTO maintenance_coordination(singleton) VALUES(1);
-- No FK to deleted domain data: residual cleanup survives purge and contains technical IDs/status only.
CREATE TABLE cleanup_jobs (
 id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, resource_kind TEXT NOT NULL CHECK(resource_kind IN ('brand','run','asset','artifact','attempt')),
 resource_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 UNIQUE(brand_id,resource_kind,resource_id)
) STRICT;
