import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("every PostgreSQL command used by the repository exists in the forward migrations", async () => {
  const repository = await readFile(path.resolve("server", "repository", "postgres.ts"), "utf8");
  const migrationDirectory = path.resolve("database", "migrations");
  const migrations = await Promise.all(
    (await readdir(migrationDirectory))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .map((file) => readFile(path.join(migrationDirectory, file), "utf8")),
  );
  const schema = migrations.join("\n");
  const commandNames = new Set(
    [...repository.matchAll(/app_private\.([a-z][a-z0-9_]*)/g)].map((match) => match[1]),
  );

  assert.ok(commandNames.size > 20, "The repository command scan unexpectedly found too few database commands.");
  for (const commandName of commandNames) {
    assert.match(
      schema,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+app_private\\.${commandName}\\s*\\(`, "i"),
      `Missing migration function for app_private.${commandName}`,
    );
  }
});

test("token revocation has no unfenced authentication-role shortcut", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "003_authenticated_review_automation.sql"),
    "utf8",
  );
  assert.doesNotMatch(schema, /create\s+or\s+replace\s+function\s+app_private\.complete_google_token_revocation/i);
  assert.doesNotMatch(schema, /grant\s+execute[^;]*complete_google_token_revocation[^;]*afterword_auth/i);
  assert.match(schema, /grant\s+execute[^;]*finish_google_token_revocation[^;]*afterword_worker/i);
});
