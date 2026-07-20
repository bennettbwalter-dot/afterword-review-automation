import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
    include: ["tests/cloudflare/**/*.test.ts"],
  },
});
