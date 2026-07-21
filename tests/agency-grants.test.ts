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
  for (const command of ["request_agency_client_grant", "accept_agency_client_grant", "reject_agency_client_grant", "revoke_agency_client_grant", "has_agency_client_permission"]) {
    assert.match(schema, new RegExp(`function\\s+app_private\\.${command}\\s*\\(`, "i"));
  }
  assert.match(schema, /current_support_session_id\(\)\s+is\s+not\s+null[\s\S]{0,160}raise exception 'support sessions cannot mutate agency grants'/i);
  assert.match(schema, /current_business_role\(v_grant\.business_id\)::text\s+not\s+in\s*\('owner',\s*'admin'\)/i);
  assert.match(schema, /set search_path\s*=\s*pg_catalog/gi);
  assert.match(schema, /revoke all on function app_private\.request_agency_client_grant[\s\S]+from public/i);
});
