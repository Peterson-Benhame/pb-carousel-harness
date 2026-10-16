-- Q04: compatibility fence only. Historical runs, snapshots and consent are unchanged.
CREATE TABLE workspace_contract_activation (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 contract_version INTEGER NOT NULL DEFAULT 2 CHECK(contract_version=2),
 pipeline_version INTEGER NOT NULL DEFAULT 2 CHECK(pipeline_version=2),
 minimum_protocol_version INTEGER NOT NULL DEFAULT 2 CHECK(minimum_protocol_version=2),
 quality_policy_version INTEGER NOT NULL DEFAULT 1 CHECK(quality_policy_version=1),
 activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TRIGGER immutable_workspace_contract_activation_insert BEFORE INSERT ON workspace_contract_activation
 WHEN EXISTS(SELECT 1 FROM workspace_contract_activation)
 BEGIN SELECT RAISE(ABORT,'immutable workspace contract activation'); END;
CREATE TRIGGER immutable_workspace_contract_activation_update BEFORE UPDATE ON workspace_contract_activation
 BEGIN SELECT RAISE(ABORT,'immutable workspace contract activation'); END;
CREATE TRIGGER immutable_workspace_contract_activation_delete BEFORE DELETE ON workspace_contract_activation
 BEGIN SELECT RAISE(ABORT,'immutable workspace contract activation'); END;
INSERT INTO workspace_contract_activation(singleton) VALUES(1);
