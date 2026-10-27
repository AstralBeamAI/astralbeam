# API keys

Use an organization API key on your server to call the [management API](/docs/api) and sign short-lived [tokens](/docs/sdk/authentication).

## Create a key

1. Open **API keys** as an owner or developer and create a key. You may need to sign in again to confirm recent authentication.
2. Enter a name and choose an expiration.
3. Copy the full `key_…_abo_…` value into your server's secret configuration. It is shown only once.
4. Use it in your token endpoint and test chat, or run a management API request.

**NOTE**: Anyone holding the key can mint a token as any tenant user in the organization. Keep it out of browser code, repositories, and widget props.

## What a key looks like

| Part | Value |
| --- | --- |
| Full value | `key_<organizationId>_<id>_abo_<secret>` |
| Name | Required, up to 32 characters, for your own bookkeeping |
| Expiration | 30 days, 90 days, or never, and never is the default |
| Requests | 100 management API requests per 5 minutes, per key |
| Tokens signed with it | 60 to 600 seconds of life, 300 by default. See [Limits](/docs/sdk/limits). |

Only the secret's hash is stored. A lost key cannot be recovered. Create a replacement and delete the old one.

## Keeping a key server-side

Store the key in an environment variable or secret manager used by your backend. `createAstralBeamToken` signs tenant tokens and `createAstralBeamOrganizationToken` signs member-management tokens locally, without sending the raw key to AstralBeam.

Keys belong to the organization rather than to the person who created them, so removing that person from the organization does not revoke their keys. Rotate a key when someone with access to it leaves.

**TIP**: use one key per deployment or environment, as a retired environment can then be cut off on its own and one environment's request limit cannot throttle another.

## Rotating, expiring, and deleting

1. Create a replacement key.
2. Deploy it to your backend and verify token issuance or management requests.
3. Delete the old key.

Both keys work during the transition.

Deleting or expiring a key invalidates its signed tokens immediately, including before their expiry. Applications using it fail on their next turn until the new key is deployed.

The last key in an organization and the key configured for the deployment's dashboard assistant cannot be deleted. Create a replacement before retiring a last key.

## Request limits

Management requests are limited per key, as listed above. A `429` response includes `Retry-After` in seconds. Wait before retrying.

Chat has [separate identity-based limits](/docs/sdk/limits) and does not consume the key's management allowance.

## Who can see keys

Owners and developers can list, create, rename, and delete keys, and viewers cannot open this page or see that any keys exist. See [Members](./members.md).

Permission to create keys grants signing authority throughout the organization.
