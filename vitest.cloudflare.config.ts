import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { builtinModules } from "node:module";
import { defineConfig } from "vitest/config";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-20",
        compatibilityFlags: [
          "nodejs_compat",
          "enable_nodejs_http_server_modules",
        ],
      },
    }),
  ],
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["fastify", "pg"],
          rolldownOptions: {
            external: nodeBuiltins,
          },
        },
      },
    },
    include: ["tests/cloudflare/**/*.test.ts"],
  },
});
