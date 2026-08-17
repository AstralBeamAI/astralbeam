# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

## Theme ownership

The root route places the checked-in `@astralbeam/brand/colors.css` stylesheet in the server-rendered document head and applies `.light` before first paint. This keeps the default theme available without shipping the Theme resolver in the client bundle.

Organization lookup, persistence, fallback, and request handling belong at the application boundary. Convert organization definitions with `@astralbeam/theme` on the server and deliver the selected CSS through the same document-head path.
