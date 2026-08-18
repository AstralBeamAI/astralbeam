# `@astralbeam/webapp/workspace-environment`

Shared workspace environment loading with an explicit responsibility-based export.

`@astralbeam/webapp/workspace-environment` loads mode-specific environment files from the repository root for Vite-compatible configuration and standalone development tools. Existing process variables take precedence so CI and deployment-provided values are never overwritten.
