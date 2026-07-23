import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  migrationChecksum,
  migrationChecksumVariants,
  unwrapMigrationTransaction,
} from "../scripts/migration-checksum.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("migration checksums are stable across Windows and Unix line endings", () => {
  const lf = "begin;\ngrant select on example to runtime;\ncommit;\n";
  const crlf = lf.replace(/\n/g, "\r\n");

  assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
  assert.ok(migrationChecksumVariants(lf).has(hash(lf)));
  assert.ok(migrationChecksumVariants(crlf).has(hash(crlf)));
  assert.ok(migrationChecksumVariants(crlf).has(hash(lf)));
});

test("migration checksum validation still rejects semantic SQL changes", () => {
  const original = "grant select on example to runtime;\n";
  const changed = "grant all on example to runtime;\n";

  assert.ok(!migrationChecksumVariants(changed).has(migrationChecksum(original)));
});

test("migration transaction wrappers are removed for atomic ledger commits", () => {
  assert.equal(unwrapMigrationTransaction("begin;\nselect 1;\ncommit;\n"), "select 1;\n");
  assert.throws(() => unwrapMigrationTransaction("select 1;"), /begin and commit/i);
  assert.throws(() => unwrapMigrationTransaction("begin;\ncommit;\nselect 1;"), /outer transaction/i);
});

test("migration transaction unwrapping preserves inner PL/pgSQL blocks", () => {
  const sql = [
    "-- forward-only migration",
    "begin;",
    "do $$",
    "begin",
    "  perform 1;",
    "end",
    "$$;",
    "commit;",
    "",
  ].join("\r\n");

  assert.equal(unwrapMigrationTransaction(sql), "do $$\nbegin\n  perform 1;\nend\n$$;\n");
});
