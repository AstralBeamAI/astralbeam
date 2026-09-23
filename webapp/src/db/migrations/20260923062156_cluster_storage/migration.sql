-- Infrastructure schema mirrors Effect rc.117, not application table conventions.

-- https://github.com/Effect-TS/effect/blob/14a3f140095fdebbff9162944fe7d4ea83e054e6/packages/effect/src/unstable/sql/Migrator.ts#L139
CREATE TABLE cluster_migrations (
	migration_id integer PRIMARY KEY,
	created_at timestamptz NOT NULL DEFAULT now(),
	name text NOT NULL
);
--> statement-breakpoint
INSERT INTO cluster_migrations (migration_id, name) VALUES (1, 'create_tables'), (2, 'entity_type_size'), (3, 'pg_messages_rowid_index');
--> statement-breakpoint
-- https://github.com/Effect-TS/effect/blob/14a3f140095fdebbff9162944fe7d4ea83e054e6/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L908
CREATE TABLE cluster_messages (
	id bigint PRIMARY KEY,
	rowid bigserial,
	message_id varchar(255) UNIQUE,
	shard_id varchar(50) NOT NULL,
	entity_type varchar(150) NOT NULL,
	entity_id varchar(255) NOT NULL,
	kind integer NOT NULL,
	tag varchar(50),
	payload text,
	headers text,
	trace_id varchar(32),
	span_id varchar(16),
	sampled boolean,
	processed boolean NOT NULL DEFAULT false,
	request_id bigint NOT NULL,
	reply_id bigint,
	last_reply_id bigint,
	last_read timestamp,
	deliver_at bigint
);
--> statement-breakpoint
CREATE INDEX cluster_messages_shard_idx ON cluster_messages (shard_id, processed, last_read, deliver_at);
--> statement-breakpoint
CREATE INDEX cluster_messages_request_id_idx ON cluster_messages (request_id);
--> statement-breakpoint
CREATE INDEX cluster_messages_rowid_idx ON cluster_messages (rowid);
--> statement-breakpoint
-- https://github.com/Effect-TS/effect/blob/14a3f140095fdebbff9162944fe7d4ea83e054e6/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L1049
CREATE TABLE cluster_replies (
	id bigint PRIMARY KEY,
	rowid bigserial,
	kind integer,
	request_id bigint NOT NULL,
	payload text NOT NULL,
	sequence integer,
	acked boolean NOT NULL DEFAULT false,
	UNIQUE (request_id, kind),
	UNIQUE (request_id, sequence)
);
--> statement-breakpoint
CREATE INDEX cluster_replies_request_lookup_idx ON cluster_replies (request_id, kind, acked);
--> statement-breakpoint
-- https://github.com/Effect-TS/effect/blob/14a3f140095fdebbff9162944fe7d4ea83e054e6/packages/effect/src/unstable/cluster/SqlRunnerStorage.ts#L228
CREATE TABLE cluster_runners (
	machine_id serial PRIMARY KEY,
	address varchar(255) NOT NULL UNIQUE,
	runner text NOT NULL,
	healthy boolean NOT NULL DEFAULT true,
	last_heartbeat timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- https://github.com/Effect-TS/effect/blob/14a3f140095fdebbff9162944fe7d4ea83e054e6/packages/effect/src/unstable/cluster/SqlRunnerStorage.ts#L277
CREATE TABLE cluster_locks (
	shard_id varchar(50) PRIMARY KEY,
	address varchar(255) NOT NULL,
	acquired_at timestamp NOT NULL
);
