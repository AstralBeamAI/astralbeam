# Security

## Encryption at rest

TODO: cover which columns are encrypted, the envelope format, and the row-identity check that blocks moving ciphertext between rows.

## Rotating the encryption key

TODO: cover the comma-separated keyring, which entry encrypts writes, re-saving values, dropping the old entry, and the side effects of rotating.

## Unreadable values

TODO: cover how an unreadable stored value is reported and how to replace one without revealing it.

## Operator access

TODO: cover the key-derived operator sign-in, the short session, login throttling, and restricting who can reach the configuration page at all.

## HTTPS and response headers

TODO: cover the HTTPS requirement, transport security, framing restrictions, and the other security headers every response carries.

## Reverse proxy trust

TODO: cover the forwarded headers that are trusted only from a loopback peer and the client-address header the proxy must own.

## Bot protection

TODO: cover the mandatory CAPTCHA keys and which authentication endpoints they protect.

## Credentials and tokens

TODO: cover how organization API keys are stored, how chat tokens are signed and verified, and the token lifetime and audience.

## Reporting a vulnerability

TODO: cover the private reporting channel and the supported-version policy.
