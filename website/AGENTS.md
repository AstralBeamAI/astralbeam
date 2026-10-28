# Website development

- Keep `www.astralbeam.ai` and `app.astralbeam.ai` redirects at Cloudflare. The legacy app API hostname is retired. Preserve the demo and play proxies.
- Give grouped buttons equal widths using `.hero-ctas`' `fit-content` grid with `1fr` auto columns. Landing-page step headings name the reader's integration action.
- Verify availability claims against current main before changing roadmap labels. Show desktop and mobile screenshots after every copy or UI change.
- Keep blog prose in Markdown. Demonstrate failures with clearly labeled, self-playing simulations offering Start and Replay controls for both failure and better pattern. Automatically transition between them, without manual step buttons.
- Reuse home-page header/footer components, styling, and mobile navigation on the blog.
- Initialize hosted analytics through TanStack Start's client entry and typed SDK, only on `https://astralbeam.ai`, shared across website, blog, docs, and platform. Prefer SDK defaults except product/privacy requirements.
- Preserve default full-URL capture, including queries, fragments, organization slugs, resource IDs, and authentication tokens. Mask replay text, inputs, and element attributes. Exclude network bodies and headers.
