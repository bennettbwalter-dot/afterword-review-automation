import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { migrationChecksum, migrationChecksumVariants } from "../scripts/migration-checksum.js";

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
