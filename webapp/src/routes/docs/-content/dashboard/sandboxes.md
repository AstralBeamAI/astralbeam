# Sandboxes

A sandbox provider is a named, credentialed connection to a service that runs code. An agent with a provider selected gains file and command tools and gets one isolated sandbox per conversation. An organization can keep several providers and point different agents at different ones.

The sandboxes run in your own account with the vendor, so provisioning and running them is billed to you by that vendor, not metered here.

## Providers and their options

| Provider | Options                                                                                         | Credential   |
| -------- | ----------------------------------------------------------------------------------------------- | ------------ |
| Daytona  | Target, `us` or `eu`, default `us`. Snapshot, default `daytona-medium`.                         | API key      |
| Docker   | Image, default `node:22`.                                                                       | None         |
| Sprites  | None.                                                                                           | API token    |
| Vercel   | Team ID, Project ID, and Runtime, one of `node24`, `node22`, or `python3.13`, default `node24`. | Access token |

Every configuration also carries a name, unique in the organization ignoring case. The name is how you tell two configurations of the same vendor apart when selecting one on an agent, so name them for their purpose rather than for the vendor.

Docker needs no credential because it uses a Docker daemon the deployment itself can reach rather than an account with a vendor.

## Connection tests

Creating a provider, or changing an existing one's vendor, options, or credential, runs a connection test and saves only if it passes. Renaming does not, so a rename is always safe.

The test is real work at the vendor. It creates a sandbox, runs one command inside it, and destroys it again, which takes time and can cost money.

A failed test leaves the stored configuration exactly as it was, so a wrong credential cannot take a working agent's sandbox away. Correct the values and save again.

If the test connects but its temporary sandbox cannot be removed afterwards, that is reported as its own outcome. Check the vendor's console for a leftover sandbox.

Each provider shows whether its last test passed or failed and when that test ran. Re-running the test on an unchanged provider is the quickest way to tell a revoked credential from a problem with the agent.

## Credentials

Credentials are stored encrypted and are revealed only to owners and developers, for editing. Viewers cannot reach these pages at all.

A rotated credential applies to sandboxes provisioned after the save. A conversation whose sandbox is already running is not disturbed until that sandbox is replaced.

Changing a provider's vendor discards the stored credential, because a credential means nothing to a different vendor. Enter the new vendor's credential and let the test verify it before the change is stored.

## What agents get from a provider

An agent references a provider by selection, and nothing is provisioned until that agent reaches for a sandbox tool. See [Agents](./agents.md).

When the configuration cannot be read at that moment, the agent loses its sandbox tools for that run and answers without them instead of failing. An agent that has stopped offering to run code is worth checking here first.

A sandbox is reclaimed once it has been idle for a while, and the conversation's next turn provisions a new, empty one. Nothing written inside survives that, so anything the tenant user needs to keep has to be published as an artifact. See [Sandbox](/docs/sdk/sandbox) and [Limits](/docs/sdk/limits).

## Deleting a provider

A provider cannot be deleted while any agent still selects it. Point those agents at a different provider, or at none, first.

Deleting removes the settings and the encrypted credential permanently. Conversations that were using it lose their sandbox tools on their next turn.

## Who can change providers

Owners and developers can read, save, test, and delete provider configurations. Viewers have no access to them. See [Members](./members.md).

Two people editing the same provider cannot overwrite each other. The second save is rejected as stale and the page reloads with the stored values.
