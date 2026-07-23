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

export function unwrapMigrationTransaction(sql: string) {
  const lines = canonicalMigrationSql(sql).split("\n");
  const beginIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });
  if (beginIndex < 0 || !/^begin\s*;$/iu.test(lines[beginIndex].trim())) {
    throw new Error("Migration outer transaction must contain BEGIN and COMMIT.");
  }

  let commitIndex = lines.length - 1;
  while (commitIndex > beginIndex && lines[commitIndex].trim().length === 0) {
    commitIndex -= 1;
  }
  if (commitIndex <= beginIndex || !/^commit\s*;$/iu.test(lines[commitIndex].trim())) {
    throw new Error("Migration outer transaction must contain BEGIN and COMMIT with no SQL after COMMIT.");
  }

  const body = lines.slice(beginIndex + 1, commitIndex).join("\n");
  return `${body.replace(/\n*$/u, "")}\n`;
}
