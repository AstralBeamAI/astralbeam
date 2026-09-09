# API keys

An organization API key is a server-side credential scoped to one organization. It has two uses, and both belong on your own server.

- It authenticates calls to the [management API](/docs/api), which reads and writes that organization's Tenants and tenant users.
- It signs the short-lived chat auth tokens the embedded widget uses, through `createAstralBeamToken`. See [Authentication](/docs/sdk/authentication).

Signing is offline. The token is minted on your server from the key and is verified here without the key ever being sent, which is why holding the key is equivalent to being able to sign. Anyone with the key can mint a token naming any tenant and any tenant user of that organization, so treat it as a credential that can impersonate any of your users, not as an identifier.

## What a key looks like

| Part                  | Value                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| Full value            | `key_<organizationId>_<id>_abo_<secret>`                                   |
| Name                  | Required, up to 32 characters, for your own bookkeeping                    |
| Expiration            | 30 days, 90 days, or never, and never is the default                       |
| Requests              | 100 management API requests per 5 minutes, per key                         |
| Tokens signed with it | 60 to 600 seconds of life, 300 by default. See [Limits](/docs/sdk/limits). |

The full value is shown once, at creation, and only a hash of it is stored afterwards. Nobody, including an owner, can recover it later. If it is lost, create a replacement and delete the old key.

Creating a key needs a recently authenticated session, so you may be asked to sign in again first even though you are already signed in.

## Keeping a key server-side

Keep the key in server configuration, such as an environment variable read by your token endpoint. It must never appear in browser code, in a client bundle, in a repository, or as an SDK option. The SDK never accepts an API key.

Keys belong to the organization rather than to the person who created them. Removing that person from the organization does not revoke their keys, so rotate a key when someone with access to it leaves.

Use one key per deployment or environment that talks to AstralBeam. That way a compromised or retired environment can be cut off on its own, and the request limit of one environment cannot throttle another.

## Rotating, expiring, and deleting

Rotating means creating a new key, deploying it, and then deleting the old one. Nothing is shared between them, so both work while you cut over.

Deleting a key, or letting it expire, invalidates every chat auth token already minted from it. The key's status is re-checked after a token's signature verifies, so a deleted key does not keep working for the rest of a token's lifetime. Live conversations fail on their next turn and applications using it need the new key deployed.

Renaming a key changes nothing about what it authorizes. It is a label.

## Request limits

Each key allows 100 management API requests per 5 minutes. Over that, calls are refused with `429` and a `Retry-After` header telling the caller how many seconds to wait, so a client should back off rather than retry immediately.

Chat traffic does not consume that allowance. Verifying a chat auth token never touches the key's request counters. Chat is limited separately, counted per organization, tenant, and tenant user rather than per key, in [Limits](/docs/sdk/limits).

## Who can see keys

Owners and developers can list, create, rename, and delete keys. Viewers cannot open this page and are not shown that any keys exist. See [Members](./members.md).

Because a listed key can be renamed and deleted but never re-read, the only privileged moment is creation. Anyone who can create a key holds a signing credential for the whole organization from that moment on.
