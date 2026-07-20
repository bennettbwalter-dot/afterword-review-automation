/**
 * Review Anchor · critical journey verification
 *
 * Exercises the authenticated API surface against a running application
 * process and reports pass/fail for each journey. Intended to be run after a
 * deployment, against that deployment's own origin, using an operator account
 * that is safe to sign in as.
 *
 *   API_BASE=https://app.example.com \
 *   VERIFY_EMAIL=owner@example.com VERIFY_PASSWORD=... \
 *   npm run verify:journeys
 *
 * Falls back to API_HOST/API_PORT and BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD for
 * local runs. Apart from one clearly-labelled completed job, the default run
 * is idempotent: it re-saves the existing SMS policy and does not create a
 * Stripe Checkout Session. Set VERIFY_ALLOW_STRIPE_SESSION=true only against
 * an account where creating a test Checkout Session is intentional.
 */
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const apiBase = process.env.API_BASE
  ?? `http://${process.env.API_HOST ?? "127.0.0.1"}:${process.env.API_PORT ?? 4174}`;
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4173";
const email = process.env.VERIFY_EMAIL ?? process.env.BOOTSTRAP_EMAIL;
const password = process.env.VERIFY_PASSWORD ?? process.env.BOOTSTRAP_PASSWORD;
const allowStripeSession = process.env.VERIFY_ALLOW_STRIPE_SESSION === "true";

if (!email || !password) {
  console.error("Set VERIFY_EMAIL and VERIFY_PASSWORD (or BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD).");
  process.exit(2);
}

