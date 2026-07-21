import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { hasAgencyGrantPermission, type AgencyGrant } from "../server/agency/types.js";

const activeGrant: AgencyGrant = {
  id: "00000000-0000-4000-8000-000000000001",
  agencyId: "00000000-0000-4000-8000-000000000002",
  businessId: "00000000-0000-4000-8000-000000000003",
  locationId: "00000000-0000-4000-8000-000000000004",
  status: "active",
  permissions: ["content.create", "content.self_approve"],
  selfApproverUserId: "00000000-0000-4000-8000-000000000005",
};

test("agency grants keep permissions independent and scope approval to one location", () => {
  assert.equal(hasAgencyGrantPermission(activeGrant, "content.create", activeGrant.locationId), true);
  assert.equal(hasAgencyGrantPermission(activeGrant, "content.publish", activeGrant.locationId), false);
  assert.equal(hasAgencyGrantPermission(activeGrant, "content.create", "00000000-0000-4000-8000-000000000099"), false);
});

test("inactive, expired and un-named self-approval grants fail closed", () => {
  assert.equal(hasAgencyGrantPermission({ ...activeGrant, status: "revoked" }, "content.create", activeGrant.locationId), false);
  assert.equal(hasAgencyGrantPermission({ ...activeGrant, expiresAt: "2020-01-01T00:00:00.000Z" }, "content.create", activeGrant.locationId), false);
  assert.equal(hasAgencyGrantPermission({ ...activeGrant, selfApproverUserId: undefined }, "content.self_approve", activeGrant.locationId, "00000000-0000-4000-8000-000000000005"), false);
  assert.equal(hasAgencyGrantPermission(activeGrant, "content.self_approve", activeGrant.locationId, "00000000-0000-4000-8000-000000000006"), false);
});

test("grant migration uses named, actor-bound commands and denies support mutations", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  for (const command of ["request_agency_client_grant", "accept_agency_client_grant", "reject_agency_client_grant", "revoke_current_agency_client_grant", "revoke_current_client_agency_grant", "has_agency_client_permission"]) {
    assert.match(schema, new RegExp(`function\\s+app_private\\.${command}\\s*\\(`, "i"));
  }
  assert.match(schema, /current_support_session_id\(\)\s+is\s+not\s+null[\s\S]{0,160}raise exception 'support sessions cannot mutate agency grants'/i);
  assert.match(schema, /current_business_role\(v_grant\.business_id\)::text\s+not\s+in\s*\('owner',\s*'admin'\)/i);
  assert.match(schema, /set search_path\s*=\s*pg_catalog/gi);
  assert.match(schema, /revoke all on function app_private\.request_agency_client_grant[\s\S]+from public/i);
});

test("agency permission checks deny support sessions and grant claims are opaque, single-use and scope bound", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  const databaseTest = await readFile(path.resolve("database", "tests", "006_agency_grants.sql"), "utf8");
  assert.match(schema, /function\s+app_private\.has_agency_client_permission[\s\S]{0,900}current_support_session_id\(\)\s+is\s+null/is);
  for (const command of ["issue_agency_client_grant_claim", "consume_agency_client_grant_claim", "list_agency_client_grant_claim_locations", "expire_stale_agency_client_grants"]) {
    assert.match(schema, new RegExp(`function\\s+app_private\\.${command}\\s*\\(`, "i"));
  }
  assert.match(schema, /token_hash bytea primary key check \(length\(token_hash\) = 32\)/i);
  assert.match(schema, /for update skip locked/i);
  assert.match(schema, /consumed_at is null and claim\.expires_at > statement_timestamp\(\)/i);
  assert.match(databaseTest, /support-session permission denial/i);
  assert.match(databaseTest, /sibling location/i);
});

test("claim approval lets only the direct client discover and select a named location, with replay-safe consumption", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  const app = await readFile(path.resolve("src", "App.tsx"), "utf8");
  const runner = await readFile(path.resolve("scripts", "test-database-isolation.ts"), "utf8");
  assert.match(schema, /function\s+app_private\.list_agency_client_claim_locations[\s\S]+business_memberships/i);
  assert.match(schema, /function\s+app_private\.select_agency_client_claim_location[\s\S]+membership\.user_id\s*=\s*app_private\.current_user_id\(\)/i);
  assert.match(schema, /select\s+lower\(btrim\(email\)\)/i);
  assert.match(schema, /get diagnostics v_found = row_count/i);
  assert.match(app, /ClientLocationSelector/);
  assert.match(app, /agency-grant/);
  assert.match(runner, /\\assert/);
});

