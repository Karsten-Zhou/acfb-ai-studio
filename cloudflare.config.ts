import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode }) => {
  const DEBUG = mode === "development";

  return {
    worker: {
      name: DEBUG ? "acfb-ai-studio-dev" : "acfb-ai-studio",
      compatibilityDate: "2026-09-09",
      entrypoint: "server/index.ts",
      observability: {
        enabled: true,
      },
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api/*"],
      },
      env: {
        SYNC_KV: bindings.kv({}),
        AI: bindings.ai({
          dev: {
            remote: true,
          },
        }),
      },
    },
  };
});
