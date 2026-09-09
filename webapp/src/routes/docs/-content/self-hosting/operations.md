# Operations

## Applying migrations

TODO: cover reviewing pending migrations, approving them by name and digest, the advisory lock that serializes a run, and what a failed run leaves behind.

## Database commands

TODO: cover the migrate and check commands and when an operator would reach for them instead of the browser.

## Backups and restore

TODO: cover dumping the database, keeping the encryption key with the dump, and restoring into a matching version.

## Health checks

TODO: cover the liveness endpoint and the response the API returns while setup is incomplete.

## Logs

TODO: cover where logs go, what is deliberately never logged, and the pool errors worth alerting on.

## Connection pooling

TODO: cover transaction pooling, the prepared-statement setting it needs, and the two application pools and their idle and lifetime behavior.

## Rate limits

TODO: cover the shared rate-limit table, the buckets that use it, and what happens if the table is missing.

## Seeding a demo environment

TODO: cover the seed command, that it only targets a loopback database, and what it creates.
