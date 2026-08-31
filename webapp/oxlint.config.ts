import queryPlugin from "@tanstack/eslint-plugin-query"
import routerPlugin from "@tanstack/eslint-plugin-router"
import startPlugin from "@tanstack/eslint-plugin-start"
import vitestPlugin from "@vitest/eslint-plugin"
import jsxA11yPlugin from "eslint-plugin-jsx-a11y-x"
import reactDomPlugin from "eslint-plugin-react-dom"
import reactHooksPlugin from "eslint-plugin-react-hooks"
import reactJsxPlugin from "eslint-plugin-react-jsx"
import reactWebApiPlugin from "eslint-plugin-react-web-api"
import regexpPlugin from "eslint-plugin-regexp"
import { defineConfig, type DummyRule } from "oxlint"

// Import/rename/filter pattern references:
// https://github.com/gitbutlerapp/gitbutler/blob/423e257b6d590f52ab7d0f8983bef518d419c699/apps/lite/oxlint.config.ts
// https://github.com/kazupon/vp-config/blob/41a53fad51b54cec5b0c03ef42aadcf65012f11f/src/lint/regexp.ts
type RuleMap = Record<string, DummyRule>

function isDisabledRule(rule: DummyRule): boolean {
  const severity = Array.isArray(rule) ? rule[0] : rule
  return severity === "allow" || severity === "off" || severity === 0
}

function aliasPresetRules(
  preset: unknown,
  sourcePrefix: string,
  aliasPrefix: string,
): RuleMap {
  const rules = (preset as { rules?: RuleMap }).rules ?? {}
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, rule]) => !isDisabledRule(rule))
      .map(([ruleName, rule]) => [
        ruleName.startsWith(sourcePrefix)
          ? `${aliasPrefix}${ruleName.slice(sourcePrefix.length)}`
          : ruleName,
        rule,
      ]),
  )
}

// TODO: Remove this importer when jsPlugins can apply plugin presets directly.
// https://github.com/oxc-project/oxc/discussions/15277
const recommendedRules = {
  // Source: https://github.com/TanStack/query/blob/main/packages/eslint-plugin-query/src/index.ts
  query: aliasPresetRules(
    queryPlugin.configs.recommended,
    "@tanstack/query/",
    "tanstack-query-js/",
  ),
  // Source: https://github.com/TanStack/router/blob/main/packages/eslint-plugin-router/src/index.ts
  router: aliasPresetRules(
    routerPlugin.configs.recommended,
    "@tanstack/router/",
    "tanstack-router-js/",
  ),
  // Source: https://github.com/TanStack/router/blob/main/packages/eslint-plugin-start/src/index.ts
  start: aliasPresetRules(
    startPlugin.configs.recommended,
    "@tanstack/start/",
    "tanstack-start-js/",
  ),
  // Source: https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/src/index.ts
  vitest: aliasPresetRules(vitestPlugin.configs.recommended, "vitest/", "vitest-js/"),
  // Source: https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/blob/main/src/index.js
  jsxA11y: aliasPresetRules(
    jsxA11yPlugin.configs.recommended,
    "jsx-a11y-x/",
    "jsx-a11y-x-js/",
  ),
  // Source: https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-dom/src/configs/recommended.ts
  reactDom: aliasPresetRules(
    reactDomPlugin.configs.recommended,
    "react-dom/",
    "react-dom-js/",
  ),
  // Source: https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/index.ts
  reactHooks: aliasPresetRules(
    reactHooksPlugin.configs.flat.recommended,
    "react-hooks/",
    "react-hooks-js/",
  ),
  // Source: https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-jsx/src/configs/recommended.ts
  reactJsx: aliasPresetRules(
    reactJsxPlugin.configs.recommended,
    "react-jsx/",
    "react-jsx-js/",
  ),
  // Source: https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-web-api/src/configs/recommended.ts
  reactWebApi: aliasPresetRules(
    reactWebApiPlugin.configs.recommended,
    "react-web-api/",
    "react-web-api-js/",
  ),
  // Source: https://github.com/ota-meshi/eslint-plugin-regexp/blob/master/lib/configs/flat/recommended.ts
  regexp: aliasPresetRules(regexpPlugin.configs["flat/recommended"], "regexp/", "regexp-js/"),
}

