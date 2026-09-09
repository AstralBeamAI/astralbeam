# Quickstart

## Create your organization

TODO: sign up, accept an invitation or create an organization, and note that the URL slug can change later.

## Meet the default agent

TODO: cover the starter agent every new organization gets, where its public `agent_<organizationId>_<id>` ID is shown, and when to omit the ID entirely.

## Create an API key

TODO: cover creating an organization API key as an owner or developer, the one-time `key_<organizationId>_<id>_abo_<secret>` reveal, and keeping it server-side.

## Install the SDK

TODO: cover `npm install @astralbeam/sdk` and the `@astralbeam/sdk/react`, `/client`, and `/server` entry points.

## Add a token endpoint

TODO: cover the default `POST /api/astralbeam/token` route, `createAstralBeamToken({ apiKey, user, tenant })`, and deriving stable tenant and tenant-local user IDs from the host session.

## Mount the chat

TODO: cover `<AstralBeamChat />` and `mountAstralBeamChat(element, options)`, the container height requirement, and mounting above the router.

## Send the first message

TODO: cover configuring the OpenAI key, what a missing key returns, and how to confirm the request reached `/api/v1/chat`.

## Where to go next

TODO: link the SDK authentication, configuration, tools and widgets, and security pages.
