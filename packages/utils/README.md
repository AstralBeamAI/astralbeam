# `@astralbeam/utils`

Shared workspace utilities with explicit responsibility-based exports.

## Workspace environment

`@astralbeam/utils/environment` loads mode-specific environment files from the repository root for Vite-compatible configuration and standalone development tools. Existing process variables take precedence so CI and deployment-provided values are never overwritten.
