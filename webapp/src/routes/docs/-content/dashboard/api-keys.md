# API keys

An organization API key is a server-side credential scoped to one organization, and it has two uses.

- It authenticates calls to the [management API](/docs/api), which reads and writes that organization's Tenants and tenant users.
- It signs the short-lived chat auth tokens the embedded widget uses, through `createAstralBeamToken`. See [Authentication](/docs/sdk/authentication).

Signing happens offline: your server mints a token from the key, and the endpoint verifies that token here without the key ever being sent. Holding the key is therefore the same as being able to sign, as anyone with it can mint a token naming any tenant and any tenant user of that organization.

**NOTE**: an API key can impersonate any of your users, so treat it as a credential rather than an identifier.

## What a key looks like

| Part                  | Value                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| Full value            | `key_<organizationId>_<id>_abo_<secret>`                                   |
| Name                  | Required, up to 32 characters, for your own bookkeeping                    |
| Expiration            | 30 days, 90 days, or never, and never is the default                       |
| Requests              | 100 management API requests per 5 minutes, per key                         |
| Tokens signed with it | 60 to 600 seconds of life, 300 by default. See [Limits](/docs/sdk/limits). |

The full value is shown once, at creation, and only a hash of it is stored afterwards, so nobody can recover it later, not even an owner. If you lose it, create a replacement and delete the old key.

Creating a key needs a recently authenticated session, so you may be asked to sign in again even though you are already signed in.

## Keeping a key server-side

Keep the key in server configuration, such as an environment variable your token endpoint reads. It must never appear in browser code, in a client bundle, in a repository, or as an SDK option, and the SDK never accepts an API key.

Keys belong to the organization rather than to the person who created them, so removing that person from the organization does not revoke their keys. Rotate a key when someone with access to it leaves.

**TIP**: use one key per deployment or environment, as a retired environment can then be cut off on its own and one environment's request limit cannot throttle another.

## Rotating, expiring, and deleting

Let's walk through a rotation. Create a new key, deploy it, then delete the old one. Nothing is shared between the two, so both work while you cut over.

Deleting a key, or letting it expire, invalidates every chat auth token already minted from it. The key's status is re-checked after a token's signature verifies, so a deleted key does not keep working for the rest of a token's lifetime. Live conversations fail on their next turn, and applications using that key need the new one deployed.

Renaming a key changes nothing about what it authorizes, as the name is only a label.

## Request limits

Each key allows 100 management API requests per 5 minutes. Over that, calls are refused with `429` and a `Retry-After` header giving the seconds to wait, so a client should back off rather than retry immediately.

Chat traffic does not consume that allowance, as verifying a chat auth token never touches the key's request counters. Chat is limited separately, counted per organization, tenant, and tenant user rather than per key, in [Limits](/docs/sdk/limits).

## Who can see keys

Owners and developers can list, create, rename, and delete keys, and viewers cannot open this page or see that any keys exist. See [Members](./members.md).

A listed key can be renamed and deleted but never read again, so creation is the only privileged moment. Anyone who can create a key holds a signing credential for the whole organization from that moment on.
