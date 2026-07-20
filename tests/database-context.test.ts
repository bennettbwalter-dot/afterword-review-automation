import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PoolClient } from "pg";
import { setActorContext } from "../server/db.js";
import type { ActorContext } from "../server/types.js";

function actor(supportSessionId?: string): ActorContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    userName: "Agency operator",
    email: "operator@example.test",
    role: "agency_admin",
    agencyId: "00000000-0000-4000-8000-000000000002",
    mfaVerified: true,
    sessionId: "00000000-0000-4000-8000-000000000003",
    sessionTokenHash: Buffer.from("session-hash"),
    supportSessionId,
  };
}

test("database actor context touches an active support lease after binding it", async () => {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const supportSessionId = "00000000-0000-4000-8000-000000000004";

  await setActorContext(client, actor(supportSessionId));

  assert.deepEqual(queries.map((query) => query.text), [
    "select app_private.set_request_context_from_session($1, $2::uuid)",
    "select app_private.touch_support_session($1::uuid)",
  ]);
  assert.deepEqual(queries[1].values, [supportSessionId]);
});

test("database actor context does not touch a support lease for ordinary tenant requests", async () => {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await setActorContext(client, actor());

  assert.deepEqual(queries, ["select app_private.set_request_context_from_session($1, $2::uuid)"]);
});

test("support-session restoration uses the same inactivity boundary as database authorisation", async () => {
  const source = await readFile(new URL("../server/repository/postgres.ts", import.meta.url), "utf8");
  assert.match(source, /support_session\.last_activity_at > statement_timestamp\(\) - interval '15 minutes'/);
  assert.match(source, /support_session\.last_activity_at <= statement_timestamp\(\) \+ interval '1 minute'/);
  assert.match(source, /membership\.status = 'active'/);
  assert.match(source, /app_user\.disabled_at is null/);
});

test("workspace projects database capabilities and selected-location workflow evidence", async () => {
  const source = await readFile(new URL("../server/repository/postgres.ts", import.meta.url), "utf8");
  assert.match(source, /app_private\.current_business_role\(\$1::uuid\)::text as business_role/);
  assert.match(source, /app_private\.can_read_tenant_data\(\$1::uuid, \$2::uuid\) as can_read_tenant/);
  assert.match(source, /app_private\.can_manage_business\(\$1::uuid\) as can_manage_business/);
  assert.match(source, /app_private\.current_support_session_id\(\) is null/);
  assert.match(source, /as can_manage_stripe_billing/);
  assert.match(source, /workflowsByLocation\[requestedLocationId\]/);
  assert.match(source, /from public\.location_messaging_policies policy/);
  assert.match(source, /candidate\.retired_at is null/);
  assert.match(source, /candidate\.version desc, candidate\.approved_at desc nulls last, candidate\.id desc/);
  assert.match(source, /policy\.enabled/);
  assert.match(source, /template\.includes_business_identity, template\.includes_unsubscribe/);
  assert.match(source, /runtime_google\.review_uri as runtime_review_uri/);
  assert.match(source, /app_private\.is_allowed_google_review_url\(profile\.review_uri\) as runtime_review_uri_allowed/);
  assert.match(source, /isGoogleReviewDestinationDispatchable/);
  assert.match(source, /review_destination\.destination_url/);
  assert.match(source, /businessRole:\s*actor\.role === "business_owner"\s*\? selectedBusinessRole\s*:\s*actor\.businessRole/);
  assert.match(source, /businessId:\s*actor\.role === "business_owner"\s*\? requestedBusinessId\s*:\s*actor\.businessId/);
});
