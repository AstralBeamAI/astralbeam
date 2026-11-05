# Members

Invite colleagues as members to give them dashboard access. Your customers' users are TenantUsers and are managed separately. Every member can view the member list.

## Roles

Choose the role that matches the person's responsibilities:

| Capability                                                     | Owner | Developer | Viewer |
| -------------------------------------------------------------- | ----- | --------- | ------ |
| See the organization home and the member list                  | Yes   | Yes       | Yes    |
| Read Tenants, TenantUsers, and saved conversations             | Yes   | Yes       | Yes    |
| Read and change agents, model providers, and sandbox providers | Yes   | Yes       | No     |
| Read and change usage limits                                   | Yes   | Yes       | No     |
| Add and remove MCP server definitions                          | Yes   | Yes       | No     |
| List, create, rename, and delete API keys                      | Yes   | Yes       | No     |
| Invite members, change their roles, and remove them            | Yes   | No        | No     |
| Change the organization's name and slug                        | Yes   | No        | No     |

Reading a conversation through a directory does not grant permission to participate in it.

Choose Viewer for colleagues who need to read customer records, Developer for those setting up integrations, and Owner for those managing the team. Only an owner can assign the Owner role. If a member has multiple roles, their permissions combine.

## Inviting a member

1. As an owner, open **Members** and invite the person by their sign-in email.
2. Select a role and send the invitation. They do not need an account yet.
3. Check the pending invitation list until they join.

Invitations last 48 hours. Invite the same address again to resend the email and extend the existing invitation. Cancel a pending invitation to invalidate its link immediately.

## Accepting an invitation

1. Open the invitation link and sign in, or create an account with the invited email address.
2. Verify that email if prompted, then return to the invitation.
3. Choose **Join organization**.

If you are signed in with another account, choose **Sign in with another account** to switch without losing the invitation link. Only the invited, verified email address can accept it.

Invite people at the address they use to sign in. Sign-in addresses cannot be changed from the dashboard.

## Changing roles

An owner can change a member's role in the member list. The change applies on their next request. Reload an open dashboard tab to update its navigation.

A role downgrade does not invalidate API keys the person created. Rotate those keys to revoke their signing authority. See [API keys](./api-keys.md).

## Removing a member and leaving

Removing a member ends dashboard access. Their agents, providers, and API keys remain. Rotate any credentials they could still hold.

Leaving has the same effect and returns you to your organization list. Rejoining requires a new invitation.

An organization keeps at least one owner. The dashboard will not let the last owner leave or be removed, so promote another member to owner before that person goes.
