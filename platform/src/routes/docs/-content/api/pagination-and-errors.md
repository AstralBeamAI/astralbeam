# Pagination

All lists support cursor-based pagination in both directions. Use the returned cursors to fetch the next or previous page.

## Requests and responses

- `page_size`: positive integer, default 20. Values above 100 are accepted and capped.
- `page_after`: a returned `page_after` value, to fetch the next page.
- `page_before`: a returned `page_before` value, to fetch the previous page.
- At most one direction is accepted. Unknown/duplicate parameters, invalid sizes, and invalid or wrong-scope cursors return `400`.

Responses contain `items`, `page_after`, and `page_before`. Pass a non-null cursor unchanged as the same-named parameter to continue. A null cursor means no page remains in that direction. Response cursors are continuations, not echoes of the request.

Example response for `page_size=1`. The cursor is a placeholder. Use the actual returned value in requests:

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
  "page_after": "<opaque cursor>",
  "page_before": null
}
```

Stop when your direction's cursor is null, not when a page looks short. Empty pages have no items and both cursors null. You can also follow the `Link` header's `next` or `prev` relation. Page size may change between requests.

Tenants and TenantUsers within a Tenant are ordered by internal `id`, ascending. Backward traversal preserves display order.

## Live listings

Listings are live. Inserts behind a cursor may be missed, and deleted rows disappear. A continuation can return an empty page. Treat cursors as opaque and reuse them only for the same collection and authorized scope. If rejected, restart without a cursor.

TenantUser lists bind cursors to the requested Tenant as well as the caller's scope. Both collections also bind cursors to the active filters. Adding, removing, or changing a filter while reusing a cursor returns `400`. Start without a cursor when changing filters. Pagination links preserve the filters.

## Filters

Both list endpoints accept optional `filter[external_id]`, an exact, case-sensitive, untrimmed string of 1–255 characters. It returns zero or one item in the normal pagination envelope. No match is `200` with an empty page. Missing or inaccessible parent Tenants still return `404` on nested TenantUser lists.

Brackets belong to the parameter name. The value is plain text, not a JSON filter object.

Both lists also accept `q`, up to 255 characters, for case-insensitive substring matching against name or external ID. Leading/trailing whitespace is trimmed, and empty search means no search filter. Percent signs, underscores, and backslashes are literal characters, not wildcards. NUL characters are rejected with `400`.

TenantUser lists additionally accept `filter[admin]=true` or `filter[admin]=false` to filter stored status. Search, exact external-ID, and admin filters combine with AND. Stored admin does not change JWT authority.

Empty exact/admin filter values, repeated parameters, unsupported filters, and the unnamespaced `external_id` parameter return `400`. Sorting, full-text search, inclusion, selection, and counts are not supported.

## Examples

With `ASTRALBEAM_API_KEY` set securely in your server environment, request the first page. `--include` shows the status and response headers alongside the JSON body.

For exact filtering, add `--data-urlencode "filter[external_id]=customer-42"` and keep that parameter on any continuation request.

```sh
export ASTRALBEAM_API_URL="https://astralbeam.ai/api"
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

Errors follow the `AstralBeamApiError` schema and use RFC 9457 `application/problem+json`: `type`, `title`, `status`, `detail`, and optional validation `issues` with `path` and `message`. A `500` also carries a `reference` that matches the server's log entry for the failure, so quote it when you report the problem.

Endpoint descriptions specify exceptions to these shared error conventions:

| Status    | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| 400       | Invalid path/query/cursor or malformed chat input            |
| 401 / 403 | Invalid credentials / insufficient authority                 |
| 404       | Missing or out-of-scope record                               |
| 409       | Duplicate identity, stale revision, or conflicting operation |
| 413       | Chat request exceeds 32 MiB                                  |
| 415       | Unsupported media type or encoding                           |
| 422       | Malformed JSON, invalid write fields or empty PATCH          |
| 429       | Rate or usage limit reached, observe Retry-After             |
| 500 / 503 | Safe internal error / setup unavailable                      |

A chat request refused by a usage limit adds a `usage_limit` member with the limit's display `name` and its `resets_at` time. See [Usage limits](/docs/dashboard/usage-limits).

Missing and out-of-scope records both return `404`. Resource POST/PATCH requests reject unknown fields, and PATCH must supply at least one mutable field. Invalid resource writes return `422`. Chat preserves AG-UI camelCase input and reports malformed input as `400`. Failures after streaming starts are AG-UI `RUN_ERROR` events, not HTTP error responses.

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

A timed-out or aborted mutation may already have committed. Check its outcome before retrying. External proxies can return non-JSON errors, so inspect status and content type before parsing a failure body.

A throttled response includes `Retry-After` in seconds. Wait that long before trying again.
