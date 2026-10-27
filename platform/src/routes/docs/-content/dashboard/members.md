# Members

Members are your colleagues with dashboard access. Your customers' users are TenantUsers and do not appear here. Every member can view this page.

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

A member can hold more than one role, and any single role that permits an action is enough. The dashboard assigns one role at a time. Only an owner can grant the Owner role.

## Inviting a member

1. As an owner, open **Members** and invite the person by their sign-in email.
2. Select a role and send the invitation. They do not need an account yet.
3. Check the pending invitation list until they join.

Invitations last 48 hours. Invite the same address again to resend the email and extend the existing invitation. Cancel a pending invitation to invalidate its link immediately.

## Accepting an invitation

Open the invitation while signed in with the invited, verified email address. Another account cannot accept it.

**NOTE**: a sign-in address cannot be changed from the dashboard, so invite people at the address they already use to sign in.

Accepting grants the invited roles. Declining updates the invitation's status without adding the person or sending a notification.

## Changing roles

An owner can change a member's role using the dropdown. If they have multiple roles, choose one before saving.

A role change applies on the next request. An open tab's sidebar updates on navigation or reload, but the server enforces the new permissions immediately.

A role downgrade does not invalidate API keys the person created. Rotate those keys to revoke their signing authority. See [API keys](./api-keys.md).

## Removing a member and leaving

Removing a member ends dashboard access. Their agents, providers, and API keys remain. Rotate any credentials they could still hold.

Leaving has the same effect and returns you to your organization list. Rejoining requires a new invitation.

An organization keeps at least one owner. The dashboard will not let the last owner leave or be removed, so promote another member to owner before that person goes.
