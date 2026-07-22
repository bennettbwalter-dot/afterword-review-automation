import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("support-role operators may open only view support sessions and share the database reason boundary", async () => {
  const source = await readFile(path.resolve("server", "routes", "support.ts"), "utf8");
  assert.match(source, /reason:\s*z\.string\(\)\.trim\(\)\.min\(12\)/);
  assert.match(source, /\["owner",\s*"admin",\s*"support"\]/);
  assert.match(source, /actor\.agencyRole\s*===\s*"support"[\s\S]{0,180}body\.scope\s*!==\s*"view"/);
  assert.doesNotMatch(source, /actor\.role\s*!==\s*"agency_admin"/);
});

test("Google mutations require business management while selection reads remain readable", async () => {
  const shared = await readFile(path.resolve("server", "routes", "shared.ts"), "utf8");
  const google = await readFile(path.resolve("server", "routes", "google.ts"), "utf8");
  assert.match(shared, /export async function requireBusinessManagement[\s\S]+workspace\.access\?\.canManageBusiness\s*!==\s*true/);
  assert.match(google, /requireBusinessManagement\(options\.repository, actor, businessId\)/);
  assert.match(google, /requireBusinessManagement\(options\.repository, actor, pending\.businessId\)/);
  assert.match(google, /requireBusinessManagement\(options\.repository, actor, businessId\)[\s\S]{0,180}requestGoogleReviewSync/);
  assert.match(google, /requireBusinessManagement\(options\.repository, actor, businessId\)[\s\S]{0,220}disconnectGoogleConnection/);
  assert.match(google, /requireBusinessAccess\(options\.repository, actor, state\.businessId\)/);
});
