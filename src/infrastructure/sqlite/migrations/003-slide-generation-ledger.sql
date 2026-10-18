-- Persistent harness-side reservation ledger. It does not prove model use, cost or pixels.
CREATE TABLE slide_generation_attempts (
 id TEXT PRIMARY KEY NOT NULL,
 brand_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 slide_index INTEGER NOT NULL CHECK(slide_index>0),
 plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
 contract_fingerprint TEXT NOT NULL CHECK(length(contract_fingerprint)=64 AND contract_fingerprint NOT GLOB '*[^0-9a-f]*'),
 copy_fingerprint TEXT NOT NULL CHECK(length(copy_fingerprint)=64 AND copy_fingerprint NOT GLOB '*[^0-9a-f]*'),
 mode TEXT NOT NULL CHECK(mode IN ('automatic-initial','automatic-correction','manual-correction')),
 automatic_ordinal INTEGER CHECK(automatic_ordinal IN (1,2)),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','failed')),
 manual_intent_id TEXT,
 result_artifact_id TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT,
 CHECK(
  (mode='automatic-initial' AND automatic_ordinal=1 AND manual_intent_id IS NULL) OR
  (mode='automatic-correction' AND automatic_ordinal=2 AND manual_intent_id IS NULL) OR
  (mode='manual-correction' AND automatic_ordinal IS NULL AND manual_intent_id IS NOT NULL)
 ),
 CHECK(
  (status='reserved' AND result_artifact_id IS NULL AND error_code IS NULL AND finished_at IS NULL) OR
  (status='succeeded' AND result_artifact_id IS NOT NULL AND error_code IS NULL AND finished_at IS NOT NULL) OR
  (status='failed' AND result_artifact_id IS NULL AND error_code IS NOT NULL AND finished_at IS NOT NULL)
 ),
 UNIQUE(brand_id,run_id,id),
 FOREIGN KEY(brand_id,run_id) REFERENCES runs(brand_id,id),
 FOREIGN KEY(brand_id,run_id,manual_intent_id) REFERENCES confirmation_requests(brand_id,run_id,id),
 FOREIGN KEY(brand_id,run_id,result_artifact_id) REFERENCES artifacts(brand_id,run_id,id)
) STRICT;

CREATE UNIQUE INDEX unique_automatic_generation_ordinal
 ON slide_generation_attempts(brand_id,run_id,slide_index,plan_revision,contract_fingerprint,copy_fingerprint,automatic_ordinal)
 WHERE automatic_ordinal IS NOT NULL;
CREATE UNIQUE INDEX unique_manual_generation_intent
 ON slide_generation_attempts(manual_intent_id)
 WHERE manual_intent_id IS NOT NULL;
CREATE UNIQUE INDEX one_active_slide_generation
 ON slide_generation_attempts(brand_id,run_id,slide_index,plan_revision,contract_fingerprint,copy_fingerprint)
 WHERE status='reserved';

CREATE TRIGGER immutable_slide_generation_identity BEFORE UPDATE OF
 brand_id,run_id,slide_index,plan_revision,contract_fingerprint,copy_fingerprint,mode,automatic_ordinal,manual_intent_id,created_at
 ON slide_generation_attempts BEGIN SELECT RAISE(ABORT,'immutable slide generation identity'); END;
CREATE TRIGGER terminal_slide_generation_attempt BEFORE UPDATE ON slide_generation_attempts
 WHEN OLD.status!='reserved' OR NEW.status NOT IN ('succeeded','failed')
 BEGIN SELECT RAISE(ABORT,'terminal slide generation attempt'); END;
CREATE TRIGGER immutable_slide_generation_attempt_delete BEFORE DELETE ON slide_generation_attempts
 BEGIN SELECT RAISE(ABORT,'immutable slide generation attempt'); END;
