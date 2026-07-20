const unavailable = () =>
  Response.json({ code: "STAGING_NOT_IMPLEMENTED" }, { status: 503 });

export default {
  fetch(request: Request) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return unavailable();
    }

    return unavailable();
  },
} satisfies ExportedHandler;
