import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["main.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        Promise: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        MutationObserver: "readonly",
        Image: "readonly",
        confirm: "readonly",
        module: "writable",
        require: "readonly",
      },
    },
    rules: {
      // obsidianmd/recommended already includes the key rules:
      // - no-plugin-name-in-commands
      // - no-detach-leaves-in-unload
      // - no-global-document (use activeDocument)
      // - prefer-registered-events
      // - no-static-style
      // Additional overrides for pre-TypeScript JS build:
      "no-unused-vars": "warn",
      "no-undef": "warn",
    },
  },
]);