// Selected type-aware rules plus core companions; other correctness rules come from the category.
// TODO: Remove this list if type-aware mode gains a recommended preset for these rules.
// https://github.com/oxc-project/tsgolint#implemented-rules
// https://github.com/oxc-project/oxc/blob/oxlint_v1.80.0/crates/oxc_linter/src/rules.rs
const typeAwareRules: RuleMap = {
  "no-var": "error",
  "prefer-const": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  "typescript/no-misused-promises": "error",
  "typescript/no-unnecessary-type-assertion": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-call": "error",
  "typescript/no-unsafe-enum-comparison": "error",
  "typescript/no-unsafe-member-access": "error",
  "typescript/no-unsafe-return": "error",
  "typescript/only-throw-error": "error",
  "typescript/prefer-promise-reject-errors": "error",
  "typescript/require-await": "error",
  "typescript/restrict-plus-operands": "error",
}

const baseRules: RuleMap = {
  ...recommendedRules.query,
  ...recommendedRules.router,
  ...recommendedRules.start,
  ...recommendedRules.jsxA11y,
  ...recommendedRules.reactDom,
  ...recommendedRules.reactHooks,
  ...recommendedRules.reactJsx,
  ...recommendedRules.reactWebApi,
  ...recommendedRules.regexp,
  ...typeAwareRules,
  // Deno's no-empty/ban-types and regexp-js own the broader or specialized equivalents.
  // Sources: https://github.com/denoland/deno_lint/blob/main/src/rules.rs
  //          https://github.com/ota-meshi/eslint-plugin-regexp/blob/master/lib/configs/flat/recommended.ts
  //          https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/rules.rs
  "no-empty-static-block": "off",
  "typescript/no-wrapper-object-types": "off",
  "no-empty-character-class": "off",
  "no-invalid-regexp": "off",
  "no-useless-backreference": "off",
  // TODO: Re-enable these rules when Oxlint JS plugins provide parser services.
  // https://github.com/oxc-project/oxc/issues/19596
  "tanstack-query-js/no-void-query-fn": "off",
  "tanstack-start-js/no-async-client-component": "off",
  "tanstack-start-js/no-client-code-in-server-component": "off",
  // TODO: Re-enable when Oxc preserves RegExp flag order in these compatibility cases.
  // https://github.com/oxc-project/oxc/issues/20609
  "regexp-js/sort-flags": "off",
}

function disabledRuleOverrides(ruleFiles: Record<string, string | string[]>) {
  return Object.entries(ruleFiles).map(([rule, filePatterns]) => ({
    files: typeof filePatterns === "string" ? [filePatterns] : filePatterns,
    rules: { [rule]: "off" as const },
  }))
}

