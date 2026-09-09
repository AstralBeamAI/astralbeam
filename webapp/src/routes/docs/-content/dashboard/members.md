# Members

Members are the people in your own company who sign in to this dashboard. Your customers' users, the people who talk to the embedded agent, are tenant users and never appear here, so adding a member grants dashboard access rather than access to any product of yours.

Every member can open this page and see who else is in the organization, whatever their role.

## Roles

A role decides what a member may do, and there are three.

| Capability                                          | Owner | Developer | Viewer |
| --------------------------------------------------- | ----- | --------- | ------ |
| See the organization home and the member list       | Yes   | Yes       | Yes    |
| Read and change agents and sandbox providers        | Yes   | Yes       | No     |
| List, create, rename, and delete API keys           | Yes   | Yes       | No     |
| Invite members, change their roles, and remove them | Yes   | No        | No     |
| Change the organization's name and slug             | Yes   | No        | No     |

Developer is the working role for anyone configuring the product, and Owner adds control over people and the organization itself. Viewer is deliberately narrow: a viewer sees that the organization exists and who is in it, and nothing about its configuration or credentials.

A member can hold more than one role, and any single role that permits an action is enough. Only an owner can grant the Owner role.

Pages a role cannot use are hidden from the sidebar, and opening one by URL returns the person to the organization home. The restriction is applied when the page loads its data, so nothing withheld is merely hidden in the browser.

## Inviting a member

An owner invites someone by email address and picks the roles they will have on joining, and that address does not need an account yet.

An invitation is valid for 48 hours. Inviting the same address again resends the email and extends the existing invitation rather than creating a second one, which is also the fix when the first email never arrived or its delivery failed outright.

Cancel a pending invitation if you sent it in error, as cancelling stops the link from working before it expires.

## Accepting an invitation

The recipient has to be signed in with the same email address you invited, and that address has to be verified. An invitation cannot be forwarded to a colleague or accepted from a second account, because the addresses will not match.

**NOTE**: a sign-in address cannot be changed from the dashboard, so invite people at the address they already use to sign in.

Accepting adds the person with the roles the invitation carried. Declining leaves the organization untouched and sends no notification, but the invitation's status changes, so check the invitation list when someone you invited never appears.

## Changing roles

An owner can change any member's roles. A member who is not an owner cannot change or remove an owner, so a developer cannot promote themselves.

A change applies on the member's next request. Anyone with the page already open keeps the sidebar they loaded until they navigate or reload, and a page they no longer have access to fails at that point rather than continuing to work.

Demoting a developer to viewer immediately closes off agents, sandbox providers, and API keys. It does not invalidate any API key they created, because keys belong to the organization, so rotate the key when that person should lose the access it grants. See [API keys](./api-keys.md).

## Removing a member and leaving

Removing a member ends their dashboard access. Everything they configured stays exactly as it is, including agents, sandbox providers, and API keys, so removal alone revokes no credential they may still hold a copy of.

Leaving an organization yourself has the same effect and returns you to your list of organizations, and rejoining requires a fresh invitation.

An organization keeps at least one owner. The dashboard will not let the last owner leave or be removed, so promote another member to owner before that person goes.
