# API keys

Create an organization API key to connect your backend to AstralBeam. Use it to sign short-lived [chat tokens](/docs/sdk/authentication) or call the [management API](/docs/api).

## Create a key

1. Open **API keys** as an owner or developer and create a key. You may need to sign in again to confirm recent authentication.
2. Enter a name and choose an expiration.
3. Copy the full `key_…_abo_…` value into your server's secret configuration. It is shown only once.
4. Use it in your token endpoint and test chat, or run a management API request.

**NOTE**: Anyone holding the key can mint a token as any tenant user in the organization. Keep it out of browser code, repositories, and widget props.

## What a key looks like

The full value is `key_<organizationId>_<id>_abo_<secret>`. Keys do not expire unless you choose an expiration when creating them.

Only the secret's hash is stored. A lost key cannot be recovered. Create a replacement and delete the old one.

## Keeping a key server-side

Store the key in your backend's environment or secret manager, such as `ASTRALBEAM_API_KEY`. Use `createAstralBeamToken` from `@astralbeam/sdk/server` to sign chat tokens locally. The browser receives the token, never the API key. See [Authentication](/docs/sdk/authentication) for the token endpoint.

Keys belong to the organization rather than to the person who created them, so removing that person from the organization does not revoke their keys. Rotate a key when someone with access to it leaves.

Use a separate key per environment so you can rotate or retire one independently.

## Rotating, expiring, and deleting

1. Create a replacement key.
2. Deploy it to your backend and verify token issuance or management requests.
3. Delete the old key.

Both keys work during the transition.

Deleting or expiring a key invalidates its signed tokens immediately, including before their expiry. Applications using it fail on their next turn until the new key is deployed.

The last key in an organization and the key configured for the deployment's dashboard assistant cannot be deleted. Create a replacement before retiring a last key.

## Request limits

Management requests are limited to 100 per 5 minutes per key. A `429` response includes `Retry-After` in seconds. Wait before retrying.

Chat has [separate identity-based limits](/docs/sdk/limits) and does not consume the key's management allowance.

## Who can see keys

Owners and developers can manage keys, which grants signing authority throughout the organization. Viewers cannot access this page. See [Members](./members.md).
