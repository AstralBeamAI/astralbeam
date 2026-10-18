# Email providers

- Describe settings with Effect Schema in `../schemas.ts`, infer types, and register providers in `EMAIL_PROVIDER_SETTING_KEYS` and `EmailProviderConnectionInputSchema` for one UI/server contract.
- Export scoped `acquireSender(settings)` with one client and `testConnection(settings)` without sending email. Use `emailProviderCall`/`emailConnectionCheck`. Connection failures expose `EmailConnectionFailed` with the provider message only to the authorized operator.
- Share connection plumbing and add provider-specific edge handling only for observed failures.
