import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  locateRecoverableManifest,
  validateMigrationEnvironment,
  type CompatibilityFixtureManifest,
} from "../scripts/cloudflare/compat-fixture.js";
import {
  authorizeCompatibilityTarget,
  type WranglerInvocation,
} from "../scripts/cloudflare/verify-compat.js";

const projectRef = "cwwgvkepocldophqzijf";
const poolerHost = "aws-0-eu-west-2.pooler.supabase.com";

function migrationEnvironment(connectionString: string) {
  return {
    DATABASE_CA_CERT_PATH: "database/certificates/supabase-prod-ca-2021.crt",
    DATABASE_SSL: "require",
    MIGRATION_DATABASE_URL: connectionString,
    SUPABASE_POOLER_HOST: poolerHost,
    SUPABASE_PROJECT_REF: projectRef,
  };
}

function fixtureManifest(): CompatibilityFixtureManifest {
  const firstBusinessId = "20000000-0000-4000-8000-000000000001";
  const secondBusinessId = "20000000-0000-4000-8000-000000000002";
  return {
    version: 1,
    projectRef,
    contexts: [
      {
        agencyId: "10000000-0000-4000-8000-000000000001",
        businessId: firstBusinessId,
        locationId: "30000000-0000-4000-8000-000000000001",
        otherBusinessId: secondBusinessId,
        sessionHashHex: "a1".repeat(32),
        sessionId: "40000000-0000-4000-8000-000000000001",
        userId: "50000000-0000-4000-8000-000000000001",
      },
      {
        agencyId: "10000000-0000-4000-8000-000000000002",
        businessId: secondBusinessId,
        locationId: "30000000-0000-4000-8000-000000000002",
        otherBusinessId: firstBusinessId,
        sessionHashHex: "b2".repeat(32),
        sessionId: "40000000-0000-4000-8000-000000000002",
        userId: "50000000-0000-4000-8000-000000000002",
      },
    ],
  };
}

test("compatibility fixture requires TLS mode and an explicit trusted CA", () => {
  const url = `postgresql://afterword_migration_login.${projectRef}:synthetic@${poolerHost}:5432/postgres`;
  assert.throws(
    () => validateMigrationEnvironment({ ...migrationEnvironment(url), DATABASE_SSL: "prefer" }),
    /DATABASE_SSL=require/,
  );
  assert.throws(
    () => validateMigrationEnvironment({ ...migrationEnvironment(url), DATABASE_CA_CERT_PATH: "" }),
    /DATABASE_CA_CERT_PATH/,
  );
  assert.deepEqual(validateMigrationEnvironment(migrationEnvironment(url)), {
    certificatePath: "database/certificates/supabase-prod-ca-2021.crt",
    connectionString: url,
  });
});

test("compatibility fixture accepts only exact staging direct and pooler identities", () => {
  const direct = `postgresql://afterword_migration_login:synthetic@db.${projectRef}.supabase.co:5432/postgres`;
  const pooler = `postgresql://afterword_migration_login.${projectRef}:synthetic@${poolerHost}:5432/postgres`;
  assert.equal(validateMigrationEnvironment(migrationEnvironment(direct)).connectionString, direct);
  assert.equal(validateMigrationEnvironment(migrationEnvironment(pooler)).connectionString, pooler);

  const lookalikes = [
    `postgresql://afterword_migration_login:synthetic@db.${projectRef}.supabase.co.attacker.test:5432/postgres`,
    `postgresql://afterword_migration_login.${projectRef}.attacker:synthetic@${poolerHost}:5432/postgres`,
    `postgresql://prefix-afterword_migration_login.${projectRef}:synthetic@${poolerHost}:5432/postgres`,
    `postgresql://afterword_migration_login.${projectRef}x:synthetic@${poolerHost}:5432/postgres`,
  ];
  for (const value of lookalikes) {
    assert.throws(() => validateMigrationEnvironment(migrationEnvironment(value)), /staging project/);
  }
  const otherPooler = `postgresql://afterword_migration_login.${projectRef}:synthetic@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
  assert.throws(() => validateMigrationEnvironment(migrationEnvironment(otherPooler)), /staging project/);
});

test("cleanup discovery recovers a strictly validated pending fixture manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "review-anchor-compat-"));
  const activePath = path.join(directory, "compat-fixture.json");
  const pendingPath = path.join(directory, "compat-fixture.pending.json");
  const manifest = fixtureManifest();
  await writeFile(pendingPath, JSON.stringify(manifest));

  const located = await locateRecoverableManifest({ activePath, pendingPath });

  assert.deepEqual(located, { manifest, source: "pending" });
});

test("cleanup discovery rejects malformed pending fixture identifiers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "review-anchor-compat-invalid-"));
  const activePath = path.join(directory, "compat-fixture.json");
  const pendingPath = path.join(directory, "compat-fixture.pending.json");
  const manifest = fixtureManifest();
  manifest.contexts[0].userId = `50000000-0000-4000-8000-000000000001-${projectRef}`;
  await writeFile(pendingPath, JSON.stringify(manifest));

  await assert.rejects(
    locateRecoverableManifest({ activePath, pendingPath }),
    /manifest is incomplete/,
  );
});

test("verifier binds local Workers.dev evidence to the current Wrangler account before returning secrets", async () => {
  const accountId = "ab".repeat(16);
  const gateToken = "synthetic-gate-token-0123456789abcdef";
  let invocation: WranglerInvocation | undefined;
  const result = await authorizeCompatibilityTarget(
    {
      COMPAT_BASE_URL: "https://review-anchor-staging-compat.review-anchor-test.workers.dev",
      COMPAT_GATE_TOKEN: gateToken,
    },
    { accountId, workersDevSubdomain: "review-anchor-test" },
    async (input) => {
      invocation = input;
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          loggedIn: true,
          authType: "OAuth Token",
          accounts: [{ id: accountId, name: "Synthetic account" }],
          tokenPermissions: [],
        }),
      };
    },
  );

  assert.equal(result.baseUrl.hostname, "review-anchor-staging-compat.review-anchor-test.workers.dev");
  assert.equal(result.token, gateToken);
  assert.ok(invocation);
  assert.deepEqual(invocation.args.slice(-2), ["whoami", "--json"]);
  assert.equal(invocation.args.includes(gateToken), false);
  assert.equal(invocation.environment.COMPAT_GATE_TOKEN, undefined);
  assert.equal(JSON.stringify(invocation).includes(gateToken), false);
});

test("verifier fails closed when Wrangler is unauthenticated or lacks the recorded account", async () => {
  const accountId = "cd".repeat(16);
  const environment = {
    COMPAT_BASE_URL: "https://review-anchor-staging-compat.review-anchor-test.workers.dev",
    COMPAT_GATE_TOKEN: "synthetic-gate-token-0123456789abcdef",
  };
  const resources = { accountId, workersDevSubdomain: "review-anchor-test" };

  await assert.rejects(
    authorizeCompatibilityTarget(environment, resources, async () => ({
      exitCode: 1,
      stderr: "not authenticated",
      stdout: "",
    })),
    /Wrangler authentication could not be verified/,
  );
  await assert.rejects(
    authorizeCompatibilityTarget(environment, resources, async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: "ef".repeat(16), name: "Other" }] }),
    })),
    /recorded Cloudflare account is not available/,
  );
});
