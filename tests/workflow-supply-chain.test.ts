import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeSha = "820762786026740c76f36085b0efc47a31fe5020";
const postgresImage = "postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50";

test("security workflows pin reviewed Node 24 actions and PostgreSQL", async () => {
  const application = await readFile(".github/workflows/application-security.yml", "utf8");
  const database = await readFile(".github/workflows/database-security.yml", "utf8");
  for (const source of [application, database]) {
    assert.match(source, new RegExp(`actions/checkout@${checkoutSha}\\s+# v7\\.0\\.1`));
    assert.match(source, new RegExp(`actions/setup-node@${setupNodeSha}\\s+# v7\\.0\\.0`));
    assert.doesNotMatch(source, /actions\/(?:checkout|setup-node)@v\d/u);
  }
  assert.match(database, new RegExp(postgresImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(database, /image:\s+postgres:16-alpine/u);
});

test("database workflow filters are broad without redundant entries", async () => {
  const database = await readFile(".github/workflows/database-security.yml", "utf8");
  assert.match(database, /- "server\/\*\*"/u);
  assert.match(database, /- "scripts\/\*\*"/u);
  assert.match(database, /- "tests\/\*\*"/u);
  assert.doesNotMatch(database, /server\/repository\/postgres\.ts/u);
  assert.doesNotMatch(database, /tests\/database-contract\.test\.ts/u);
});
