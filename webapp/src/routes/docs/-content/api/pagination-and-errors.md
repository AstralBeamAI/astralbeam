# Pagination

All lists support cursor-based pagination in both directions. Use the returned cursors to fetch the next or previous page.

## Requests and responses

- `page_size`: positive integer, default 20; values above 100 are accepted and capped.
- `page_after`: a returned `page_after` value, to fetch the next page.
- `page_before`: a returned `page_before` value, to fetch the previous page.
- At most one direction is accepted. Unknown/duplicate parameters, invalid sizes, and invalid or wrong-scope cursors return `400`.

Responses contain `items`, `page_after`, and `page_before`. Pass either non-null continuation value unchanged as the same-named request parameter. A null value means no page is available in that direction. These values describe where to go next; they do not echo the request parameters.

For example, a request with `page_size=1` can return `200 OK` with this body. Records are fictional and cursors are abbreviated; use actual returned cursors in requests.

```json
{
  "items": [
    {
      "id": "019eed68-fd00-7c42-9a61-53b3a890d276",
      "external_id": "customer-42",
      "name": "Acme Logistics",
      "metadata": { "plan": "pro", "region": "eu-west-1" },
      "created_at": "2026-06-22T09:30:00.000Z",
      "updated_at": "2026-06-22T09:30:00.000Z"
    }
  ],
  "page_after": "eyJhbGciOiJIUzI1NiIsInR5cCI6InBhZ2luYXRpb24randzIn0.eyJ2IjoxLCJpZCI6IjAxOWVlZDY4LWZkMDAifQ.demo-signature",
  "page_before": null
}
```

The first page has `page_before: null`; the last has `page_after: null`. A single-page result has both values null. Empty pages have `items: []` and both values null. Stop when the continuation value for your direction is null, not based on page length. You can also follow `Link`'s `next`/`prev` relation when present. Page size may change between requests.

Tenants and TenantUsers within a Tenant are ordered by internal `id`, ascending. Backward traversal preserves display order.

## Live listings

Listings are not snapshots: concurrent inserts behind the cursor may be absent and deleted rows disappear. A continuation can therefore return an empty page if records are deleted between requests. Treat cursors as opaque values and reuse them only for the same collection and authorized scope. If a cursor is rejected, restart without it. Positions beyond the requested boundary yield empty pages.

TenantUser lists bind cursors to the requested Tenant as well as the caller's scope. Both collections also bind cursors to the active filters. Adding, removing, or changing a filter while reusing a cursor returns `400`; start without a cursor when changing filters. Pagination links preserve the filters.

## Filters

Both list endpoints accept optional `filter[external_id]`, an exact, case-sensitive, untrimmed string of 1–255 characters. It returns zero or one item in the normal pagination envelope; no match is `200` with an empty page. Missing or inaccessible parent Tenants still return `404` on nested TenantUser lists.

Brackets belong to the parameter name; the value is plain text, not a JSON filter object.

Empty values, repeated parameters, unsupported filters, and the unnamespaced `external_id` parameter return `400`. Partial matching, other field filters, sorting, full-text search, inclusion, selection, and counts are not supported.

## Examples

With `ASTRALBEAM_API_KEY` set securely in your server environment, request the first page. `--include` shows the status and response headers alongside the JSON body.

For exact filtering, add `--data-urlencode "filter[external_id]=customer-42"` and keep that parameter on any continuation request.

```sh
export ASTRALBEAM_API_URL="https://app.astralbeam.ai/api"
curl --include --get "$ASTRALBEAM_API_URL/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  --data-urlencode "page_size=1"
```

If the returned `page_after` is not null, copy it into `PAGE_AFTER`:

```sh
PAGE_AFTER="<returned page_after>"
curl --include --get "$ASTRALBEAM_API_URL/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  --data-urlencode "page_size=1" \
  --data-urlencode "page_after=$PAGE_AFTER"
```

To traverse backward, send the returned `page_before` as the `page_before` request parameter instead, and stop when it is null. Never send both directions together.

The example response above also includes a `Link` header with the returned `page_after` and `rel="next"`. Resolve relative links against the request URL.

# Errors

Errors follow the `AstralBeamApiError` schema and use RFC 9457 `application/problem+json`: `type`, `title`, `status`, `detail`, and optional validation `issues` with `path` and `message`.

The following conventions apply across the API. Endpoint descriptions call out resource-specific behavior; their response schemas use this same error format.

| Status    | Meaning                                             |
| --------- | --------------------------------------------------- |
| 400       | Invalid path/query/cursor                           |
| 401 / 403 | Invalid credentials / insufficient authority        |
| 404       | Missing or out-of-scope record                      |
| 409       | Duplicate scoped external ID                        |
| 415       | Unsupported media type or encoding                  |
| 422       | Malformed JSON, invalid write fields or empty PATCH |
| 429       | Rate limit reached; observe Retry-After             |
| 500 / 503 | Safe internal error / setup unavailable             |

Missing and out-of-scope records both return `404`. POST/PATCH reject unknown fields, and PATCH must supply at least one mutable field; invalid writes return `422`.

An invalid `admin` value, for example, returns `422 Unprocessable Content` with `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Invalid request body.",
  "issues": [{ "path": "body.admin", "message": "Expected boolean" }]
}
```

A timed-out or aborted mutation may already have committed; check its outcome before retrying. External proxies can return non-JSON errors, so inspect status and content type before parsing a failure body.

A throttled response includes `Retry-After` in seconds; wait that long before trying again.
