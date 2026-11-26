import js from "@eslint/js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Base recommended rules (applies to all JS files)
  js.configs.recommended,

  // Project-specific overrides
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // "script" = vanilla browser scripts loaded via <script> tags (no bundler).
      // Switch to "module" if you migrate to ES module imports.
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // ── Correctness ─────────────────────────────────────────────────────
      "no-undef":               "error",
      "eqeqeq":                 ["error", "smart"],
      "no-eval":                "error",
      "no-implied-eval":        "error",
      "no-new-func":            "error",

      // ── Code quality ────────────────────────────────────────────────────
      "no-unused-vars":         ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }],
      "no-prototype-builtins":  "warn",

      // ── Style (non-breaking for existing code) ──────────────────────────
      "prefer-const":           "warn",
      "no-var":                 "warn",

      // console.log is intentional in a real-time messenger
      "no-console":             "off"
    }
  },

  // Ignore tooling output
  {
    ignores: ["node_modules/"]
  }
];
