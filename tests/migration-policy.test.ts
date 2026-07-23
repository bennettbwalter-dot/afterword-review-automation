import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationApproved,
  migrationTargetFingerprint,
  parseMigrationApprovalManifest,
} from "../scripts/migration-policy.js";

const target = migrationTargetFingerprint("postgresql://user:secret@db.example:5432/review_anchor");

test("migrations through 011 need no deployment override", () => {
  assert.doesNotThrow(() => assertMigrationApproved("011_agency_client_grants.sql", "a".repeat(64), target, undefined));
});

test("later migrations require an exact target and checksum manifest", () => {
  assert.throws(
    () => assertMigrationApproved("019_provider_independent_security.sql", "b".repeat(64), target, undefined),
    /not approved/i,
  );
  const manifest = parseMigrationApprovalManifest(JSON.stringify({
    targetSha256: target,
    evidenceId: "ci-provider-independent-security",
    migrations: { "019_provider_independent_security.sql": "b".repeat(64) },
  }));
  assert.doesNotThrow(() => assertMigrationApproved("019_provider_independent_security.sql", "b".repeat(64), target, manifest));
  assert.throws(
    () => assertMigrationApproved("019_provider_independent_security.sql", "c".repeat(64), target, manifest),
    /checksum/i,
  );
  assert.throws(
    () => assertMigrationApproved("012_agency_access_enforcement.sql", "b".repeat(64), target, manifest),
    /checksum/i,
  );
  assert.throws(
    () => assertMigrationApproved("019_provider_independent_security.sql", "b".repeat(64), "d".repeat(64), manifest),
    /not approved/i,
  );
});

test("approval manifests reject secrets, malformed hashes and empty evidence", () => {
  assert.throws(
    () => parseMigrationApprovalManifest('{"targetSha256":"bad","evidenceId":"","migrations":{}}'),
    /manifest/i,
  );
  assert.throws(
    () => parseMigrationApprovalManifest(JSON.stringify({
      targetSha256: target,
      evidenceId: "broad approval",
      migrations: { "*.sql": "b".repeat(64) },
    })),
    /manifest/i,
  );
  assert.equal(target.includes("secret"), false);
});
