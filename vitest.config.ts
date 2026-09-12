import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone config so unit tests do not need the Cloudflare/Vite plugins.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts", "src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