export default defineConfig({
  categories: { correctness: "error" },
  options: { typeAware: true },
  ignorePatterns: [
    // TODO: Remove each generated-source ignore when its output becomes lint-clean and fixer-safe.
    // https://github.com/AstralBeamAI/astralbeam/pull/57#discussion_r3888132311
    "src/components/ui/**",
    "src/routeTree.gen.ts",
  ],
  // Aliases keep JS rules distinct from native implementations and make ownership explicit.
  // https://oxc.rs/docs/guide/usage/linter/js-plugins.html#plugin-aliases
  // TODO: Replace JS registrations one-by-one when native coverage matches each preset.
  // https://oxc.rs/docs/guide/usage/linter/plugins
  jsPlugins: [
    { name: "tanstack-query-js", specifier: "@tanstack/eslint-plugin-query" },
    { name: "tanstack-router-js", specifier: "@tanstack/eslint-plugin-router" },
    { name: "tanstack-start-js", specifier: "@tanstack/eslint-plugin-start" },
    { name: "vitest-js", specifier: "@vitest/eslint-plugin" },
    { name: "jsx-a11y-x-js", specifier: "eslint-plugin-jsx-a11y-x" },
    { name: "react-dom-js", specifier: "eslint-plugin-react-dom" },
    { name: "react-hooks-js", specifier: "eslint-plugin-react-hooks" },
    { name: "react-jsx-js", specifier: "eslint-plugin-react-jsx" },
    { name: "react-web-api-js", specifier: "eslint-plugin-react-web-api" },
    { name: "regexp-js", specifier: "eslint-plugin-regexp" },
  ],
  rules: baseRules,
  overrides: [
    {
      files: ["**/*.test.{ts,tsx}"],
      rules: recommendedRules.vitest,
    },
    // TODO(oxlint-rollout): Delete this map after resolving its 52 findings across 32 files.
    // Sources: https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/blob/main/src/index.js
    //          https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/index.ts
    //          https://github.com/oxc-project/tsgolint#implemented-rules
    //          https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/rules.rs
    ...disabledRuleOverrides({
      // TODO: Remove intentional autofocus from 2 dialogs without regressing focus placement.
      "jsx-a11y-x-js/no-autofocus": [
        "src/components/auth/organization/create-organization-dialog.tsx",
        "src/components/auth/organization/invite-member-dialog.tsx",
      ],
      // TODO: Stabilize or include the missing dependencies in 2 files.
      "react-hooks-js/exhaustive-deps": [
        "src/components/auth/organization/slug-field.tsx",
        "src/components/auth/sign-out.tsx",
      ],
      // TODO: Rework memoization in 1 file so React Compiler can preserve it.
      "react-hooks-js/preserve-manual-memoization": "src/components/auth/open-email-button.tsx",
      // TODO: Remove 13 synchronous state updates from effects across these 11 files.
      "react-hooks-js/set-state-in-effect": [
        "src/components/auth/auth-result.tsx",
        "src/components/auth/organization/create-organization-dialog.tsx",
        "src/components/auth/organization/edit-member-roles-dialog.tsx",
        "src/components/auth/organization/invite-member-dialog.tsx",
        "src/components/auth/organization/organization-members.tsx",
        "src/components/auth/organization/slug-field.tsx",
        "src/components/auth/reset-link-sent.tsx",
        "src/components/auth/theme/appearance.tsx",
        "src/components/auth/user/user-avatar.tsx",
        "src/components/auth/verify-email.tsx",
        "src/hooks/use-mobile.ts",
      ],
      // TODO: Adapt 4 promise-returning handlers across these 3 files to void callback contracts.
      "typescript/no-misused-promises": [
        "src/components/auth/settings/account/change-avatar.tsx",
        "src/routes/__root.tsx",
        "src/routes/configure/-components/operator-login-form.tsx",
      ],
      // TODO: Preserve the documented provider names without a redundant string union in 1 file.
      "typescript/no-redundant-type-constituents":
        "src/components/auth/settings/security/linked-account.tsx",
      // TODO: Recheck all 3 files after the upstream regression is fixed.
      // https://github.com/oxc-project/tsgolint/issues/1122
      "typescript/no-unnecessary-type-assertion": [
        "src/components/auth/settings/security/linked-account.tsx",
        "src/db/migration-runner.server.ts",
        "src/lib/auth/organization-plugin.tsx",
      ],
      // TODO: Type the decoded fixture before passing it onward in 1 file.
      "typescript/no-unsafe-argument": "src/db/lib/encryption.server.test.ts",
      // TODO: Type external and mocked values before 5 assignments across these 5 files.
      "typescript/no-unsafe-assignment": [
        "src/db/lib/encryption.server.test.ts",
        "src/db/migration-runner.server.test.ts",
        "src/lib/config.server.test.ts",
        "src/routes/(authentication)/auth/$path.tsx",
        "src/routes/api/status.ts",
      ],
      // TODO: Type the migration mock before its 2 calls in 1 file.
      "typescript/no-unsafe-call": "src/db/migration-runner.server.test.ts",
      // TODO: Narrow unknown values before 3 property accesses across these 3 files.
      "typescript/no-unsafe-member-access": [
        "src/components/auth/sign-in.tsx",
        "src/db/migration-runner.server.test.ts",
        "src/routes/api/status.ts",
      ],
      // TODO: Type library and mock boundary returns in these 2 files.
      "typescript/no-unsafe-return": [
        "src/components/auth/settings/settings.tsx",
        "src/db/migration-runner.server.test.ts",
      ],
      // TODO: Recheck the 2 generated defaults after the upstream prop contract changes.
      "typescript/no-useless-default-assignment": [
        "src/components/auth/theme/appearance.tsx",
        "src/components/auth/theme/theme-toggle-item.tsx",
      ],
      // TanStack Router intentionally throws redirect() and notFound() control-flow values.
      // TODO: Reconcile 11 control-flow throws across these 7 files with Error-only throws.
      // https://github.com/TanStack/router/discussions/2168
      "typescript/only-throw-error": [
        "src/routes/(authentication)/auth/$path.tsx",
        "src/routes/__root.tsx",
        "src/routes/_authenticated/_organization/route.tsx",
        "src/routes/_authenticated/onboarding/index.tsx",
        "src/routes/_authenticated/route.tsx",
        "src/routes/_authenticated/settings/route.tsx",
        "src/routes/configure/-lib/configure-request.server.ts",
      ],
    }),
  ],
})
