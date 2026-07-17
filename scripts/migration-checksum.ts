import { createHash } from "node:crypto";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalMigrationSql(sql: string) {
  return sql.replace(/\r\n?/g, "\n");
}

export function migrationChecksum(sql: string) {
  return sha256(canonicalMigrationSql(sql));
}

export function migrationChecksumVariants(sql: string) {
  const canonical = canonicalMigrationSql(sql);
  return new Set([
    sha256(sql),
    sha256(canonical),
    sha256(canonical.replace(/\n/g, "\r\n")),
  ]);
}
