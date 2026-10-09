import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginVue from "eslint-plugin-vue";
import pluginVueI18n from "@intlify/eslint-plugin-vue-i18n";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "*.d.ts",
      "**/coverage",
      "**/dist",
      "src/components/ui/**",
      ".cloudflare/**",
      "server/worker-configuration.d.ts",
    ],
  },
  {
    extends: [
      eslint.configs.recommended,
      ...typescriptEslint.configs.recommended,
      ...eslintPluginVue.configs["flat/recommended"],
    ],
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        __APP_VERSION__: "readonly",
        __APP_BUILD_TIME__: "readonly",
        __APP_REPO_URL__: "readonly",
      },
      parserOptions: {
        parser: typescriptEslint.parser,
      },
    },
    rules: {
      // your rules
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Test harnesses mount components through anonymous render roots.
      "vue/one-component-per-file": "off",
    },
  }, // i18n key checks via @intlify/eslint-plugin-vue-i18n: keys must exist in
  // every locale and dead keys are rejected. These rules walk the *locale*
  // AST, so `flat/base` parses the *.json / *.yaml locales as JSON. Scoping
  // below to the locale files avoids misreporting every key of unrelated *.json
  // as unused.
  ...pluginVueI18n.configs["flat/base"],
  {
    files: ["src/locales/*.json"],
    settings: {
      "vue-i18n": {
        localeDir: "src/locales/*.json",
        srcPath: "src",
      },
    },
    rules: {
      "@intlify/vue-i18n/no-missing-keys": "error",
      "@intlify/vue-i18n/no-missing-keys-in-other-locales": "error",
      "@intlify/vue-i18n/no-duplicate-keys-in-locale": "error",
      "@intlify/vue-i18n/no-unused-keys": [
        "error",
        {
          src: "./src",
          extensions: [".js", ".ts", ".vue"],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