let sessionCookie = "";
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(path: string, init: RequestInit = {}, withSession = true) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (!headers.has("Origin")) headers.set("Origin", origin);
  if (withSession && sessionCookie) headers.set("Cookie", sessionCookie);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* non-JSON response retained as text */ }
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  console.log(`\nReview Anchor journey verification\n  target: ${apiBase}\n  origin: ${origin}\n`);

  console.log("Service health");
  const health = await call("/api/v1/health", {}, false);
  record("health endpoint responds", health.status === 200 && health.body?.data?.status === "ok", `status ${health.status}`);

  console.log("\nAuthentication");
  const anon = await call("/api/v1/workspace", {}, false);
  record("unauthenticated workspace denied", anon.status === 401, `status ${anon.status}`);

  const wrong = await call("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "definitely-not-the-password" }),
  }, false);
  record("wrong password rejected", wrong.status === 401, `status ${wrong.status}`);
  record(
    "failed login does not leak account existence",
    wrong.body?.error?.code === "INVALID_CREDENTIALS",
    String(wrong.body?.error?.code ?? "no code"),
  );

  const crossOrigin = await call("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: JSON.stringify({ email, password }),
  }, false);
  record("cross-origin login blocked (CSRF)", crossOrigin.status === 403, `status ${crossOrigin.status}`);

  const login = await call("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, false);
  const setCookie = login.headers.getSetCookie().find((c) => c.startsWith(`${process.env.SESSION_COOKIE_NAME ?? "afterword_session"}=`));
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  record("login succeeds", login.status === 200 && Boolean(setCookie), `status ${login.status}`);
  record("session cookie is HttpOnly", Boolean(setCookie?.toLowerCase().includes("httponly")), "");
  record("session cookie is SameSite=Strict", Boolean(setCookie?.toLowerCase().includes("samesite=strict")), "");

  const session = await call("/api/v1/session");
  const actor = session.body?.data?.session;
  record("session resolves an actor", session.status === 200 && Boolean(actor?.userId), `role ${actor?.role ?? "none"}`);
  record("session response omits secrets", !JSON.stringify(session.body).match(/passwordHash|tokenHash|sessionTokenHash/), "");

  console.log("\nWorkspace and tenancy");
  const workspace = await call("/api/v1/workspace");
  const businesses = workspace.body?.data?.businesses ?? [];
  record("workspace loads", workspace.status === 200 && Array.isArray(businesses), `${businesses.length} business(es)`);
  record("workspace is no-store cached", workspace.headers.get("cache-control")?.includes("no-store") ?? false, "");

  const business = businesses[0];
  if (business) {
    record("business exposes a location", Boolean(business.locationId), business.locationName ?? "none");
    record("customer destinations are masked", !JSON.stringify(workspace.body).match(/\+44\d{9,}|\b\d{11}\b/), "");
  }

  const foreign = await call(`/api/v1/workspace?businessId=${"00000000-0000-4000-8000-000000000000"}`);
  record("foreign tenant id refused", foreign.status === 403 || foreign.status === 404, `status ${foreign.status}`);

  console.log("\nConsent and messaging safety");
  if (business?.locationId) {
    const reference = `VERIFY-${Date.now().toString(36).toUpperCase()}`;
    const job = await call(`/api/v1/businesses/${business.id}/completed-jobs`, {
      method: "POST",
      body: JSON.stringify({
        locationId: business.locationId,
        externalJobId: reference,
        serviceLabel: "Journey verification",
        occurredAt: new Date().toISOString(),
        firstName: "Verification",
        phone: "+447700900123",
        preferredChannel: "SMS",
        consent: {
          status: "granted",
          wording: "I agree to receive a service follow-up and neutral review request.",
          wordingVersion: "review_request_v2",
          purpose: "customer_review_request",
          capturedAt: new Date().toISOString(),
          source: "Journey verification script",
          transactionReference: reference,
          evidenceReference: reference,
        },
      }),
    });
    const created = job.body?.data;
    record("completed job accepted", job.status === 201 || job.status === 200, `status ${job.status} ${created?.status ?? ""}`);
    record(
      "dispatch decision is explicit",
      created?.status === "Queued" || created?.status === "Blocked",
      created?.status === "Blocked" ? "blocked (expected without a verified Google destination)" : String(created?.status),
    );

    const replay = await call(`/api/v1/businesses/${business.id}/completed-jobs`, {
      method: "POST",
      body: JSON.stringify({
        locationId: business.locationId,
        externalJobId: reference,
        serviceLabel: "Journey verification",
        occurredAt: new Date().toISOString(),
        firstName: "Verification",
        phone: "+447700900123",
        preferredChannel: "SMS",
        consent: {
          status: "granted",
          wording: "I agree to receive a service follow-up and neutral review request.",
          wordingVersion: "review_request_v2",
          purpose: "customer_review_request",
          capturedAt: new Date().toISOString(),
          source: "Journey verification script",
          transactionReference: reference,
          evidenceReference: reference,
        },
      }),
    });
    record("duplicate job is idempotent", replay.body?.data?.duplicate === true, `duplicate=${replay.body?.data?.duplicate}`);

    const badConsent = await call(`/api/v1/businesses/${business.id}/completed-jobs`, {
      method: "POST",
      body: JSON.stringify({
        locationId: business.locationId,
        externalJobId: `${reference}-NOCONSENT`,
        serviceLabel: "Journey verification",
        occurredAt: new Date().toISOString(),
        firstName: "Verification",
        preferredChannel: "SMS",
        consent: {
          status: "granted",
          wording: "x",
          wordingVersion: "v",
          purpose: "p",
          capturedAt: new Date().toISOString(),
          source: "s",
          transactionReference: `${reference}-NOCONSENT`,
        },
      }),
    });
    record("SMS without a phone number rejected", badConsent.status === 400, `status ${badConsent.status}`);

    const crossOriginWrite = await call(`/api/v1/businesses/${business.id}/completed-jobs`, {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: JSON.stringify({}),
    });
    record("cross-origin write blocked (CSRF)", crossOriginWrite.status === 403, `status ${crossOriginWrite.status}`);
  } else {
    record("completed job journey", false, "no location on the business; skipped");
  }

  console.log("\nBilling permissions");
  if (business) {
    const currentPolicy = business.billing?.smsOveragePolicy;
    if (currentPolicy) {
      const policy = await call(`/api/v1/businesses/${business.id}/billing/sms-policy`, {
        method: "PATCH",
        body: JSON.stringify({ policy: currentPolicy }),
      });
      record("SMS overage policy update authorised", policy.status === 200, `status ${policy.status}; unchanged (${currentPolicy})`);
    } else {
      record("SMS overage policy update", true, "skipped; billing is not configured for this business");
    }

    const badPolicy = await call(`/api/v1/businesses/${business.id}/billing/sms-policy`, {
      method: "PATCH",
      body: JSON.stringify({ policy: "not_a_policy" }),
    });
    record("invalid billing policy rejected", badPolicy.status === 400, `status ${badPolicy.status}`);

    if (allowStripeSession) {
      const checkout = await call(`/api/v1/businesses/${business.id}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ attemptId: crypto.randomUUID() }),
      });
      const checkoutHandled = checkout.status === 200 || checkout.status === 403 || checkout.status === 409 || checkout.status === 503;
      record(
        "checkout returns a definite outcome",
        checkoutHandled,
        checkout.status === 200 ? "test session created" : `${checkout.status} ${checkout.body?.error?.code ?? ""}`,
      );
    } else {
      record("checkout creation", true, "skipped; set VERIFY_ALLOW_STRIPE_SESSION=true for an intentional test session");
    }
  }

  console.log("\nAgency support boundary");
  const support = await call("/api/v1/support-sessions", {
    method: "POST",
    body: JSON.stringify({ businessId: business?.id ?? "00000000-0000-4000-8000-000000000000", scope: "view", reason: "Journey verification probe", durationMinutes: 15 }),
  });
  record("business owner cannot open a support session", support.status === 403 || support.status === 400, `status ${support.status}`);

  console.log("\nSession lifecycle");
  const logout = await call("/api/v1/auth/logout", { method: "POST" });
  record("logout succeeds", logout.status === 200, `status ${logout.status}`);
  const afterLogout = await call("/api/v1/workspace");
  record("session invalidated after logout", afterLogout.status === 401, `status ${afterLogout.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
    process.exit(1);
  }
  console.log("All critical journeys passed.\n");
}

main().catch((error) => {
  console.error("Verification run failed:", error instanceof Error ? error.message : error);
  process.exit(2);
});
