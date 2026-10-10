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
      // Vue I18n's documented global schema augmentation uses an empty
      // interface extending MessageSchema so useI18n() can infer translation
      // keys across components. The interface is intentionally empty; its
      // inherited members are the schema. Allow this specific interface name
      // without disabling the rule for other empty interfaces.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        {
          allowWithName: "DefineLocaleMessage",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Test harnesses mount components through anonymous render roots.
      "vue/one-component-per-file": "off",
    },
  },
  // i18n checks via @intlify/eslint-plugin-vue-i18n.
  // flat/base enables parsing support for locale files.
  ...pluginVueI18n.configs["flat/base"],

  // Application source: catch missing static translation keys.
  {
    files: ["src/**/*.{ts,vue}"],
    settings: {
      "vue-i18n": {
        localeDir: "src/locales/*.json",
        messageSyntaxVersion: "^11.0.0",
      },
    },
    rules: {
      "@intlify/vue-i18n/no-missing-keys": "error",
    },
  },

  // Locale files: enforce consistency and detect dead translation keys.
  {
    files: ["src/locales/*.json"],
    settings: {
      "vue-i18n": {
        localeDir: "src/locales/*.json",
        srcPath: "src",
      },
    },
    rules: {
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
