# API route conventions

- `-lib/contract.server.ts` is the executable Effect HttpApi and OpenAPI source. Keep route names, operation IDs, wire fields, status codes, and error semantics stable; regenerate `webapp/openapi.json` after changes.
- Keep public schemas separate from Drizzle modules (`src/api/management.ts`); explicitly select public and mutable fields, use snake_case on the wire, camelCase in handlers, and preserve customer metadata keys. Apply write limits to inputs, not existing records in responses; document creation defaults and actual framework error behavior.
- Keep resource queries in `src/db/tenant.server.ts` and `src/db/tenant-user.server.ts`. Derive organization and Tenant scope from verified credentials and include it in every predicate; never trust scope from request data.
- Use plural nested routes for TenantUsers and internal UUIDv7 path IDs. Do not add lookup routes, deletes, sorting, counts, or unsupported filters without an API decision.
- Listing uses lazy keyset pages from `src/db/lib/pagination.server.ts`; preserve deterministic indexed ordering, directional cursors, filter binding, and live-listing semantics. Every emitted cursor must fit the accepted input limit, including maximum-length Unicode identities and filters.
- Keep authentication, cursor signing, error conversion, CORS, and cache headers in REST transport. Keep stored TenantUser admin separate from signed JWT authority.
- Keep RFC 9457 `AstralBeamApiError`, safe setup failures, and no-store/CORS behavior consistent across success and error responses.
- Add durable behavior tests through the actual Effect handler, prefer `HttpApiTest` when setup remains small, and avoid tests that only duplicate schema or generated-output details.
- Consumer docs belong under `src/routes/docs/-content/api`; keep them SDK-agnostic and put endpoint details in the executable contract.
