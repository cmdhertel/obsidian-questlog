import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

// Same rules as the automated review of the Obsidian community directory.
export default defineConfig(
  globalIgnores(["node_modules", "main.js", "*.mjs", "scripts", "tests", "vitest.config.ts", "package-lock.json", "tsconfig.json", "versions.json"]),
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
  },
);
