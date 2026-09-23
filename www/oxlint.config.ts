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

function aliasPresetRules(preset: unknown, sourcePrefix: string, aliasPrefix: string): RuleMap {
  const rules = (preset as { rules?: RuleMap }).rules ?? {}
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, rule]) => !isDisabledRule(rule))
      .map(([ruleName, rule]) => [
        ruleName.startsWith(sourcePrefix)
          ? `${aliasPrefix}${ruleName.slice(sourcePrefix.length)}`
          : ruleName,
        // Every finding blocks; imported presets often default to "warn".
        Array.isArray(rule) ? ["error", ...rule.slice(1)] : "error",
      ]),
  )
}

// TODO: Remove this importer when jsPlugins can apply plugin presets directly.
// https://github.com/oxc-project/oxc/discussions/15277
const recommendedRules = {
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
  jsxA11y: aliasPresetRules(jsxA11yPlugin.configs.recommended, "jsx-a11y-x/", "jsx-a11y-x-js/"),
  // Source: https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-dom/src/configs/recommended.ts
  reactDom: aliasPresetRules(reactDomPlugin.configs.recommended, "react-dom/", "react-dom-js/"),
  // Source: https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/index.ts
  reactHooks: aliasPresetRules(
    reactHooksPlugin.configs.flat.recommended,
    "react-hooks/",
    "react-hooks-js/",
  ),
  // Source: https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-jsx/src/configs/recommended.ts
  reactJsx: aliasPresetRules(reactJsxPlugin.configs.recommended, "react-jsx/", "react-jsx-js/"),
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
// https://github.com/oxc-project/oxc/blob/oxlint_v1.85.0/crates/oxc_linter/src/rules.rs
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
  // TanStack Router throws redirect() and notFound() values for control flow.
  // https://tanstack.com/router/latest/docs/guide/not-found-errors
  "typescript/only-throw-error": [
    "error",
    {
      allow: [
        { from: "package", package: "@tanstack/router-core", name: ["NotFoundError", "Redirect"] },
      ],
    },
  ],
  "typescript/prefer-promise-reject-errors": "error",
  "typescript/require-await": "error",
  "typescript/restrict-plus-operands": "error",
}

// Deno lint's former recommended and jsx rules without a JS preset or correctness-category owner.
// https://docs.deno.com/lint/
const denoRecommendedRules: RuleMap = {
  "no-array-constructor": "error",
  "no-case-declarations": "error",
  "no-empty": "error",
  "no-fallthrough": "error",
  "no-inner-declarations": "error",
  "no-prototype-builtins": "error",
  "no-redeclare": "error",
  "typescript/adjacent-overload-signatures": "error",
  "typescript/ban-ts-comment": "error",
  "typescript/no-empty-interface": "error",
  "typescript/no-explicit-any": "error",
  "typescript/no-namespace": "error",
  "react/button-has-type": "error",
  "react/jsx-boolean-value": "error",
  "react/jsx-curly-brace-presence": "error",
  "react/jsx-key": "error",
  "react/jsx-no-duplicate-props": "error",
  "react/jsx-no-useless-fragment": "error",
  "react/jsx-props-no-spread-multi": "error",
  "react/no-unescaped-entities": "error",
}

const baseRules: RuleMap = {
  ...recommendedRules.router,
  ...recommendedRules.start,
  ...recommendedRules.jsxA11y,
  ...recommendedRules.reactDom,
  ...recommendedRules.reactHooks,
  ...recommendedRules.reactJsx,
  ...recommendedRules.reactWebApi,
  ...recommendedRules.regexp,
  ...typeAwareRules,
  ...denoRecommendedRules,
  // regexp-js owns these specialized equivalents.
  // https://github.com/ota-meshi/eslint-plugin-regexp/blob/master/lib/configs/flat/recommended.ts
  "no-empty-character-class": "off",
  "no-invalid-regexp": "off",
  "no-useless-backreference": "off",
  // The react-hooks, react-jsx, and react-dom JS presets own these native react correctness rules.
  "react/error-boundaries": "off",
  "react/exhaustive-deps": "off",
  "react/globals": "off",
  "react/immutability": "off",
  "react/incompatible-library": "off",
  "react/no-children-prop": "off",
  "react/no-danger-with-children": "off",
  "react/no-find-dom-node": "off",
  "react/no-render-return-value": "off",
  "react/preserve-manual-memoization": "off",
  "react/purity": "off",
  "react/refs": "off",
  "react/set-state-in-effect": "off",
  "react/set-state-in-render": "off",
  "react/static-components": "off",
  "react/use-memo": "off",
  "react/void-dom-elements-no-children": "off",
  // TODO: Re-enable these rules when Oxlint JS plugins provide parser services.
  // https://github.com/oxc-project/oxc/issues/19596
  "tanstack-start-js/no-async-client-component": "off",
  "tanstack-start-js/no-client-code-in-server-component": "off",
}

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
  categories: { correctness: "error" },
  // Keeps Deno's ban-unused-ignore gate, so a stale disable directive fails lint.
  options: { typeAware: true, denyWarnings: true, reportUnusedDisableDirectives: "error" },
  ignorePatterns: [
    // Generated and registry-vendored sources, which regeneration would overwrite.
    "src/routeTree.gen.ts",
  ],
  // Aliases keep JS rules distinct from native implementations and make ownership explicit.
  // https://oxc.rs/docs/guide/usage/linter/js-plugins.html#plugin-aliases
  // TODO: Replace JS registrations one-by-one when native coverage matches each preset.
  // https://oxc.rs/docs/guide/usage/linter/plugins
  jsPlugins: [
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
  ],
})