test("agency issuance requires named least-privilege choices and an explicit review confirmation", async () => {
  const dialog = await readFile(path.resolve("src", "features", "agency", "AgencyGrantDialog.tsx"), "utf8");
  assert.match(dialog, /useState<AgencyGrantPermission\[\]>/);
  assert.match(dialog, /Review requested permissions/);
  assert.match(dialog, /Confirm and create client approval link/);
  assert.doesNotMatch(dialog, /const permissions: AgencyGrantPermission\[\] =/);
});

test("self approval requires a named agency approver through the UI and API contract", async () => {
  const dialog = await readFile(path.resolve("src", "features", "agency", "AgencyGrantDialog.tsx"), "utf8");
  const routes = await readFile(path.resolve("server", "routes", "agency-grants.ts"), "utf8");
  const repository = await readFile(path.resolve("server", "agency", "postgres.ts"), "utf8");
  assert.match(dialog, /content\.self_approve/);
  assert.match(dialog, /Named self-approver user ID/);
  assert.match(routes, /Self approval requires one named agency user/i);
  assert.match(repository, /selfApproverUserId \?\? null/);
});

test("client location choice is pending until an explicit permission confirmation", async () => {
  const selector = await readFile(path.resolve("src", "features", "agency", "ClientLocationSelector.tsx"), "utf8");
  assert.match(selector, /setPending\(scope\)/);
  assert.match(selector, /Confirm agency permissions/);
  assert.match(selector, /pending\.permissions\.map/);
  assert.match(selector, /Confirm agency access/);
});

test("active grant listing is actor-bound, excludes support sessions, and returns only active unexpired scopes", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  const routes = await readFile(path.resolve("server", "routes", "agency-grants.ts"), "utf8");
  assert.match(schema, /function\s+app_private\.list_active_agency_client_grants[\s\S]+grant\.status='active'[\s\S]+current_support_session_id\(\) is null[\s\S]+current_agency_role\(p_agency_id\)::text in \('owner','admin','operator'\)/i);
  assert.match(schema, /revoke all on function app_private\.list_active_agency_client_grants\(uuid\) from public/i);
  assert.match(routes, /agency-grants\/active[\s\S]+requireSameOrigin[\s\S]+SUPPORT_SESSION_READ_ONLY[\s\S]+actor\.agencyId !== agencyId/i);
});

test("agency workspace exposes persistent active-grant selection and immediate server-backed revocation", async () => {
  const controls = await readFile(path.resolve("src", "features", "agency", "ActiveAgencyGrantControls.tsx"), "utf8");
  const api = await readFile(path.resolve("src", "platform", "api.ts"), "utf8");
  assert.match(controls, /listActiveAgencyClientGrants\(agencyId\)/);
  assert.match(controls, /Revoke access/);
  assert.match(controls, /await platformApi\.revokeAgencyGrantInCurrentAgency\(selected\.id, agencyId\); await load\(\)/);
  assert.match(controls, /search\.set\("agencyGrant", next\)[\s\S]+navigate\(\{ search: search\.toString\(\) \}/);
  assert.match(controls, /canRevoke && <button/);
  assert.match(api, /agency-grants\/\$\{encodeURIComponent\(grantId\)\}\/revoke-in-agency/);
});

test("clients can immediately revoke their own selected business grant", async () => {
  const selector = await readFile(path.resolve("src", "features", "agency", "ClientLocationSelector.tsx"), "utf8");
  const routes = await readFile(path.resolve("server", "routes", "agency-grants.ts"), "utf8");
  assert.match(selector, /revokeAgencyGrantAsCurrentClient\(activeGrant\.id, activeGrant\.businessId\)/);
  assert.match(selector, /Revoke agency access/);
  assert.match(routes, /revoke-as-client[\s\S]+revokeCurrentClientAgencyGrant/i);
});

test("single-location claims stage consent and replay refuses revoked or expired access", async () => {
  const selector = await readFile(path.resolve("src", "features", "agency", "ClientLocationSelector.tsx"), "utf8");
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  assert.match(selector, /scopes\.length === 1\) \{ setSelected\(scopes\[0\]!\.locationId\); setPending\(scopes\[0\]!\); \}/);
  assert.match(schema, /claim\.selected_grant_id is not null and grant\.status='active'/i);
  assert.match(schema, /selected agency grant is no longer active/i);
});

test("the generic revoke surface is removed in favour of scoped agency and client commands", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "011_agency_client_grants.sql"), "utf8");
  const api = await readFile(path.resolve("src", "platform", "api.ts"), "utf8");
  assert.doesNotMatch(schema, /function\s+app_private\.revoke_agency_client_grant\s*\(/i);
  assert.doesNotMatch(api, /async revokeAgencyGrant\(grantId/);
  assert.match(schema, /revoke_current_agency_client_grant/i);
  assert.match(schema, /revoke_current_client_agency_grant/i);
});
