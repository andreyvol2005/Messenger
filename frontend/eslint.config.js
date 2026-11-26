import js from "@eslint/js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Base recommended rules
  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // "module" is correct for ES-module files (import/export).
      // For plain <script> files without import/export it is also safe.
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // ── Correctness ──────────────────────────────────────────────────────
      // Disabled: vanilla JS shares globals across files via <script> tags;
      // ESLint cannot see that cross-file scope, producing false positives.
      "no-undef":               "off",

      "eqeqeq":                 ["error", "smart"],
      "no-eval":                "error",
      "no-implied-eval":        "error",
      "no-new-func":            "error",

      // ── Code quality (warnings = informational, don't block CI) ──────────
      "no-unused-vars":         ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }],
      "no-prototype-builtins":  "warn",

      // ── Style ────────────────────────────────────────────────────────────
      "prefer-const":           "warn",
      "no-var":                 "warn",

      // console.* is intentional in a real-time messenger app
      "no-console":             "off"
    }
  },

  {
    ignores: ["node_modules/"]
  }
];
