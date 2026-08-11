# Shared UI Components

## Shared colors

- Keep semantic color values in `packages/brand/src/colors.css`; `src/styles.css` imports that palette and maps it into Tailwind without duplicating the values.
- Keep the shared base radius in the brand stylesheet and derive Tailwind's radius scale from that imported token.
- Preserve the explicit theme contract: every consumer must apply exactly one of `.light` or `.dark` to a root or ancestor before first paint.
- Scope shared custom properties under the combined `.light` and `.dark` selectors instead of a global selector.

## Adding shadcn Components

- Keep all shadcn-generated components, hooks, and utilities in this package. Applications must import them through the `@astralbeam/ui` exports.
- Add shadcn components through the package's configured CLI from the repository root:

  ```sh
  vp run @astralbeam/ui#ui add <component>
  ```

- For every component downloaded from shadcn, add a provenance comment at the very top of the generated file. The comment must name only that file's component, even when several components were added in one CLI invocation. Use this format:

  ```tsx
  // shadcn command: `vp run @astralbeam/ui#ui add <component>`
  ```

- When making later manual edits to a downloaded shadcn component, keep the command comment and add or update a concise `Local edits` comment immediately below it. Mention every intentional deviation from the generated component; do not record formatting-only changes.

  ```tsx
  // shadcn command: `vp run @astralbeam/ui#ui add <component>`
  // Local edits: Uses the project button sizing and Base UI focus treatment.
  ```

- Preserve these comments when the component is regenerated. Reconcile the regenerated output with all documented local edits and update the note if those edits change.

## Component quality

- Prefer native semantic elements, accessible names, keyboard-operable interactions, visible focus, and correct label and description relationships before adding ARIA.
- Preserve consumer props, refs, variants, and `className` composition when wrapping Base UI or shadcn primitives; do not hide required accessibility behavior behind application-specific defaults.
- Keep components compatible with React Compiler. Avoid manual memoization, effect-driven derived state, and lint suppressions unless a measured case and upstream guidance justify them.
