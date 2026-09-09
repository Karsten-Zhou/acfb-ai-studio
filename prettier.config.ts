import { type Config } from "prettier";

const config: Config = {
  ignorePath: ["src/components/ui/**", "server/worker-configuration.d.ts"],
};

export default config;
