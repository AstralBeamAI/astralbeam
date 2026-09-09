# Deploy

## Get a release binary

TODO: cover the published release asset, its platform, and verifying what you downloaded.

## Or build from source

TODO: cover the build and compile steps, the order they must run in, and the size and startup checks the build enforces.

## Provision the database

TODO: cover creating the database and role, the required PostgreSQL version, and connecting through a transaction pooler.

## Set the bootstrap environment

TODO: cover `DATABASE_URL`, `DATABASE_ENCRYPTION_KEY`, `PORT`, and generating an encryption secret.

## Start the server

TODO: cover running the binary or the server bundle, the process manager or unit file, and the shutdown signal it honors.

## Put it behind a reverse proxy

TODO: cover terminating TLS, overwriting the forwarded host and protocol headers, why the proxy must be the loopback peer, and blocking direct access to the origin.

## Complete setup

TODO: cover opening the configuration page, signing in as the operator, approving the pending migrations, and filling in the required settings.

## Verify the deployment

TODO: cover the status endpoint, the public docs, and the OpenAPI document as post-deploy checks.

## Upgrade

TODO: cover replacing the artifact, approving new migrations, and restarting every replica.
