# Todos example development

- Keep this app a standalone consumer of the built SDK through its `file:../../sdk` dependency.
- Keep the host app on plain CSS with no Tailwind or shadcn/ui so it continues to demonstrate the SDK shadow-root boundary.
- Use plain data and helper functions with explicit options objects for application logic; do not use classes or closure-based state factories.
- Keep TanStack page and server entries under `src/routes`; route files should select or compose components rather than accumulating unrelated application logic.
- Keep reusable UI one component per file under `src/components` and reusable browser subscriptions under `src/hooks`.
- Keep shared configuration in `src/lib/config.ts`, server environment access in `src/lib/config.server.ts`, constants in `src/lib/constants.ts` or `constants.server.ts`, shared types in `src/lib/types.ts`, and general helpers in `src/lib/utils.ts`.
- When a cohesive helper group would make `utils.ts` exceed roughly 100 lines, use a responsibility-named file under `src/lib` instead.
- Keep server-only code in `*.server.ts` files and never import server configuration into client-rendered modules.
- Do not hardcode AstralBeam brand text outside `src/lib/config.ts` or `src/lib/config.server.ts`; import centralized labels and identifiers instead.
- Run `deno task ready` before publishing.
