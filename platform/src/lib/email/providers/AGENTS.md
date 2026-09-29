# Email provider contracts

- Define every provider's configuration boundary as a described Effect Schema in `../schemas.ts`, and infer its TypeScript settings type with `Schema.Schema.Type` instead of maintaining a separate interface.
- Register each provider in `EMAIL_PROVIDER_SETTING_KEYS` and `EmailProviderConnectionInputSchema` so the UI, schema, and server function share one payload contract.
- Every provider module exports `acquireSender(settings)`, a scoped Effect that builds one client, and `testConnection(settings)`, which verifies settings without sending email and fails with `EmailConnectionFailed` carrying the provider's message for the operator. Wrap calls with `emailProviderCall` and `emailConnectionCheck`.
- Keep adapters concise and share common key lists and connection-test plumbing. Add provider-specific edge-case handling only for observed failures.
