# Todos tutorial

## What you will build

TODO: describe the todos example: a sidebar agent that reads and edits the host application's todo list, projects a card into the transcript, accepts attachments, and can use a sandbox.

## Prerequisites

TODO: cover the local webapp on port 4500, an OpenAI key, and building the SDK before running the example.

## Seed the local data

TODO: cover `deno task --cwd webapp db-seed`, the organization, agent, sandbox provider, and API key it creates, and the `examples/todos/.env` file it writes.

## Configure the environment

TODO: cover `ASTRALBEAM_API_KEY`, the optional `VITE_ASTRALBEAM_AGENT_ID` and `VITE_ASTRALBEAM_API_URL`, and why the key and agent must belong to the same organization.

## Run the example

TODO: cover installing dependencies, starting the example on port 4700, and what the page shows.

## Register host tools

TODO: cover the `get_todos`, `create_todo`, `update_todo`, and `delete_todo` tools, their parameter schemas, and how each one mutates host state.

## Project a widget into the transcript

TODO: cover the `todoCard` widget, its `id` and `highlight` parameters, and how toggling a card in the chat updates the host list.

## Attach a file

TODO: cover pasting a screenshot and attaching the sample CSV, and what the agent can do with request-local attachment bytes.

## Add a sandbox provider

TODO: cover selecting a tested provider on the agent and reading commands, output, and downloads in the sandbox panel.

## Before you ship your own version

TODO: cover replacing the demo token route with one that authenticates the host session, and the checks the example ships with.
