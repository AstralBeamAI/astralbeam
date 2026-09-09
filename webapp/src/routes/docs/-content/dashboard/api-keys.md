# API keys

## What an organization key is for

TODO: cover the two uses, calling the management API and signing chat tokens, and that a key is scoped to its organization.

## Create a key

TODO: cover the required name, the expiration choices including Never, and where the key is created from.

## Copy the key once

TODO: cover the one-time reveal of the full `key_<organizationId>_<id>_abo_<secret>` value and what to do when it is lost.

## Keep the key server-side

TODO: cover storing it as a server secret, never shipping it to browser code, and that read access to it is equivalent to chat-token signing access.

## Rename or delete a key

TODO: cover renaming, deleting, and the effect on callers using the key.

## Rate limits

TODO: cover the per-key request limit and what a throttled caller receives.

## Roles and permissions

TODO: cover which roles can list, create, update, and delete keys, and that viewers see no keys at all.
