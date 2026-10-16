# Website development

- Give side-by-side buttons in one group, such as a CTA pair or a dialog's actions, equal widths. Use a `fit-content` grid with `1fr` auto columns, as `.hero-ctas` does in `src/styles/global.css`, so each matches the widest label.
- Keep numbered landing-page step headings focused on the integration action the reader should take.
- Verify feature availability claims against implemented code on current main before changing roadmap labels.
- After each website copy or UI change, show both desktop and mobile screenshots in the response.
- Keep blog prose editable in Markdown and demonstrate interface failures with clearly labeled, self-playing animated simulations that offer Start and Replay controls for both the failure and the better pattern, rather than manual step buttons. A finished failure should flow into its better pattern.
- Reuse the same header and footer components on the home page and blog, including their styling and mobile navigation.
- Initialize hosted analytics through TanStack Start's client entry with the typed SDK, limited to `https://astralbeam.ai` and shared across website, blog, docs, and platform. Rely on SDK defaults except for product and privacy requirements. Capture full URLs, including query strings, fragments, organization slugs, and resource IDs, but redact authentication token values. Mask replay text, inputs, and element attributes, and exclude network bodies and headers.
