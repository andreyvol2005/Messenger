import js from "@eslint/js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // ── Correctness ──────────────────────────────────────────────────────
      "no-undef":        "error",
      "eqeqeq":          ["error", "smart"],
      "no-eval":         "error",
      "no-implied-eval": "error",
      "no-new-func":     "error",
      "no-empty":        ["error", { "allowEmptyCatch": true }],

      // ── Code quality (warnings = informational, don't block CI) ──────────
      "no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^(e|err|_)"
      }],
      "no-prototype-builtins": "warn",

      // ── Style ────────────────────────────────────────────────────────────
      "prefer-const": "warn",
      "no-var":       "warn",

      // console.* is intentional in a real-time messenger app
      "no-console":   "off"
    }
  },

  {
    ignores: ["node_modules/"]
  }
];
