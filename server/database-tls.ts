import { readFileSync } from "node:fs";
import path from "node:path";

export function databaseTlsOptions(requireSsl: boolean, certificatePath = process.env.DATABASE_CA_CERT_PATH) {
  if (!requireSsl) return undefined;
  const configuredPath = certificatePath?.trim();
  if (!configuredPath) {
    throw new Error("DATABASE_CA_CERT_PATH is required when DATABASE_SSL=require.");
  }
  return {
    ca: readFileSync(path.resolve(configuredPath), "utf8"),
    rejectUnauthorized: true,
  };
}
