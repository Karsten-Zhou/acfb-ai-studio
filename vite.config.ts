import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

/** Build metadata shown on the Settings → About panel. */
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string; homepage: string };

export default defineConfig({
  plugins: [vue(), tailwindcss(), cloudflare()],
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_REPO_URL__: JSON.stringify(pkg.homepage),
  },
});
