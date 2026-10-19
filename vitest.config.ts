import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

// Standalone config; the Vue SFC plugin is needed for component (.vue) tests.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts", "src/**/*.test.ts", "server/**/*.test.ts"],
    server: {
      deps: {
        // `vi.mock("idb-keyval")` only reaches modules that Vite processes: an
        // externalized `@vueuse/integrations` imports the real package through
        // Node and would bypass the mock entirely.
        inline: [/idb-keyval/, /@vueuse\/integrations/],
      },
    },
  },
});
