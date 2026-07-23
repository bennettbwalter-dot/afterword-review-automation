import { createHash } from "node:crypto";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const migrationFilePattern = /^\d{3}_.+\.sql$/u;

export interface MigrationApprovalManifest {
  targetSha256: string;
  evidenceId: string;
  expiresAt: string;
  migrations: Record<string, string>;
}

export function migrationTargetFingerprint(connectionString: string) {
  const url = new URL(connectionString);
  return createHash("sha256")
    .update(`${url.hostname}:${url.port || "5432"}${url.pathname}`)
    .digest("hex");
}

export function parseMigrationApprovalManifest(
  raw: string | undefined,
  now = new Date(),
): MigrationApprovalManifest | undefined {
  if (!raw) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Migration approval manifest is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Migration approval manifest is invalid.");
  }

  const manifest = value as Partial<MigrationApprovalManifest>;
  const expiresAt = new Date(manifest.expiresAt ?? "");
  if (
    !sha256Pattern.test(manifest.targetSha256 ?? "")
    || !manifest.evidenceId?.trim()
    || !manifest.expiresAt
    || Number.isNaN(expiresAt.getTime())
    || !manifest.migrations
    || typeof manifest.migrations !== "object"
    || Array.isArray(manifest.migrations)
  ) {
    throw new Error("Migration approval manifest is invalid.");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("Migration approval manifest has expired.");
  }
  if (expiresAt.getTime() > now.getTime() + 30 * 60 * 1000) {
    throw new Error("Migration approval manifest must be short-lived.");
  }
  for (const [file, checksum] of Object.entries(manifest.migrations)) {
    if (!migrationFilePattern.test(file) || !sha256Pattern.test(checksum)) {
      throw new Error("Migration approval manifest is invalid.");
    }
  }

  return manifest as MigrationApprovalManifest;
}

export function assertMigrationApproved(
  file: string,
  checksum: string,
  targetFingerprint: string,
  manifest: MigrationApprovalManifest | undefined,
) {
  const version = Number.parseInt(file.slice(0, 3), 10);
  if (version <= 11) {
    return;
  }
  if (!manifest || manifest.targetSha256 !== targetFingerprint) {
    throw new Error(`Migration ${file} is not approved for this target.`);
  }
  if (manifest.migrations[file] !== checksum) {
    throw new Error(`Migration ${file} approval checksum does not match.`);
  }
}
