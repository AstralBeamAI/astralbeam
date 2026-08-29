# Email provider contracts

- Define every provider's configuration boundary as a described Effect Schema in `../schema.ts`, and infer its TypeScript settings type with `Schema.Schema.Type` instead of maintaining a separate interface.
- Register each provider in `EMAIL_PROVIDER_SETTING_KEYS` and `EmailProviderConnectionInputSchema` so the UI, schema, and server function share one payload contract.
- Every provider module exports the same `testConnection` name, typed as `TestConnection<ProviderSettings>`; the module is the namespace and the uniform export is the provider contract.
- Implement `testConnection` with `runConnectionTest`; it verifies settings without sending email and returns the schema-derived `{ ok: true } | { ok: false, error: string }` result.
- Keep adapters concise and share common key lists and connection-test plumbing; add provider-specific edge-case handling only for observed failures.
