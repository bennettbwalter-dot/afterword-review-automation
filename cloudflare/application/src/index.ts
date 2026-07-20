import type { ApplicationEnv } from "../../shared/types";

const unavailable = () =>
  Response.json({ code: "STAGING_NOT_IMPLEMENTED" }, { status: 503 });

export default {
  fetch: unavailable,
} satisfies ExportedHandler<ApplicationEnv>;
