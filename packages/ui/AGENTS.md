# Shared UI Components

## Adding shadcn Components

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
